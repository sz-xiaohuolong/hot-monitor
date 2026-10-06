# Release Verification — v1

## Control

- Release: `v1`
- Effective SPEC: `SPEC.md`
- Quality Profile: `Standard`
- Verification Status: `VERIFIED`（REQ-01~05 全部 AC 有 fresh evidence；见矩阵）
- Shipping Authorization: `GRANTED`（2026-10-05 项目负责人明确要求推送至 github.com/sz-xiaohuolong/hot-monter；但本文件只陈述验证事实，不代表后续版本自动获得授权）
- Verified At: 2026-10-05

## Requirement Evidence Matrix

| REQ | AC | Task Delivery Status | Test/Flow | Command/Steps | Result | Evidence | Commit/Artifact | Notes |
|---|---|---|---|---|---|---|---|---|
| REQ-01 | AC-01 | VERIFIED | 新源真实验证 | `npx tsx src/scripts/verifyNewSources.ts Claude` | 6/6 源成功，64 条 | 逐源打印标题/URL/时间 | `2a08ba4` | — |
| REQ-01 | AC-02 | VERIFIED | 回归测试 | `npx vitest run src` | 128→145 passed | 测试文件 | `2a08ba4` | — |
| REQ-01 | AC-03 | VERIFIED | 设计确认 | 掘金/PH 无检索接口，本地过滤 | 行为符合预期 | newSources.test 过滤用例 | `2a08ba4` | 已知限制 |
| REQ-02 | AC-04 | VERIFIED | 真实调用 | `verifyAiConnection.ts`（AI_PROVIDER=ark） | relevance=100，模型 deepseek-v4-flash-ga-260731 | 输出 JSON | `2a08ba4` | — |
| REQ-02 | AC-05 | VERIFIED | 反向验证 | `AI_PROVIDER=openrouter` 覆盖 | 请求发往 openrouter.ai，返回 402 | 日志 | `2a08ba4` | 证明切换生效 |
| REQ-02 | AC-06 | VERIFIED | 单测 | aiProvider.test | 默认 openrouter + 旧变量兼容 | 测试 | `2a08ba4` | — |
| REQ-03 | AC-07 | VERIFIED | API 检查 | `GET /api/scan/health` | 12 源逐条状态，failed=[] | 响应 JSON | `scan_muv7z5nr_1` | — |
| REQ-03 | AC-08 | VERIFIED | 日志检查 | 扫描结束日志 | `信源健康度: juejin=1 csdn=27 ...` | 服务日志 | `scan_muvbuilf_1` | — |
| REQ-04 | AC-09 | VERIFIED | 真实调用 | `verifyJevConnection.ts` | 端到端成功（Jev 决策 + LLM 文本） | 输出 JSON | `2a08ba4` | 验证时 JEV_ENABLED=true |
| REQ-04 | AC-10 | VERIFIED | 生产扫描 | `scan_muvbuilf_1` | `⚡ Jev 拦截` 20 条 | 服务日志 | `scan_muvbuilf_1` | 同上 |
| REQ-04 | AC-11 | VERIFIED | 单测 | jevClient.test「未启用」用例 | 不调用 Jev，行为一致 | 测试 | `2a08ba4` | — |
| REQ-04 | AC-12 | VERIFIED | 单测+实测 | jevClient.test 降级用例；扫描 502→降级 | Jev 失败自动降级 LLM | 测试 + 日志 | `scan_muvbuilf_1` | — |
| REQ-05 | AC-13 | VERIFIED | cron 验证 | `cron.validate('0 */2 * * *')` | true；触发 08:00/10:00... | 输出 | `2a08ba4` | — |
| REQ-05 | AC-14 | VERIFIED | 文案检查 | grep 前端/文档 | 全部"每 2 小时" | 全仓 grep | `2a08ba4` | — |

## Automated Checks

| Check | Command | Time | Result | Evidence |
|---|---|---|---|---|
| Tests | `npx vitest run src` | 2026-10-05 | 145 passed / 11 skipped | 9 test files |
| Typecheck | `npx tsc --noEmit` | 2026-10-05 | OK | — |
| Build (server) | `npm run build` | 2026-10-05 | OK | dist/ |
| Build (client) | `npm run build` | 2026-10-05 | OK | 2142 modules |

## Critical User Flows

| Flow | Environment | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 全量扫描（Jev 开） | localhost:3001 | 完成，新热点入库 | 24 新热点，841s，Jev 拦截 20 条 | `PASS` | `scan_muvbuilf_1` |
| 全量扫描（Jev 关，当前态） | localhost:3001 | 完成，纯 LLM | 运行正常（关闭后重启验证） | `PASS` | 服务日志 |
| 健康度 API | localhost:3001 | 12 源状态 | 返回逐条状态 | `PASS` | `/api/scan/health` |

## Risk-specific Checks

- Migration: 不适用（无数据迁移；`Hotspot.source` 为 String 无枚举）
- Security/Permissions: 密钥均入 gitignore 的 `.env`；`JEV_API_KEY` 曾在对话暴露 → **建议轮换**（未完成）
- Performance: Jev 层 70-500ms/条（实测）；Ark 5h 配额限制（实测 429，独立瓶颈）
- Observability/Recovery: 健康度账本内存态（重启清空）；Jev/AI 失败均降级不中断

## Traceability and Docs Consistency

- All REQ/AC covered: `Yes`（5 REQ / 14 AC 全 VERIFIED）
- TECH_DESIGN reflects current architecture: `Yes`
- PROGRESS reflects actual state: `Yes`
- Released artifacts remain sealed: `Yes`（v1 已推送 `4501029`）

## Unverified / Blocked Items

- 无未验证 AC。
- 已知缺口（非本 Release 未完成，均记录于 TECH_DESIGN Known Gaps / SPEC BND）：
  1. 旧 6 源内部吞错 → 健康表无法识别其失败（如 Twitter 欠费显示 ok:true, items:0）。
  2. JEV_API_KEY 暴露，轮换未执行（安全项，负责人待办）。

## Final Decision

- Ready To Ship: `Yes`（基于证据）
- Evidence-based Reason: 5 REQ / 14 AC 全部有 fresh evidence，自动化检查全绿，生产扫描端到端通过。
- Human Shipping Decision: `GRANTED`（2026-10-05，负责人要求推送 sz/hot-monter）
  - 注意：Shipping Authorization 是本次 v1 的明确授权；验证状态与 shipping 是两个独立 Gate。

Shipping Authorization 不改变 Verification Status；风险接受不能把未知结果写成通过。
