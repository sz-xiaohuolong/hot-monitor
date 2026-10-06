# Proposed Technical Design — Jev 决策预筛层

## Control

- Proposal ID: `DESIGN-002`
- Target Release: 待定（当前无正式 Release）
- Status: `IMPLEMENTED`（2026-10-05 实现并真实验证；设计阶段对原方案的调整见下方「实现与设计差异」）
- Related REQ/AC: docs/REQUIREMENTS.md §5（AI 分析）、AI 审核 P0
- Related Decisions: `DEC-001`（provider 抽象，本设计在其之上叠加）；`DEC-002`（Jev 接入）
- Owner: 项目负责人
- Last Updated: 2026-10-05

## Goal and Constraints

- Goal: 在现有 `analyzeContent` 的 LLM 审核之前，增加一层 **Jev 决策预筛**（`typesafe/jev-1.13`，走 OpenRouter `POST /api/alpha/decisions`）。只有 Jev 判定"值得保留"的条目，才调用 Ark 生成 `relevanceReason` + `summary` 两段文本。目标：AI 阶段成本降一个数量级、延迟降一个数量级，同时保持对外行为（AIAnalysis 结构）不变。
- In Scope:
  - 新增 `server/src/services/jevClient.ts`：OpenRouter Decisions API 客户端（`state` + `questions`，映射 noul/score/choice 三种 primitive）
  - `analyzeContent` 重构为两级流水线：Jev 决策 →（幸存）→ Ark 生成
  - 阈值语义：Jev 的 `relevance` score 与现有 `relevance<50` 过滤规则的映射
  - Jev 不可用时的降级路径（退回纯 Ark 全量，即现状）
- Out of Scope:
  - `expandKeyword` 迁移到 Jev（**不可行**：Jev 不生成文本）
  - 用 Jev 替换 Ark 成为唯一 provider（**不可行**：reason/summary 是自由文本）
  - 前端 UI 改动（AIAnalysis 对外结构不变）
  - TypeSafe 直连（保持 OpenRouter 单一入口）
- Constraints:
  - 不改变 `AIAnalysis` 接口结构（`routes/hotspots.ts` 与前端消费方零改动）
  - 不改变"未配置密钥 → fallback"的既有降级契约
  - Jev 上下文窗口 32K token：state 需裁剪（现 content 已 `slice(0,2000)`）

## Proposed Architecture

```
每条条目（title + content）
  → jevClient.decide(state, questions)         [70-500ms, 输出免费]
       questions:
         isReal:          { type: 'noul',   criteria: {...} }
         relevance:       { type: 'score',  criteria: [0-100 分档] }
         keywordMentioned:{ type: 'noul',   criteria: {...} }
         importance:      { type: 'choice', criteria: [low, medium, high, urgent] }
  → 阈值判定（Jev 概率/分数 vs 阈值，见 Interfaces）
      ├─ 不通过 → 丢弃（零成本）
      └─ 通过   → arkChatCompletion（现有 openaiCompatibleClient）
                    生成 relevanceReason + summary
                 → 合并为完整 AIAnalysis 返回
```

- 组件：`jevClient.ts`（新）、`ai.ts`（重构 `analyzeContent`）、`aiProvider.ts`（不动，Ark 仍由 provider 解析）
- 配置：Jev 走 **同一个 OpenRouter key**（`OPENROUTER_API_KEY`），新增可选 env `JEV_ENABLED=true`（默认 false → 行为与现状完全一致）
- 数据流边界：Jev 只读 state 文本，不落库；Ark 调用逻辑不变

## Interfaces and Compatibility

- Public APIs: 无对外变化（`GET /api/hotspots` 等仍返回完整 AIAnalysis）
- Internal Contracts:
  - `jevClient.decide(state: string, questions: JevQuestions): Promise<JevAnswers>`
  - `JevAnswers`: `{ isReal: number; relevance: number; keywordMentioned: number; importance: { choice: string; probabilities: Record<string, number> } }`
  - `analyzeContent` 签名不变，内部拆两级
- Compatibility Impact:
  - `AIAnalysis` 结构不变；`relevanceReason`/`summary` 仍由 Ark 生成 → 前端、入库、排序零改动
  - `relevance` 语义变化：由 Jev score 提供（0-1 概率加权位置 → 映射 0-100），需在阈值处校准
- Migration/Coexistence: `JEV_ENABLED=false`（默认）时与现状逐字节等价；开关切换无需迁移

## Data, Security, and External Boundaries

- Data/Schema Impact: 无 Schema 变更；`Hotspot.source` 等不动
- Auth/Permission Impact: 复用既有 `OPENROUTER_API_KEY`（无新 Secret）；新增 `JEV_ENABLED` 开关
- Privacy/Compliance: 条目正文/标题将发送至 OpenRouter（→ TypeSafe）；与现有 Ark 发送为同类数据边界，需用户知悉
- External Services/Secrets: **新增付费使用**——OpenRouter 余额计费（估算 $0.011/轮全量）；账户当前 0 余额，需充值（$1 ≈ 90 轮）；无新增第三方账号

## Failure and Recovery

- Failure Modes:
  - Jev 调用失败/超时/401 → **降级为纯 Ark 全量**（即现状路径），不中断扫描
  - Jev 概率处于阈值边界 → 由阈值参数决定，可调
  - Ark 生成阶段失败 → 沿用现有 fallback（默认分数）
- Retry/Idempotency: Jev 调用一次无重试（决策无副作用，可安全重试）；Ark 阶段维持现状
- Rollback/Recovery: `JEV_ENABLED=false` 即完整回滚；无迁移

## Verification Design

| REQ/AC | Planned Test/Check/Flow | Expected Evidence |
|---|---|---|
| AI 审核 P0（行为不回归） | `JEV_ENABLED=false` 跑现有 `aiRelevance.test.ts` 全量 | 128 passed（现状回归） |
| Jev 决策映射 | mock `jevClient` 单测：noul→isReal、score→relevance、choice→importance 映射正确 | 新增单测全绿 |
| 两级流水线 | mock Jev 通过/不通过两分支：通过→调用 Ark；不通过→零 Ark 调用 | 断言调用次数 |
| 阈值语义 | Jev score 0-1 → 0-100 映射 + 过滤规则参数化 | 阈值单测 |
| 降级路径 | mock Jev 抛错 → 走 Ark 全量、结果与现状一致 | 集成测试 |
| 真实调用（可选，需充值） | `npx tsx src/scripts/verifyJevConnection.ts` 单条真实 Jev 调用 | 真实响应 JSON |

## Approval

- Required Human Gates:
  1. **新外部付费服务**：OpenRouter 充值与 Jev 用量授权（金额/频率）
  2. **数据边界**：条目文本发往 OpenRouter/TypeSafe 的知情同意
  3. **架构变更**：`analyzeContent` 两级化 + 阈值语义调整
- Decision: `APPROVED`（2026-10-05，项目负责人）
- Approved By/At: 项目负责人，2026-10-05；实际接入走 QuickRouter 中转（`api.quickrouter.ai`，模型 `jev-1.13.0`），key 由负责人提供

## 实现与设计差异（实现中发现并修正）

1. **接入通道改为 QuickRouter 而非 OpenRouter**：负责人充值的是 QuickRouter（OpenAI 兼容中转），其模型目录含 `jev-1.13.0`，走 `POST /v1/systemone`（TypeSafe System One 协议）。原设计的 OpenRouter `/api/alpha/decisions` 无需使用。
2. **Jev 从"最终决策者"降级为"保守粗筛"**：真实调用发现 Jev 对真实内容的 `isReal` 判定不稳定（同属真实新闻，noul 0.22 vs 0.69），但对垃圾内容区分度极好（营销软文 0.03、标题党 0.20）。因此改为：Jev 只拦截**明确垃圾**（`isReal < 0.15` 或 `relevance score = 0`），幸存者仍走 LLM 全量精判 —— 既不误杀真实内容，又保住成本收益。原设计的"幸存者由 LLM 只生成文本字段"被放弃。
3. **代理支持**：QuickRouter 为海外服务，本机经 HTTP 代理（127.0.0.1:7890）访问。客户端改用 axios（Node 端自动继承 `HTTP_PROXY/HTTPS_PROXY` 环境变量），原生 fetch（undici）在代理环境下会超时。
4. **环境变量**：`JEV_ENABLED`（默认 false）/ `JEV_API_KEY` / `JEV_BASE_URL` / `JEV_MODEL`。

实现与验证完成前，不得把本文件内容合并为 living `TECH_DESIGN.md` 的当前事实。
（注：本设计已实现并验证，当前架构事实见 `TECH_DESIGN.md`。）
