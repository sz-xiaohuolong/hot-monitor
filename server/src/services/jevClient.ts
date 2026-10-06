/**
 * Jev（TypeSafe System One 模型）决策客户端
 *
 * 通过 QuickRouter 中转访问：POST {baseURL}/v1/systemone，模型 jev-1.13.0。
 * Jev 是判别式模型：输入 state + 类型化 questions，输出类型化概率决策，
 * 不生成自然语言文本（所以 summary/relevanceReason 仍需由生成式 LLM 产出）。
 *
 * 支持三种 primitive：
 *   - noul   ：是/否 + 概率（0~1）
 *   - score  ：有序刻度 + 置信度 + 每档概率
 *   - choice ：从选项中选择 + 概率分布
 */

import axios from 'axios';
import type { ProviderConfig } from './aiProvider.js';

// ============================================================
// 类型定义
// ============================================================

export type JevPrimitive = 'noul' | 'score' | 'choice';

export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

export interface JevScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[]; // 有序刻度描述（Jev 内部映射为 0..len-1）
}

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export type JevQuestion = JevNoulQuestion | JevScoreQuestion | JevChoiceQuestion;

export type JevQuestions = Record<string, JevQuestion>;

export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
  confidence?: number;
}

export interface JevScoreAnswer {
  type: 'score';
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
}

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevScoreAnswer | JevChoiceAnswer;

export interface JevResponse {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevClientConfig {
  /** System One API base URL，如 https://api.quickrouter.ai（不带 /v1） */
  baseURL: string;
  /** 访问令牌（QuickRouter 或 OpenRouter key） */
  apiKey: string;
  /** 模型 ID，默认 jev-1.13.0 */
  model: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
}

/** 请求失败（网络/鉴权/非 2xx/结构非法） */
export class JevRequestError extends Error {
  readonly status?: number;
  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'JevRequestError';
    this.status = options.status;
  }
}

// ============================================================
// 配置解析（独立于 aiProvider：Jev 是独立通道，不强绑定 AI provider）
// ============================================================

export const JEV_DEFAULT_BASE_URL = 'https://api.quickrouter.ai';
export const JEV_DEFAULT_MODEL = 'jev-1.13.0';
export const JEV_DEFAULT_TIMEOUT_MS = 30_000;

export interface JevEnvConfig {
  enabled: boolean;
  baseURL: string;
  model: string;
  apiKey: string;
}

/**
 * 解析 Jev 相关环境变量。
 * JEV_ENABLED 缺省为 false（默认关闭 → 行为与接入前完全一致）。
 */
export function resolveJevConfig(env: NodeJS.ProcessEnv = process.env): JevEnvConfig {
  const enabled = env.JEV_ENABLED === 'true' || env.JEV_ENABLED === '1';
  return {
    enabled,
    baseURL: (env.JEV_BASE_URL ?? JEV_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: env.JEV_MODEL ?? JEV_DEFAULT_MODEL,
    apiKey: (env.JEV_API_KEY ?? '').trim()
  };
}

/** 要求 Jev 已启用且密钥齐全，否则抛错（由调用方决定降级路径） */
export function requireJevConfig(env: NodeJS.ProcessEnv = process.env): JevClientConfig {
  const cfg = resolveJevConfig(env);
  if (!cfg.enabled) {
    throw new Error('JEV_ENABLED 未开启，跳过 Jev 决策');
  }
  if (!cfg.apiKey) {
    throw new Error('未配置 JEV_API_KEY，无法调用 Jev（可配 QUICKROUTER_API_KEY 指向 QuickRouter）');
  }
  return { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, timeoutMs: JEV_DEFAULT_TIMEOUT_MS };
}

// ============================================================
// 客户端
// ============================================================

/**
 * 发起一次 Jev System One 决策请求。
 *
 * 使用 axios 而非原生 fetch：Node 端 axios 会自动继承
 * HTTP_PROXY / HTTPS_PROXY 环境变量（QuickRouter 为海外服务，
 * 在代理环境下 curl 可通但 undici fetch 会超时——见实际部署反馈）。
 *
 * @throws JevRequestError 当网络失败、超时、非 2xx 或响应缺少 answers 时
 */
export async function requestJevDecisions(
  config: JevClientConfig,
  state: string,
  questions: JevQuestions,
  options: { axiosImpl?: typeof axios } = {}
): Promise<JevResponse> {
  const axiosImpl = options.axiosImpl ?? axios;
  const timeoutMs = config.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
  const url = `${config.baseURL}/v1/systemone`;

  let response;
  try {
    response = await axiosImpl.post(url, {
      model: config.model,
      state,
      questions
    }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      timeout: timeoutMs
    });
  } catch (error) {
    // axios 超时/网络错误
    if (axiosImpl.isAxiosError(error)) {
      const status = error.response?.status;
      const detail = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data ?? '');
      throw new JevRequestError(
        status
          ? `Jev 返回 HTTP ${status}${detail ? `：${detail.slice(0, 300)}` : ''}`
          : `Jev 请求失败：${error.message}`,
        { status, cause: error }
      );
    }
    throw new JevRequestError(`Jev 请求失败：${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  const data = response.data as JevResponse;
  if (!data || typeof data.answers !== 'object' || data.answers === null) {
    throw new JevRequestError('Jev 响应缺少 answers 字段');
  }
  return data;
}

/** 从响应中取单个问题答案，缺失或类型不符时抛错（保持类型安全） */
export function answerOf(response: JevResponse, key: string): JevAnswer {
  const answer = response.answers?.[key];
  if (!answer || typeof answer !== 'object') {
    throw new JevRequestError(`Jev 响应缺少答案 "${key}"`);
  }
  return answer as JevAnswer;
}

/** noul 答案取概率值（0~1），缺失时抛错 */
export function noulValue(response: JevResponse, key: string): number {
  const a = answerOf(response, key);
  if (a.type !== 'noul' || typeof a.noul !== 'number') {
    throw new JevRequestError(`答案 "${key}" 不是合法的 noul 类型`);
  }
  return a.noul;
}

/** score 答案取分数（0~len-1），缺失时抛错 */
export function scoreValue(response: JevResponse, key: string): number {
  const a = answerOf(response, key);
  if (a.type !== 'score' || typeof a.score !== 'number') {
    throw new JevRequestError(`答案 "${key}" 不是合法的 score 类型`);
  }
  return a.score;
}

/** choice 答案取所选选项，缺失时抛错 */
export function choiceValue(response: JevResponse, key: string): string {
  const a = answerOf(response, key);
  if (a.type !== 'choice' || typeof a.choice !== 'string') {
    throw new JevRequestError(`答案 "${key}" 不是合法的 choice 类型`);
  }
  return a.choice;
}
