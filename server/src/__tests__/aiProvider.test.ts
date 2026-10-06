/**
 * AI Provider 配置解析与 OpenAI 兼容客户端测试
 *
 * 这些测试不发起真实网络请求：
 * - provider 解析全部针对传入的 env 对象
 * - 客户端行为通过注入 fetch 实现验证
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveProviderName,
  resolveProviderConfig,
  requireProviderConfig,
  ProviderConfigError,
  ApiKeyMissingError,
  DEFAULT_PROVIDER
} from '../services/aiProvider.js';
import {
  chatCompletion,
  extractMessageContent,
  ChatCompletionError
} from '../services/openaiCompatibleClient.js';

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

describe('provider 解析', () => {
  it('未配置 AI_PROVIDER 时回退到 openrouter，保证既有部署不受影响', () => {
    expect(resolveProviderName({})).toBe(DEFAULT_PROVIDER);
    expect(resolveProviderName({})).toBe('openrouter');
  });

  it('识别 ark 并解析出方舟的 base URL', () => {
    const config = resolveProviderConfig({ AI_PROVIDER: 'ark', ARK_API_KEY: 'k' });
    expect(config.name).toBe('ark');
    expect(config.baseURL).toBe(ARK_BASE_URL);
  });

  it('显式 openrouter 解析出 OpenRouter 的 base URL', () => {
    const config = resolveProviderConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' });
    expect(config.baseURL).toBe(OPENROUTER_BASE_URL);
  });

  it('AI_PROVIDER 大小写与空格不敏感', () => {
    expect(resolveProviderName({ AI_PROVIDER: '  ARK  ' })).toBe('ark');
  });

  it('AI_PROVIDER 取值非法时抛出明确的配置错误', () => {
    expect(() => resolveProviderName({ AI_PROVIDER: 'openai' })).toThrow(ProviderConfigError);
    expect(() => resolveProviderName({ AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER 取值非法/);
  });
});

describe('模型与密钥解析', () => {
  it('两个 provider 使用各自不同的默认模型', () => {
    const or = resolveProviderConfig({ AI_PROVIDER: 'openrouter' });
    const ark = resolveProviderConfig({ AI_PROVIDER: 'ark' });
    expect(or.model).toBe('deepseek/deepseek-v3.2');
    expect(ark.model).not.toBe(or.model);
  });

  it('ARK_MODEL 可以覆盖方舟默认模型', () => {
    const config = resolveProviderConfig({ AI_PROVIDER: 'ark', ARK_MODEL: 'ep-20250101-abcde' });
    expect(config.model).toBe('ep-20250101-abcde');
  });

  it('AI_MODEL 作为通用覆盖，优先级高于 provider 专属变量', () => {
    const config = resolveProviderConfig({
      AI_PROVIDER: 'ark',
      AI_MODEL: 'doubao-pro',
      ARK_MODEL: 'ep-ignored'
    });
    expect(config.model).toBe('doubao-pro');
  });

  it('ARK_MODEL 不影响 openrouter 的模型选择', () => {
    const config = resolveProviderConfig({ AI_PROVIDER: 'openrouter', ARK_MODEL: 'ep-ignored' });
    expect(config.model).toBe('deepseek/deepseek-v3.2');
  });

  it('向后兼容：仍认可旧变量名 OPENROUTER_API_KEY', () => {
    const config = requireProviderConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'legacy-key' });
    expect(config.apiKey).toBe('legacy-key');
  });

  it('AI_API_KEY 优先于 provider 专属变量', () => {
    const config = requireProviderConfig({
      AI_PROVIDER: 'ark',
      AI_API_KEY: 'generic',
      ARK_API_KEY: 'specific'
    });
    expect(config.apiKey).toBe('generic');
  });

  it('Ark 缺少密钥时抛出 ApiKeyMissingError 并指出变量名', () => {
    expect(() => requireProviderConfig({ AI_PROVIDER: 'ark' })).toThrow(ApiKeyMissingError);
    expect(() => requireProviderConfig({ AI_PROVIDER: 'ark' })).toThrow(/ARK_API_KEY/);
  });

  it('空字符串密钥视为未配置', () => {
    expect(() => requireProviderConfig({ AI_PROVIDER: 'ark', ARK_API_KEY: '   ' })).toThrow(
      ApiKeyMissingError
    );
  });

  it('AI_BASE_URL 可覆盖默认地址，并去掉末尾斜杠', () => {
    const config = resolveProviderConfig({
      AI_PROVIDER: 'ark',
      AI_BASE_URL: 'https://gateway.internal/v1/'
    });
    expect(config.baseURL).toBe('https://gateway.internal/v1');
  });

  it('环境变量是惰性读取：同一进程内改写后立即生效', () => {
    const env: NodeJS.ProcessEnv = { AI_PROVIDER: 'ark', ARK_API_KEY: 'first' };
    expect(resolveProviderConfig(env).apiKey).toBe('first');
    env.ARK_API_KEY = 'second';
    expect(resolveProviderConfig(env).apiKey).toBe('second');
  });
});

describe('OpenAI 兼容客户端', () => {
  const arkConfig = resolveProviderConfig({ AI_PROVIDER: 'ark', ARK_API_KEY: 'test-key' });

  function mockFetch(response: Partial<Response> & { jsonValue?: unknown; textValue?: string }) {
    return vi.fn(async () => {
      const { jsonValue, textValue, ...rest } = response;
      return {
        ...rest,
        json: async () => jsonValue,
        text: async () => textValue ?? ''
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('请求发送到 {baseURL}/chat/completions，并带上 Bearer 鉴权', async () => {
    const fetchImpl = mockFetch({ ok: true, status: 200, jsonValue: { choices: [] } });

    await chatCompletion(
      arkConfig,
      { model: 'doubao-seed-1-6', messages: [{ role: 'user', content: 'hi' }] },
      { fetchImpl }
    );

    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(`${ARK_BASE_URL}/chat/completions`);
    expect(call[1].method).toBe('POST');
    expect(call[1].headers.Authorization).toBe('Bearer test-key');
  });

  it('maxTokens 映射为 OpenAI 协议的 max_tokens', async () => {
    const fetchImpl = mockFetch({ ok: true, status: 200, jsonValue: { choices: [] } });

    await chatCompletion(
      arkConfig,
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 500, temperature: 0.2 },
      { fetchImpl }
    );

    const body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(500);
    expect(body.model).toBe('m');
    expect(body.temperature).toBe(0.2);
  });

  it('HTTP 401 时抛出带状态码与响应正文的错误，便于定位密钥问题', async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 401,
      textValue: '{"error":{"code":"AuthenticationError"}}'
    });

    await expect(
      chatCompletion(arkConfig, { model: 'm', messages: [] }, { fetchImpl })
    ).rejects.toThrow(ChatCompletionError);

    await expect(
      chatCompletion(arkConfig, { model: 'm', messages: [] }, { fetchImpl })
    ).rejects.toThrow(/HTTP 401/);
  });

  it('网络异常被包装为 ChatCompletionError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(
      chatCompletion(arkConfig, { model: 'm', messages: [] }, { fetchImpl })
    ).rejects.toThrow(/请求失败/);
  });

  it('响应不是合法 JSON 时抛出可识别错误', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
      text: async () => ''
    })) as unknown as typeof fetch;

    await expect(
      chatCompletion(arkConfig, { model: 'm', messages: [] }, { fetchImpl })
    ).rejects.toThrow(/不是合法 JSON/);
  });

  it('extractMessageContent 兼容字符串 content 与空响应', () => {
    expect(
      extractMessageContent({ choices: [{ message: { content: 'hello' } }] })
    ).toBe('hello');
    expect(extractMessageContent({})).toBe('');
    expect(extractMessageContent({ choices: [{ message: { content: null } }] })).toBe('');
  });
});
