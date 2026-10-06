# Verification — 新增 6 个信息源

- Feature: `new-sources`
- Status: `VERIFIED`（fresh evidence，2026-10-05）

## 测试证据

| 范围 | 命令 | 结果 |
|---|---|---|
| collector 单测 | `npx vitest run src/__tests__/newSources.test.ts` | 26 passed |
| 聚合器单测 | `npx vitest run src/__tests__/newSourcesAggregator.test.ts` | 6 passed |
| 类型检查 | `npx tsc --noEmit` | OK |

## 真实运行证据（逐源独立验证）

`npx tsx src/scripts/verifyNewSources.ts Claude` → **6/6 源成功，共 64 条**：

| 源 | 条数 | 证据 |
|---|---|---|
| 掘金 | 3 | 真实文章标题/URL/ctime |
| CSDN | 30 | 标题高亮清理、view 数 |
| OSChina | 2 | 真实资讯 |
| GitHub | 15 | stars/owner |
| Product Hunt | 4 | Atom 解析 |
| 微信公众号 | 10 | 标题 + 时间戳 |

## 生产端到端证据

- 全量扫描（`scan_muv7z5nr_1`）：新源入库 `github=13, weixin=5, oschina=1`。
- 掘金 / CSDN / Product Hunt 在真实扫描中被相关性阈值过滤（预期行为，非故障——推荐流无关键词接口）。

## 结论

REQ-SRC-01 ~ 07 全部满足。
