import type { SearchResult } from '../types.js';

/**
 * 单个信源的抓取结果。
 *
 * 与直接返回数组的区别：显式区分「成功但没搜到」和「抓取失败」。
 * 这两件事在旧实现里都是 `[]`，导致信源断供（欠费/被反爬/接口变更）
 * 在日志里只表现为一行平淡的 "0 results"，无法与"今天确实没热点"区分。
 */
export type SourceOutcome =
  | { status: 'ok'; items: SearchResult[] }
  | { status: 'error'; items: SearchResult[]; error: string };

export interface SourceHealth {
  name: string;
  /** 本轮是否成功返回（即使 0 条也算成功） */
  ok: boolean;
  /** 本轮抓到条数 */
  items: number;
  /** 失败原因，成功时为 null */
  error: string | null;
  /** 本轮耗时（毫秒） */
  durationMs: number;
}

const EMPTY: SearchResult[] = [];

/**
 * 包装一个信源抓取函数，把「失败」从「空结果」里分离出来。
 *
 * 旧实现里各 collector 自己 try/catch 后返回 []，失败信息在返回之前就丢了，
 * 外层再怎么检查也无法察觉。这里把调用与结果判定收口到一处：
 * 抛出异常 = error；正常返回空数组 = ok（真的没搜到）。
 */
export async function runSource(
  name: string,
  fn: () => Promise<SearchResult[]>
): Promise<SourceOutcome> {
  const startedAt = Date.now();
  try {
    const items = await fn();
    const list = Array.isArray(items) ? items : EMPTY;
    return { status: 'ok', items: list };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', items: EMPTY, error: message.slice(0, 300) };
  }
}

/**
 * 把 outcome 折叠成一行健康度记录。
 * durationMs 由调用方传入，以便统计包含重试在内的真实耗时。
 */
export function toHealth(name: string, outcome: SourceOutcome, durationMs: number): SourceHealth {
  return {
    name,
    ok: outcome.status === 'ok',
    items: outcome.items.length,
    error: outcome.status === 'error' ? outcome.error : null,
    durationMs
  };
}

// ============================================================
// 健康度账本
// ============================================================

let lastRun: SourceHealth[] = [];
let lastRunAt: Date | null = null;

/** 每轮扫描开始时调用，清空上一轮结果 */
export function resetHealth(): void {
  lastRun = [];
  lastRunAt = null;
}

/** 记录一个信源的本轮健康度 */
export function recordHealth(health: SourceHealth): void {
  lastRun = lastRun.filter(h => h.name !== health.name);
  lastRun.push(health);
  lastRunAt = new Date();
}

/** 读取本轮健康度快照（供 API 与日志使用） */
export function getHealthSnapshot(): { checkedAt: Date | null; sources: SourceHealth[] } {
  return { checkedAt: lastRunAt, sources: [...lastRun] };
}

/**
 * 生成可直接打进日志的摘要行。
 * 失败的信源用 ❌ 显式标出，避免继续静默。
 */
export function formatHealthLine(): string {
  const { sources } = getHealthSnapshot();
  if (sources.length === 0) return '信源健康度：本轮无记录';
  const parts = sources.map(s =>
    s.ok ? `${s.name}=${s.items}` : `${s.name}=❌${s.error ?? 'failed'}`
  );
  const failed = sources.filter(s => !s.ok).map(s => s.name);
  const tail = failed.length > 0 ? `  ⚠️ 失败信源: ${failed.join(', ')}` : '';
  return `信源健康度: ${parts.join(' ')}${tail}`;
}
