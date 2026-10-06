# Implementation — AI Provider 抽象

- Feature: `provider-abstraction`
- Status: `IMPLEMENTED`（2026-10-05）

## 变更文件

| 文件 | 变更 |
|---|---|
| `server/src/services/aiProvider.ts` | **新增**：provider 解析、`ProviderConfigError`/`ApiKeyMissingError`、`requireProviderConfig` |
| `server/src/services/openaiCompatibleClient.ts` | **新增**：OpenAI 兼容 Chat Completions 客户端、`ChatCompletionError`、`extractMessageContent` |
| `server/src/services/ai.ts` | 移除 `@openrouter/sdk`；`requestCompletion` 统一入口；两处调用点改走 provider 层 |
| `server/src/__tests__/aiProvider.test.ts` | **新增**：21 项（解析/模型/密钥/惰性读取） |
| `server/src/__tests__/aiProviderSwitch.integration.test.ts` | **新增**：7 项（配置→实际请求断言） |
| `server/src/__tests__/aiRelevance.test.ts` | 适配 `HAS_API_KEY` 判定与 fallback 断言 |
| `server/.env.example` | 新增 `AI_PROVIDER`/`ARK_API_KEY`/`ARK_MODEL`/`AI_API_KEY`/`AI_MODEL`/`AI_BASE_URL` 说明 |

## 实现要点

- `requireProviderConfig()` 在缺 key 时抛 `ApiKeyMissingError` → `ai.ts` 捕获后走规则化 fallback（与既有行为一致）。
- fallback 分数统一为 30/10（原"无 Key 分支 50/20"与"失败分支 30/10"合并）。

## 相关决策

见 `DEC.md`。
