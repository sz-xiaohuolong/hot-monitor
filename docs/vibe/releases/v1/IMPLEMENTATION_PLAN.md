# Implementation Plan — v1

## Control

- Requirement Baseline: `PROJECT_BRIEF.md`
- Effective SPEC: `SPEC.md`
- Current Architecture: `../../TECH_DESIGN.md`
- Proposed Design: `PROPOSED_DESIGN.md`（已实现，历史记录）
- Status: `COMPLETED`（存量接管：v1 功能已实现并验证；本文件为回顾性切片映射）

## Global Constraints

- `AIAnalysis` 对外结构不变；新源失败抛异常；Jev 默认关闭可回滚；每次 Task 需 fresh evidence。

## Slice Map

| Slice | 功能 | REQ/AC | 主要文件 | 验证 | 状态 |
|---|---|---|---|---|---|
| SLICE-01 | AI Provider 抽象 | REQ-02 / AC-04~06 | `aiProvider.ts`、`openaiCompatibleClient.ts`、`ai.ts` | aiProvider.test(21) + integration(7) + verifyAiConnection | `VERIFIED` |
| SLICE-02 | 新增 6 信源 | REQ-01 / AC-01~03 | `newSources.ts`、`newSourcesAggregator.ts`、`types.ts`、hotspotChecker | newSources.test(26) + aggregator.test(6) + verifyNewSources(64 条) | `VERIFIED` |
| SLICE-03 | 信源健康度 | REQ-03 / AC-07~08 | `sourceHealth.ts`、`routes/scan.ts`、App.tsx | sourceHealth.test(10) + 生产扫描 health 快照 | `VERIFIED` |
| SLICE-04 | Jev 决策预筛 | REQ-04 / AC-09~12 | `jevClient.ts`、`ai.ts` | jevClient.test(17) + verifyJevConnection + 生产拦截 20 条 | `VERIFIED`（当前关闭） |
| SLICE-05 | 扫描频率 2h | REQ-05 / AC-13~14 | `index.ts`、App.tsx、docs | cron 验证 + 重启横幅 | `VERIFIED` |

## Integration and Review Gates

- Integration Order: SLICE-01（基础）→ SLICE-02/03（信源+健康度，并行可行）→ SLICE-04（依赖 provider 层）→ SLICE-05（独立）。
- 实际执行按会话顺序推进，无独立 review；验证均含真实运行证据（非仅代码）。
- Release Verification Handoff: `VERIFICATION.md`。

详细执行记录见 `../../PROGRESS.md` 任务状态表（各 Task 的 evidence 与 commit）。
