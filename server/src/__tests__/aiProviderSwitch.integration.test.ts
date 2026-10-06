/**
 * Provider 切换的集成测试
 *
 * 目的：验证「改配置 → 实际发出的 HTTP 请求」这条完整链路，
 * 而不是只验证配置解析函数本身。
 *
 * 通过 mock fetch 捕获真实请求，断言：
 * - 切到 ark 后请求打到方舟地址
 * - 请求里带的是方舟的模型名，而不是 OpenRouter 的 deepseek/deepseek-v3.2
 * - 鉴权头用的是方舟的 key
 * - 切回 openrouter 后一切也随之改变
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analyzeContent, expandKeyword } from '../services/ai.js';

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const ENV_KEYS = [
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_BASE_URL',
  'ARK_API_KEY',
  'ARK_MODEL',
  'OPENROUTER_API_KEY'
] as const;

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: { model: string; messages: Array<{ role: string; content: string }> };
}

describe('provider 切换端到端（配置 → 实际请求）', () => {
  const saved = new Map<string, string | undefined>();
  let captured: CapturedRequest[] = [];

  beforeEach(() => {
    // 保存并清空所有相关变量，避免真实 .env 干扰断言
    ENV_KEYS.forEach(k => {
      saved.set(k, process.env[k]);
      delete process.env[k];
    });
    captured = [];

    // 返回一个能让 analyzeContent 正常解析的 JSON 响应
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        captured.push({
          url: String(url),
          headers: init.headers as Record<string, string>,
          body: JSON.parse(String(init.body))
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    isReal: true,
                    relevance: 90,
                    relevanceReason: '直接相关',
                    keywordMentioned: true,
                    importance: 'high',
                    summary: '关联说明',
                    // expandKeyword 解析数组时用的是 /\[...\]/，这里同时给出数组形态
                    variants: []
                  })
                }
              }
            ]
          }),
          text: async () => ''
        } as unknown as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    saved.forEach((v, k) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  it('AI_PROVIDER=ark 时请求发往方舟，并使用方舟模型与密钥', async () => {
    process.env.AI_PROVIDER = 'ark';
    process.env.ARK_API_KEY = 'ark-secret';
    process.env.ARK_MODEL = 'doubao-seed-1-6-250615';

    const result = await analyzeContent('some content', 'Claude Sonnet 4.6');

    expect(result.relevance).toBe(90);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${ARK_BASE_URL}/chat/completions`);
    expect(captured[0].headers.Authorization).toBe('Bearer ark-secret');
    expect(captured[0].body.model).toBe('doubao-seed-1-6-250615');
    // 关键回归点：绝不能把 OpenRouter 的模型名发给方舟
    expect(captured[0].body.model).not.toBe('deepseek/deepseek-v3.2');
  });

  it('AI_PROVIDER=openrouter 时请求发往 OpenRouter，并使用其默认模型', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';

    await analyzeContent('some content', 'Claude Sonnet 4.6');

    expect(captured[0].url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(captured[0].headers.Authorization).toBe('Bearer sk-or-v1-test');
    expect(captured[0].body.model).toBe('deepseek/deepseek-v3.2');
  });

  it('未配置 AI_PROVIDER 时保持旧行为（默认 openrouter + 旧变量名）', async () => {
    // 只设置旧的 OPENROUTER_API_KEY，模拟既有的 .env 不做任何改动
    process.env.OPENROUTER_API_KEY = 'legacy-key';

    await analyzeContent('some content', 'keyword');

    expect(captured[0].url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(captured[0].headers.Authorization).toBe('Bearer legacy-key');
  });

  it('切换到 ark 后不携带任何 OpenRouter 端点信息', async () => {
    process.env.AI_PROVIDER = 'ark';
    process.env.ARK_API_KEY = 'ark-secret';
    process.env.OPENROUTER_API_KEY = 'stale-openrouter-key';

    await analyzeContent('some content', 'keyword');

    expect(captured[0].url).not.toContain('openrouter.ai');
    expect(captured[0].headers.Authorization).toBe('Bearer ark-secret');
  });

  it('ark 未配置密钥时降级为 fallback，不发起网络请求', async () => {
    process.env.AI_PROVIDER = 'ark';

    const result = await analyzeContent(
      'content',
      'keyword',
      { matched: true, matchedTerms: ['keyword'] }
    );

    expect(captured).toHaveLength(0);
    expect(result.relevance).toBe(30);
    expect(result.relevanceReason).toContain('AI 分析失败');
  });

  it('expandKeyword 同样走 provider 配置', async () => {
    process.env.AI_PROVIDER = 'ark';
    process.env.ARK_API_KEY = 'ark-secret';
    process.env.ARK_MODEL = 'ep-2025-test';

    await expandKeyword('Claude Sonnet 4.6');

    expect(captured[0].url).toBe(`${ARK_BASE_URL}/chat/completions`);
    expect(captured[0].body.model).toBe('ep-2025-test');
  });

  it('AI_BASE_URL 可把方舟指向自建网关', async () => {
    process.env.AI_PROVIDER = 'ark';
    process.env.ARK_API_KEY = 'ark-secret';
    process.env.AI_BASE_URL = 'https://gateway.internal/v1';

    await analyzeContent('content', 'keyword');

    expect(captured[0].url).toBe('https://gateway.internal/v1/chat/completions');
  });
});
