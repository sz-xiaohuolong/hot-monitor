# Proposed Technical Design — v1（历史记录，已实现）

## Control

- Proposal ID: `DESIGN-v1`
- Target Release: `v1`
- Status: `IMPLEMENTED`（存量接管：功能已实现并验证后才冻结 v1；本文件作为设计决策的历史记录）
- Related REQ/AC: 见 `SPEC.md` REQ-01~05
- Related Decisions: `../decisions/DEC-001-provider-abstraction.md`、`../decisions/DEC-002-jev-prefilter.md`
- Last Updated: 2026-10-05

## Goal and Constraints

- Goal: 多信源聚合 + AI 判定 + 健康度可观测 + 可选 Jev 预筛，解决供应商锁定、信源单一、失败静默、成本过密。
- Constraints: `AIAnalysis` 结构不变；`JEV_ENABLED=false` 与接入前逐字节等价；新源失败必须抛异常（不静默）。

## Proposed Architecture（v1 目标，均已实现）

```
cron 2h / 手动 → scanManager（单飞锁）→ hotspotChecker（逐关键词）
  → 12 信源并行抓取（6 旧 + 6 新）
  → 去重/新鲜度/优先级/配额
  → AI 审核：Jev 粗筛(可选) → LLM 全量精判
  → 入库 + WS 推送 + 邮件
  → 信源健康度账本 → GET /api/scan/health → 前端横幅
```

### 关键设计决策（各自对应的 DEC）

| 决策 | 方案 | 依据 |
|---|---|---|
| AI Provider 抽象 | 纯 fetch OpenAI 兼容客户端 + env 惰性读取 | DEC-001（实测 Ark 端点 + SDK import-time 快照问题） |
| Jev 接入 | QuickRouter `/v1/systemone` + `jev-1.13.0`，axios（代理） | DEC-002（负责人充值 QuickRouter；代理环境实测） |
| Jev 定位 | 保守粗筛（isReal<0.15 或 relevance=0 拦截），幸存者 LLM 精判 | DEC-002（实测 isReal 对真实内容不稳定 0.22~0.69，垃圾区分度好） |
| 新源错误语义 | 失败抛异常 → 健康度账本 | 失败静默修复 |
| 扫描频率 | cron `0 */2 * * *`（代码内固定） | 单轮 16min + 第三方计费 |

## Interfaces and Compatibility

- `AIAnalysis` 对外结构不变；`SearchResult.source` 扩展 6 值。
- 新增 env：`AI_PROVIDER`/`ARK_API_KEY`/`AI_MODEL`/`AI_BASE_URL`/`JEV_ENABLED`/`JEV_API_KEY`/`JEV_BASE_URL`/`JEV_MODEL`。
- 兼容：`OPENROUTER_API_KEY` 旧变量保留。

## Failure and Recovery

- 信源失败 → 健康度记录（新源抛异常；旧源吞错为已知缺口）。
- Jev 失败 → 降级 LLM 全量。
- AI 不可用 → 规则化 fallback（30/10）。
- Ark 429 配额 → fallback，不中断（Jev 层仍独立工作）。

## Verification Design

见 `VERIFICATION.md`（逐项 AC 证据矩阵）。

## Approval

- Decision: `APPROVED`（2026-10-05，项目负责人，随各功能会话确认）
- Human Gates 已过：provider 切换（会话问答）、Jev 接入（PROPOSED_DESIGN-jev-prefilter 批准（现并入 releases/v1/PROPOSED_DESIGN.md）+ DEC-002）

> 本文件是 v1 设计的历史记录；当前真实架构以 living `docs/vibe/TECH_DESIGN.md` 为准。
