/**
 * Jev（System One）客户端与 analyzeContent 两级流水线测试
 *
 * 全部 mock，不发真实请求、不花真钱：
 * 1. jevClient：请求构造 / 响应解析 / 类型错误
 * 2. analyzeContent 的 Jev 分支：预筛通过→调 LLM；预筛不通过→零 LLM 调用
 * 3. 降级路径：Jev 失败→LLM 全量；JEV 未启用→与现状一致
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import type { AIAnalysis } from '../types.js';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

import {
  resolveJevConfig,
  requireJevConfig,
  requestJevDecisions,
  noulValue,
  scoreValue,
  choiceValue,
  answerOf,
  JevRequestError,
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  type JevResponse
} from '../services/jevClient.js';
import { analyzeContent } from '../services/ai.js';

const JEV_ENV_KEYS = ['JEV_ENABLED', 'JEV_API_KEY', 'JEV_BASE_URL', 'JEV_MODEL'] as const;
const AI_ENV_KEYS = ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL', 'ARK_API_KEY', 'ARK_MODEL', 'OPENROUTER_API_KEY'] as const;

function saveEnv(keys: readonly string[]): () => void {
  const saved = new Map<string, string | undefined>();
  keys.forEach(k => saved.set(k, process.env[k]));
  return () => {
    saved.forEach((v, k) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  };
}

function mockJevHttp(responseBody: unknown, status = 200) {
  if (status >= 400) {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data: responseBody }
      })
    );
    mockedAxios.isAxiosError.mockReturnValue(true);
    return;
  }
  mockedAxios.post.mockResolvedValue({ data: responseBody, status });
}

/** 构造一份标准 Jev 响应 */
function jevResponse(overrides: Record<string, unknown> = {}) {
  return {
    model: 'jev-1.13.0',
    answers: {
      isReal: { type: 'noul', noul: 0.96 },
      relevance: { type: 'score', score: 3.0, confidence: 0.99 },
      keywordMentioned: { type: 'noul', noul: 0.88 },
      importance: { type: 'choice', choice: 'high', probabilities: { low: 0, medium: 0, high: 1 } },
      ...overrides
    },
    usage: { input_tokens: 345, output_tokens: 78 }
  } as unknown as JevResponse;
}

describe('resolveJevConfig / requireJevConfig', () => {
  it('默认关闭（JEV_ENABLED 未设置）', () => {
    const cfg = resolveJevConfig({});
    expect(cfg.enabled).toBe(false);
  });

  it('JEV_ENABLED=true 时启用，解析默认 baseURL 与模型', () => {
    const cfg = resolveJevConfig({ JEV_ENABLED: 'true', JEV_API_KEY: 'k' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.baseURL).toBe(JEV_DEFAULT_BASE_URL);
    expect(cfg.model).toBe(JEV_DEFAULT_MODEL);
  });

  it('requireJevConfig 在未启用或缺 key 时抛错', () => {
    expect(() => requireJevConfig({})).toThrow(/JEV_ENABLED/);
    expect(() => requireJevConfig({ JEV_ENABLED: 'true' })).toThrow(/JEV_API_KEY/);
  });

  it('支持自定义 baseURL / model', () => {
    const cfg = resolveJevConfig({
      JEV_ENABLED: '1',
      JEV_API_KEY: 'k',
      JEV_BASE_URL: 'https://gateway.internal/',
      JEV_MODEL: 'jev-2.0'
    });
    expect(cfg.baseURL).toBe('https://gateway.internal');
    expect(cfg.model).toBe('jev-2.0');
  });
});

describe('requestJevDecisions', () => {
  const config = { baseURL: JEV_DEFAULT_BASE_URL, apiKey: 'test-key', model: JEV_DEFAULT_MODEL };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('请求发到 {baseURL}/v1/systemone，带 Bearer 鉴权', async () => {
    mockJevHttp(jevResponse());

    await requestJevDecisions(config, 'state text', { q: { type: 'noul', instructions: 'i', criteria: { true: 'y', false: 'n' } } });

    const call = mockedAxios.post.mock.calls[0];
    expect(call[0]).toBe('https://api.quickrouter.ai/v1/systemone');
    expect(call[2]?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    const body = call[1] as Record<string, unknown>;
    expect(body.model).toBe('jev-1.13.0');
    expect(body.state).toBe('state text');
    expect((body.questions as Record<string, unknown>).q).toMatchObject({ type: 'noul' });
  });

  it('非 2xx 抛 JevRequestError 并带状态码', async () => {
    mockJevHttp({ error: 'no access' }, 403);

    await expect(requestJevDecisions(config, 's', {})).rejects.toThrow(JevRequestError);
    await expect(requestJevDecisions(config, 's', {})).rejects.toThrow(/HTTP 403/);
  });

  it('响应缺少 answers 抛 JevRequestError', async () => {
    mockJevHttp({ model: 'jev' });

    await expect(requestJevDecisions(config, 's', {})).rejects.toThrow(/answers/);
  });

  it('网络异常被包装为 JevRequestError', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('connect ETIMEDOUT'), { isAxiosError: true })
    );
    mockedAxios.isAxiosError.mockReturnValue(true);

    await expect(requestJevDecisions(config, 's', {})).rejects.toThrow(/Jev 请求失败/);
  });

  it('noulValue / scoreValue / choiceValue 类型安全解析', () => {
    const response = jevResponse();
    expect(noulValue(response, 'isReal')).toBe(0.96);
    expect(scoreValue(response, 'relevance')).toBe(3.0);
    expect(choiceValue(response, 'importance')).toBe('high');
  });

  it('类型不符时抛 JevRequestError', () => {
    const response = jevResponse({ importance: { type: 'score', score: 1 } });
    expect(() => choiceValue(response, 'importance')).toThrow(JevRequestError);
    expect(() => answerOf(response, 'missing')).toThrow(/缺少答案/);
  });
});

describe('analyzeContent Jev 两级流水线', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveEnv([...JEV_ENV_KEYS, ...AI_ENV_KEYS]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
  });

  function enableJev() {
    process.env.JEV_ENABLED = 'true';
    process.env.JEV_API_KEY = 'quickrouter-key';
    process.env.AI_API_KEY = 'ark-key';
    process.env.AI_PROVIDER = 'ark';
  }

  /** LLM 通道（openaiCompatibleClient 用全局 fetch）——返回完整 AIAnalysis JSON */
  function stubLlmFetch(analysis: Record<string, unknown>) {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }),
      text: async () => ''
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  const fullAnalysis = {
    isReal: true, relevance: 85, relevanceReason: 'LLM 精判理由', keywordMentioned: true, importance: 'high', summary: 'LLM 摘要'
  };

  it('Jev 粗筛放行（非明确垃圾）→ LLM 全量精判，决策字段来自 LLM', async () => {
    enableJev();
    mockJevHttp(jevResponse({ isReal: { type: 'noul', noul: 0.6 }, relevance: { type: 'score', score: 2.0 } }));
    const llmFetch = stubLlmFetch(fullAnalysis);

    const result = await analyzeContent('Anthropic 发布 Claude 新模型', 'Claude');

    // Jev 放行后由 LLM 全量决策
    expect(result.relevance).toBe(85);
    expect(result.isReal).toBe(true);
    expect(result.importance).toBe('high');
    expect(result.relevanceReason).toContain('LLM 精判');
    // Jev 一次（axios）+ LLM 一次（fetch）
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(llmFetch).toHaveBeenCalledTimes(1);
  });

  it('Jev 判定明确垃圾（isReal<0.15）→ 零 LLM 调用，返回拦截分析', async () => {
    enableJev();
    mockJevHttp(
      jevResponse({
        isReal: { type: 'noul', noul: 0.05 },
        relevance: { type: 'score', score: 2.0 }
      })
    );
    const llmFetch = stubLlmFetch(fullAnalysis);

    const result = await analyzeContent('震惊！免费领取百万现金！', 'Claude');

    expect(result.isReal).toBe(false);
    expect(result.relevance).toBe(10);
    expect(result.relevanceReason).toContain('Jev');
    // 只有 Jev 一次调用，没有 LLM 调用
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(llmFetch).not.toHaveBeenCalled();
  });

  it('Jev 判定完全无关（score=0）→ 零 LLM 调用', async () => {
    enableJev();
    mockJevHttp(
      jevResponse({
        isReal: { type: 'noul', noul: 0.9 },
        relevance: { type: 'score', score: 0 }
      })
    );
    const llmFetch = stubLlmFetch(fullAnalysis);

    const result = await analyzeContent('宠物猫喂养指南', 'Claude');

    expect(result.relevance).toBe(0);
    expect(result.relevanceReason).toContain('Jev');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(llmFetch).not.toHaveBeenCalled();
  });

  it('Jev 判定模糊（isReal=0.4, score=1）→ 放行由 LLM 精判，不误杀', async () => {
    enableJev();
    mockJevHttp(
      jevResponse({
        isReal: { type: 'noul', noul: 0.4 },
        relevance: { type: 'score', score: 1.0 }
      })
    );
    const llmFetch = stubLlmFetch(fullAnalysis);

    const result = await analyzeContent('一些不确定的内容', 'Claude');

    // 关键：Jev 不确定时不拦截，交给 LLM —— 避免误杀真实内容（实测教训）
    expect(result.relevance).toBe(85);
    expect(llmFetch).toHaveBeenCalledTimes(1);
  });

  it('Jev 失败 → 降级为 LLM 全量（现状行为）', async () => {
    enableJev();
    // Jev 调用抛网络错误
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('connect ETIMEDOUT'), { isAxiosError: true })
    );
    mockedAxios.isAxiosError.mockReturnValue(true);
    const llmFetch = stubLlmFetch(fullAnalysis);

    const result = await analyzeContent('some content', 'Claude');

    expect(result.relevance).toBe(85);
    expect(result.relevanceReason).toContain('LLM 精判');
    expect(llmFetch).toHaveBeenCalledTimes(1);
  });

  it('JEV 未启用 → 完全走 LLM 全量，与接入前一致', async () => {
    process.env.AI_API_KEY = 'ark-key';
    process.env.AI_PROVIDER = 'ark';

    const llmFetch = stubLlmFetch({ isReal: true, relevance: 75, relevanceReason: '正常分析', keywordMentioned: true, importance: 'medium', summary: '摘要' });

    const result = await analyzeContent('content', 'Claude');

    expect(result.relevance).toBe(75);
    expect(llmFetch).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).not.toHaveBeenCalled(); // 不碰 Jev
  });

  it('JEV_ENABLED=true 但缺 key → 降级 LLM 全量而不是报错', async () => {
    process.env.JEV_ENABLED = 'true';
    delete process.env.JEV_API_KEY;
    process.env.AI_API_KEY = 'ark-key';

    const llmFetch = stubLlmFetch({ isReal: true, relevance: 60, relevanceReason: '降级分析', keywordMentioned: true, importance: 'low', summary: 's' });

    const result = await analyzeContent('content', 'Claude');

    expect(result.relevance).toBe(60);
  });
});
