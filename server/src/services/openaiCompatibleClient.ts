/**
 * 最小化 OpenAI 兼容 Chat Completions 客户端
 *
 * OpenRouter 与火山方舟都提供 OpenAI 兼容协议，因此统一走同一份请求实现：
 *   POST {baseURL}/chat/completions
 *
 * 之所以不依赖厂商 SDK：协议本身足够简单，而自建实现可以完全控制
 * 请求头、超时、错误信息，并且同一套代码可指向任意兼容端点。
 */

import type { ProviderConfig } from './aiProvider.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * OpenAI 兼容的响应结构（只声明我们实际读取的字段）。
 */
export interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** API 调用失败（HTTP 非 2xx 或响应结构非法） */
export class ChatCompletionError extends Error {
  readonly status?: number;
  readonly detail?: string;

  constructor(message: string, options: { status?: number; detail?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ChatCompletionError';
    this.status = options.status;
    this.detail = options.detail;
  }
}

export interface ChatClientOptions {
  /** 请求超时（毫秒），默认 60s */
  timeoutMs?: number;
  /** 注入 fetch 实现，便于测试 */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 提取 OpenAI 兼容响应中的正文。
 * content 可能是字符串，也可能是多模态数组；这里只处理字符串。
 */
export function extractMessageContent(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

/**
 * 发起一次 OpenAI 兼容的 chat completion 请求。
 *
 * @throws ChatCompletionError 当网络失败、超时或返回非 2xx 时
 */
export async function chatCompletion(
  config: ProviderConfig,
  params: ChatCompletionParams,
  options: ChatClientOptions = {}
): Promise<ChatCompletionResponse> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = options;
  const url = `${config.baseURL}/chat/completions`;

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;

  // 超时由 AbortController 控制，避免请求悬挂阻塞扫描任务
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new ChatCompletionError(
      aborted
        ? `${config.name} 请求超时（${timeoutMs}ms）`
        : `${config.name} 请求失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 读取错误正文，让鉴权/模型名等问题可以直接定位
    const detail = await response.text().catch(() => '');
    throw new ChatCompletionError(
      `${config.name} 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`,
      { status: response.status, detail }
    );
  }

  try {
    return (await response.json()) as ChatCompletionResponse;
  } catch (error) {
    throw new ChatCompletionError(`${config.name} 响应不是合法 JSON`, { cause: error });
  }
}
