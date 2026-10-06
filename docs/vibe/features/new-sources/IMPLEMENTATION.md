# Implementation — 新增 6 个信息源

- Feature: `new-sources`
- Status: `IMPLEMENTED`（2026-10-05）

## 变更文件

| 文件 | 变更 |
|---|---|
| `server/src/services/newSources.ts` | **新增**：6 个 collector + stripHtml + matchesKeyword + RateLimiter |
| `server/src/services/newSourcesAggregator.ts` | **新增**：`searchNewSources` 并行聚合 + 健康度写入 |
| `server/src/services/sourceHealth.ts` | **新增**：`SourceOutcome`/`runSource`/`toHealth`/账本（详见 scan-health 功能） |
| `server/src/types.ts` | `SearchResult.source` 扩展 6 值（juejin/csdn/oschina/github/producthunt/weixin） |
| `server/src/jobs/hotspotChecker.ts` | 接入 `searchNewSources`；优先级表扩展 6 源 |
| `server/src/__tests__/newSources.test.ts` | **新增**：26 项（mock，含失败必须抛异常回归） |
| `server/src/__tests__/newSourcesAggregator.test.ts` | **新增**：6 项（单点失败不影响其他源） |
| `client/src/App.tsx` | 源图标/标签映射扩展 |
| `client/src/components/FilterSortBar.tsx` | 源筛选选项扩展 |
| `client/src/scripts/verifyNewSources.ts` | **新增**：逐源真实验证脚本 |
| `skills/hot-monitor/references/search-sources.md` | 新源文档章节 |

## 实现要点

- 掘金 ctime 是**秒**级时间戳字符串（曾误当毫秒，测试捕获后修正）。
- Product Hunt 是 **Atom** 格式：解析 `<entry>` 而非 `<item>`；content 是 HTML 实体编码，须**先解码实体再去标签**（单测捕获顺序 bug）。
- GitHub 限流/鉴权错误以 HTTP 200 + `message` 字段返回，须显式抛错而非当空结果。
- OSChina 的 url 在 `data-url` 属性，`.news-item` 也会匹配到作者行，须限定 `#newsList` 作用域。
