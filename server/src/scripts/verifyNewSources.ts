/**
 * 新增信源真实验证（访问真实端点，不使用 mock）
 *
 * 用法：
 *   npx tsx src/scripts/verifyNewSources.ts [关键词]
 *
 * 输出每个源的真实条数与前 2 条样例，失败源会明确标出。
 * 这是「新源独立验证」的 fresh evidence 来源。
 */

import {
  searchJuejin,
  searchCsdn,
  searchOschina,
  searchGithub,
  searchProductHunt,
  searchWeixinSogou
} from '../services/newSources.js';
import type { SearchResult } from '../types.js';

const keyword = process.argv[2] || 'Claude';

const SOURCES: Array<{ name: string; fn: (q: string) => Promise<SearchResult[]> }> = [
  { name: 'juejin', fn: searchJuejin },
  { name: 'csdn', fn: searchCsdn },
  { name: 'oschina', fn: searchOschina },
  { name: 'github', fn: searchGithub },
  { name: 'producthunt', fn: searchProductHunt },
  { name: 'weixin', fn: searchWeixinSogou }
];

console.log(`关键词: "${keyword}"\n${'='.repeat(70)}`);

const summary: Array<{ name: string; ok: boolean; count: number; error?: string }> = [];

for (const source of SOURCES) {
  const startedAt = Date.now();
  try {
    const results = await source.fn(keyword);
    const ms = Date.now() - startedAt;
    summary.push({ name: source.name, ok: true, count: results.length });

    console.log(`\n✅ ${source.name.padEnd(12)} ${String(results.length).padStart(3)} 条  (${ms}ms)`);
    results.slice(0, 2).forEach((r, i) => {
      console.log(`   [${i + 1}] ${r.title.slice(0, 62)}`);
      console.log(`       ${r.url.slice(0, 100)}`);
      console.log(`       pub=${r.publishedAt ? r.publishedAt.toISOString().slice(0, 16) : 'null'}` +
        ` view=${r.viewCount ?? 'null'} author=${r.author?.name ?? '-'}`);
    });
  } catch (error) {
    const ms = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    summary.push({ name: source.name, ok: false, count: 0, error: message });
    console.log(`\n❌ ${source.name.padEnd(12)}  失败  (${ms}ms)`);
    console.log(`   ${message.slice(0, 200)}`);
  }
}

console.log(`\n${'='.repeat(70)}\n汇总:`);
summary.forEach(s =>
  console.log(`  ${s.ok ? '✅' : '❌'} ${s.name.padEnd(12)} ${String(s.count).padStart(3)} 条${s.error ? `  ← ${s.error.slice(0, 70)}` : ''}`)
);
const failed = summary.filter(s => !s.ok);
const total = summary.reduce((n, s) => n + s.count, 0);
console.log(`\n成功 ${summary.length - failed.length}/${summary.length} 个源，共 ${total} 条`);
process.exitCode = failed.length > 0 ? 1 : 0;
