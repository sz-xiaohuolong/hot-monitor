/**
 * AI Provider 配置解析
 *
 * 支持通过配置文件（.env）在两个 OpenAI 兼容的服务之间无缝切换：
 *   - openrouter : https://openrouter.ai/api/v1
 *   - ark        : https://ark.cn-beijing.volces.com/api/plan/v3  （火山方舟）
 *
 * 设计要点：
 * 1. provider 决定默认模型，切换 provider 不需要改代码。
 * 2. 环境变量是惰性读取的（每次调用重新读），这样配置文件变更和测试中的
 *    环境变量覆盖都能立即生效，不存在模块加载时的快照。
 */

export type ProviderName = 'openrouter' | 'ark';

export interface ProviderConfig {
  /** 当前生效的 provider */
  name: ProviderName;
  /** OpenAI 兼容的 base URL，不含 /chat/completions */
  baseURL: string;
  /** 请求鉴权用的 API Key */
  apiKey: string;
  /** 该 provider 的默认模型 */
  model: string;
  /** 用于错误提示的 API Key 环境变量名 */
  apiKeyEnv: string;
}

const PROVIDER_DEFAULTS: Record<ProviderName, { baseURL: string; model: string; apiKeyEnv: string }> = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v3.2',
    apiKeyEnv: 'OPENROUTER_API_KEY'
  },
  ark: {
    baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    // 方舟的模型名与 OpenRouter 不同（如 doubao-seed-1-6-... 或推理接入点 ep-xxxx），
    // 这里只给一个占位默认值，实际使用应通过 ARK_MODEL 显式指定。
    model: 'doubao-seed-1-6',
    apiKeyEnv: 'ARK_API_KEY'
  }
};

const VALID_PROVIDERS: ProviderName[] = ['openrouter', 'ark'];

export const DEFAULT_PROVIDER: ProviderName = 'openrouter';

/** 配置错误：provider 取值非法 */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/** API Key 缺失：调用方据此走 fallback 路径，而不是当成网络错误 */
export class ApiKeyMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyMissingError';
  }
}

/**
 * 解析环境变量中的 AI_PROVIDER。
 * 未配置时返回默认 provider，保证既有部署不需要改动即可继续运行。
 */
export function resolveProviderName(env: NodeJS.ProcessEnv = process.env): ProviderName {
  const raw = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (!raw) return DEFAULT_PROVIDER;

  if (!VALID_PROVIDERS.includes(raw as ProviderName)) {
    throw new ProviderConfigError(
      `AI_PROVIDER 取值非法："${raw}"。可选值为 openrouter | ark。`
    );
  }
  return raw as ProviderName;
}

/**
 * 按优先级读取 API Key：
 * 1. 显式覆盖 AI_API_KEY（通用变量）
 * 2. 当前 provider 对应的变量（ARK_API_KEY / OPENROUTER_API_KEY）
 *
 * 读取顺序故意优先 AI_API_KEY，使「同一个 key 变量配合不同 provider」可用，
 * 同时保留 OPENROUTER_API_KEY 作为向后兼容的旧变量名。
 */
function resolveApiKey(config: { apiKeyEnv: string }, env: NodeJS.ProcessEnv): string {
  const generic = (env.AI_API_KEY ?? '').trim();
  if (generic) return generic;

  const specific = (env[config.apiKeyEnv] ?? '').trim();
  return specific;
}

/**
 * 解析当前生效的完整 provider 配置。
 * 不校验 apiKey 是否存在——缺失时调用方通常需要走 fallback 而不是抛错。
 */
export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const name = resolveProviderName(env);
  const defaults = PROVIDER_DEFAULTS[name];

  // base URL 允许覆盖，便于指向自建网关或兼容代理；末尾斜杠统一去掉。
  const baseURLOverride = (env.AI_BASE_URL ?? '').trim();
  const baseURL = (baseURLOverride || defaults.baseURL).replace(/\/+$/, '');

  const modelOverride = (env.AI_MODEL ?? '').trim();
  // Ark 额外支持 ARK_MODEL，便于在不影响 OpenRouter 的前提下单独配置
  const providerModelOverride =
    name === 'ark' ? (env.ARK_MODEL ?? '').trim() : '';

  return {
    name,
    baseURL,
    apiKey: resolveApiKey(defaults, env),
    model: modelOverride || providerModelOverride || defaults.model,
    apiKeyEnv: defaults.apiKeyEnv
  };
}

/**
 * 要求配置完整可用，否则抛出 ApiKeyMissingError。
 * 调用方捕获该错误后使用规则化 fallback 分析（与既有行为一致）。
 */
export function requireProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const config = resolveProviderConfig(env);
  if (!config.apiKey) {
    throw new ApiKeyMissingError(
      `未配置 ${config.apiKeyEnv}（或通用变量 AI_API_KEY），provider=${config.name}，将使用默认分析分数`
    );
  }
  return config;
}
