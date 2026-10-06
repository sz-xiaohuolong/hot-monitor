# DEC-001 — AI Provider 抽象（openrouter / 火山方舟可切换）

- Status: `APPROVED`（已实现并验证，见 PROGRESS）
- Date: 2026-10-05
- Related Release: 未建立
- Related REQ/AC: docs/REQUIREMENTS.md §5.1（AI 分析）
- Decision Owner: 项目负责人（本会话问答确认）

## Context and Current Requirement

- 原实现硬编码 `@openrouter/sdk`，模型 `deepseek/deepseek-v3.2` 写死在 `ai.ts` 两处，客户端在模块加载时读取 env 一次。
- 需求：通过配置文件无缝切换 OpenRouter ↔ 火山方舟（`https://ark.cn-beijing.volces.com/api/plan/v3`，OpenAI 兼容协议）。
- 触发问题：模型名两平台不同名；密钥变量不同；env 静态快照导致切换不生效。

## Evidence

- 实测 `POST {ark}/chat/completions` 返回 401 AuthenticationError（端点真实存在，路径正确）。
- 原 SDK 客户端 import-time 构造 → 测试中改 env 不生效（`aiRelevance.test.ts` 依赖 env 覆盖做 fallback 测试）。
- Ark 真实调用成功：模型 `deepseek-v4-flash` → `deepseek-v4-flash-ga-260731`，返回 `reasoning_content` 字段，`content` 正常解析。

## Options and Trade-offs

### Option A — 纯 fetch OpenAI 兼容客户端，协议统一（采纳）

- Benefits: 零新增依赖；baseURL 任意可配（含 `/api/plan/v3` 这种非标准路径）；错误信息透明（HTTP 状态码 + 厂商原文）；行为完全可控。
- Costs/Risks: 需自写约 130 行客户端；放弃 SDK 的轮询/重试等既有能力（本项目不需要）。
- Compatibility/Recovery: 保留 `OPENROUTER_API_KEY` 旧变量向后兼容；`AI_PROVIDER` 缺省 = openrouter，既有 .env 无需改动。

### Option B — 继续用 @openrouter/sdk + serverURL 覆盖

- Benefits: 复用现有依赖。
- Costs/Risks: SDK 会把 OpenRouter 专有 header/校验带到 Ark；对内部行为控制力弱；`/api/plan/v3` 路径兼容性未验证。

### Option C — 双适配器并存

- Costs/Risks: 两套错误处理与响应归一化，维护成本翻倍。未采纳。

## Recommendation

Option A。理由：统一协议、可控错误、兼容用户提供的非标准 baseURL；且实测已验证 Ark 端点可通。

## Human Decision

- Decision: `APPROVED`
- Approved Option: A（纯 fetch 客户端，协议统一）
- Approved By/At: 项目负责人，2026-10-05（会话问答：transport=纯 fetch 客户端；model_map=按 provider 默认模型 env 可覆盖；provider_values=openrouter|ark；runtime_config=仅 .env；key_migration=向后兼容）
- Rejected Alternatives: B、C；追加决策：Gitee/知乎/Reddit 三个受阻信源本轮不做（需 token/登录/OAuth）

## Impact and Follow-up

- TECH_DESIGN: 已合并（§Components aiProvider/openaiCompatibleClient）
- Tests: `aiProvider.test.ts`（21）+ `aiProviderSwitch.integration.test.ts`（7）+ `aiRelevance.test.ts` 同步
- 后续: `@openrouter/sdk` 已成死依赖，删除需动 package.json + lockfile（未执行，待决定）
