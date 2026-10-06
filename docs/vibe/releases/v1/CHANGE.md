# CHANGE — v1

## Release Relationship

- Previous Release: None（v1 为首个正式 Release；此前为无治理的存量工作树）
- Current Release: `v1`
- Requirement Version: `1`

## Added

- 新增 6 信源：掘金 / CSDN / 开源中国 / GitHub（官方 API）/ Product Hunt（Atom RSS）/ 微信公众号（搜狗微信）
- AI Provider 抽象层：`aiProvider.ts` + `openaiCompatibleClient.ts`（openrouter / ark 可切换）
- Jev 决策预筛：`jevClient.ts`（QuickRouter `/v1/systemone`），保守粗筛拦截垃圾
- 信源健康度：`sourceHealth.ts` + `GET /api/scan/health` + 前端告警横幅
- 治理文档：`DOCUMENT_MAP.md`、`docs/vibe/`（PROJECT/PROGRESS/TECH_DESIGN/releases/v1/decisions）

## Changed

- 扫描频率：30 分钟 → 2 小时（cron `*/30` → `0 */2 * * *`，三处同步）
- `ai.ts`：移除 `@openrouter/sdk`，改走 provider 层；fallback 分数统一为 30/10（原 50/20 与 30/10 并存）
- `tsconfig.json`：`module: ESNext` → `NodeNext`（修复构建故障，前置缺陷）

## Removed

- 无（`@openrouter/sdk` 仍留在 package.json，代码零引用，待清理）

## Fixed

- tsconfig 构建故障（`TS5110`，前置缺陷）
- 文档 phantom 变量 `MONITOR_INTERVAL`（代码从未读取，已从 docs 清除）

## Breaking / Migration Notes

- 无破坏性变更。`OPENROUTER_API_KEY` 旧变量兼容；`AIAnalysis` 对外结构不变。
- 存量 `.env` 无需改动即可运行（`AI_PROVIDER` 缺省 = openrouter）。

## Related Requirements and Decisions

- REQ: 见 `SPEC.md`（REQ-01~05）
- DEC: `DEC-001-provider-abstraction.md`、`DEC-002-jev-prefilter.md`

本文件只描述相对上一 Release 的变化；当前完整产品行为以本 Release 的 `SPEC.md` 为准。
