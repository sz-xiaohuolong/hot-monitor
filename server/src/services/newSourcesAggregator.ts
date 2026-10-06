import type { SearchResult } from '../types.js';
import {
  runSource,
  recordHealth,
  toHealth,
  type SourceOutcome
} from './sourceHealth.js';
import {
  searchJuejin,
  searchCsdn,
  searchOschina,
  searchGithub,
  searchProductHunt,
  searchWeixinSogou
} from './newSources.js';

/**
 * 新增信源的调用清单。
 * 每个条目独立执行，单点失败不影响其他信源；失败会被记录为信源健康度，
 * 而不是静默变成 0 条。
 */
export interface NewSourceEntry {
  name: string;
  runner: (query: string) => Promise<SearchResult[]>;
}

export const NEW_SOURCES: NewSourceEntry[] = [
  { name: 'juejin', runner: searchJuejin },
  { name: 'csdn', runner: searchCsdn },
  { name: 'oschina', runner: searchOschina },
  { name: 'github', runner: searchGithub },
  { name: 'producthunt', runner: searchProductHunt },
  { name: 'weixin', runner: searchWeixinSogou }
];

/**
 * 并行抓取全部新增信源，并把健康度写入账本。
 *
 * 使用 runSource 包装的原因：让「抛异常」而不是「返回空数组」成为失败的信号，
 * 这样欠费、被反爬、接口变更都能在日志与前端显式暴露。
 */
export async function searchNewSources(query: string): Promise<SearchResult[]> {
  const outcomes = await Promise.all(
    NEW_SOURCES.map(async (entry): Promise<{ entry: NewSourceEntry; outcome: SourceOutcome; durationMs: number }> => {
      const startedAt = Date.now();
      const outcome = await runSource(entry.name, () => entry.runner(query));
      return { entry, outcome, durationMs: Date.now() - startedAt };
    })
  );

  const merged: SearchResult[] = [];
  for (const { entry, outcome, durationMs } of outcomes) {
    recordHealth(toHealth(entry.name, outcome, durationMs));
    if (outcome.status === 'error') {
      console.warn(`  ⚠️ ${entry.name} 抓取失败: ${outcome.error}`);
    }
    merged.push(...outcome.items);
  }

  return merged;
}
