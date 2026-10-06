# Proposed Technical Design — v1（历史记录，已实现）

## Control

- Proposal ID: `DESIGN-v1`
- Target Release: `v1`
- Status: `IMPLEMENTED`（存量接管：功能已实现并验证后才冻结 v1；本文件作为设计决策的历史记录）
- Related REQ/AC: 见 `SPEC.md` REQ-01~05
- Related Decisions: 决策记录并入本文件（决策 D1/D2，原 DEC-001/DEC-002）
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

### 关键设计决策（含选项对比与批准记录）

> 2026-10-05 起，决策记录（DEC-xxx.md）不再单列，统一并入本文件；历史 DEC 内容见下方各决策小节。

| 决策 | 方案 | 依据 |
|---|---|---|
| AI Provider 抽象 | 纯 fetch OpenAI 兼容客户端 + env 惰性读取 | 见「决策 D1」 |
| Jev 接入 | QuickRouter `/v1/systemone` + `jev-1.13.0`，axios（代理） | 见「决策 D2」 |
| Jev 定位 | 保守粗筛（isReal<0.15 或 relevance=0 拦截），幸存者 LLM 精判 | 见「决策 D2」 |
| 新源错误语义 | 失败抛异常 → 健康度账本 | 失败静默修复 |
| 扫描频率 | cron `0 */2 * * *`（代码内固定） | 单轮 16min + 第三方计费 |

#### 决策 D1 — AI Provider 抽象（原 DEC-001）

- **上下文**：原实现硬编码 `@openrouter/sdk`，模型写死两处，客户端 import-time 读取 env（切换不生效）；需求是 OpenRouter ↔ 火山方舟通过配置切换。
- **证据**：实测 Ark `/chat/completions` 返回 401（端点真实）；SDK import-time 构造导致测试改 env 不生效；Ark 真实调用成功（`deepseek-v4-flash-ga-260731`）。
- **选项**：
  - A（采纳）纯 fetch 客户端：零依赖、baseURL 任意可配、错误透明、行为可控；成本是自写 ~130 行。
  - B @openrouter/sdk + serverURL 覆盖：复用依赖，但会把 OpenRouter 专有 header 带到 Ark、控制力弱。
  - C 双适配器并存：维护成本翻倍。
- **批准**：项目负责人 2026-10-05（transport=纯 fetch；model_map=按 provider 默认模型 env 可覆盖；provider_values=openrouter|ark；runtime_config=仅 .env；key_migration=向后兼容）。拒绝 B、C；追加决策 Gitee/知乎/Reddit 本轮不做。
- **后续**：`@openrouter/sdk` 已成死依赖，删除需动 package.json + lockfile（未执行，待决定）。

#### 决策 D2 — Jev 决策预筛（原 DEC-002）

- **上下文**：`analyzeContent` 每条内容调一次 LLM（Ark），全量扫描 ~450 条/轮、AI 阶段 10-20 分钟；Jev 是判别式 System One 模型（不产文本、类型化概率输出、输出 token 免费）。
- **证据**：QuickRouter（负责人充值，非 OpenRouter）模型目录含 `jev-1.13.0`（`POST /v1/systemone`）；三种 primitive 实测正常；**关键调优发现**——Jev 对真实内容 isReal 不稳定（0.22 vs 0.69），但对垃圾区分度好（营销 0.03、标题党 0.20）；代理环境原生 fetch 超时、axios 正常。
- **选项**：
  - A（采纳）保守粗筛 + LLM 全量精判：零误杀、幸存者决策质量与现状一致、Jev 失败自动降级。
  - B Jev 决策 + LLM 只生成文本：LLM 调用量最低，但实测 isReal 不稳定会误杀真实新闻，放弃。
  - C 不接入：维持 Ark 单点成本与配额瓶颈（429 实证）。
- **批准**：项目负责人 2026-10-05，Option A。拒绝 B（会误杀）、C。
- **后续**：JEV_API_KEY 曾在对话暴露，建议轮换；Ark 5h 配额限制是独立瓶颈；`jev-1.13.0` 固定版本更稳定。

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
- Human Gates 已过：provider 切换（会话问答，决策 D1）、Jev 接入（决策 D2）

> 本文件是 v1 设计的历史记录；当前真实架构以 living `docs/vibe/TECH_DESIGN.md` 为准。
