# DEC-002 — Jev（TypeSafe System One）决策预筛接入

- Status: `APPROVED`（已实现并真实验证，见 PROGRESS）
- Date: 2026-10-05
- Related Release: 未建立
- Related REQ/AC: docs/REQUIREMENTS.md §5（AI 分析）
- Related Decisions: DEC-001（provider 抽象，见 `../provider-abstraction/DEC.md`）；本功能 DESIGN（`DESIGN.md`）
- Decision Owner: 项目负责人

## Context and Current Requirement

- 现状：`analyzeContent` 每条内容都调一次 LLM（Ark）做完整判断 + 生成文本，全量扫描 ~450 条/轮，AI 阶段 10-20 分钟。
- 需求：接入 TypeSafe 的 System One 模型 Jev —— 判别式、不生成文本、输出类型化概率决策、速度 70-500ms、**输出 token 免费**（输入 $0.042/MTok）。
- 约束：Jev 不产文本，不能替换 LLM 的摘要能力；需与现有 LLM 组成混合流水线。

## Evidence

- OpenRouter/TypeSafe 官方文档确认 Jev 是判别式模型（"not a drop-in replacement for a chat model"），三种 primitive：Choice / Noul / Score。
- 负责人充值 QuickRouter（非 OpenRouter），其模型目录含 `jev-1.13.0`（协议 `POST /v1/systemone`，分组 `jev-1`）。
- 实测（QuickRouter /v1/systemone）：
  - key 有 Jev 权限；三种 primitive 均正常返回（`noul:0.96`、`score:2.99`+legend、`choice:low`+probabilities）。
  - **关键调优发现**：Jev 对真实内容 isReal 判定不稳定（真实新闻 0.22 vs 0.69），但对垃圾区分度好（营销 0.03、标题党 0.20）→ 决定 Jev 只做保守粗筛，不做最终决策。
  - 代理环境：本机 HTTP 代理 127.0.0.1:7890，原生 fetch（undici）超时，axios 自动走代理成功。

## Options and Trade-offs

### Option A — Jev 保守粗筛 + LLM 全量精判（采纳）

- Benefits: 零误杀（只在明确垃圾时拦截）；幸存者决策质量与现状一致；Jev 失败自动降级 LLM；真实扫描实证拦截 20 条垃圾且 Ark 429 时 Jev 仍独立工作。
- Costs/Risks: LLM 调用量未降到理论上限（仍对幸存者全量调用）；Jev 对"模糊内容"仍需交给 LLM。
- Compatibility: `AIAnalysis` 结构不变；`JEV_ENABLED=false` 时与现状逐字节等价。

### Option B — Jev 决策 + LLM 只生成文本（原方案）

- Benefits: LLM 调用量降到最低（只生成两段文本）。
- Costs/Risks: **实测发现 Jev isReal 不稳定，会把真实新闻判为不真实 → 大量误杀**；最终 relevance/importance 语义漂移。
- Decision: 实测后放弃。

### Option C — 不接入

- Costs/Risks: 维持 Ark 单点成本与配额瓶颈（本轮 Ark 429 配额耗尽即为实证）。

## Recommendation

Option A。理由：实测驱动——Jev 的可靠价值在于快速拦截明确垃圾（免费、快），而非替代 LLM 决策；保守粗筛同时保住成本收益与行为兼容。

## Human Decision

- Decision: `APPROVED`
- Approved Option: A（保守粗筛 + LLM 全量精判）
- Approved By/At: 项目负责人，2026-10-05
- Rejected Alternatives: B（Jev 决策字段替代 LLM，实测会误杀）；C（不接入）

## Impact and Follow-up

- TECH_DESIGN: 已合并（§Components jevClient；`analyzeContent` 两级流水线）
- Tests: `jevClient.test.ts`（17）+ 既有 `aiRelevance.test.ts` 回归（128→145 全量）
- Env: `JEV_ENABLED`/`JEV_API_KEY`/`JEV_BASE_URL`/`JEV_MODEL`（示例见 .env.example）
- 后续:
  - **安全**：负责人的 JEV_API_KEY 已在对话中暴露，建议接入验证完成后轮换。
  - Ark 5 小时配额限制是独立瓶颈（429），与 Jev 无关；可考虑把幸存者 LLM 通道同样指向 QuickRouter 或提高 Ark 配额。
  - `jev-1.13.0` 模型版本可能更新（`~typesafe/jev-latest` 别名），当前固定版本更稳定。
