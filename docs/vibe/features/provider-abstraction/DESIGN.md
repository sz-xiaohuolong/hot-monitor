# Design — AI Provider 抽象

- Feature: `provider-abstraction`
- Status: `IMPLEMENTED`（2026-10-05 实现并验证）
- 决策: 见 `DEC.md`（Option A：纯 fetch OpenAI 兼容客户端）

## 目标架构

```
配置（.env）→ aiProvider.ts 解析 → openaiCompatibleClient.ts 请求
                                   → ai.ts（expandKeyword / analyzeContent）
```

## 组件

| 组件 | 职责 | 关键点 |
|---|---|---|
| `services/aiProvider.ts` | provider 解析 | `AI_PROVIDER` 缺省=openrouter；`AI_API_KEY` 通用覆盖；**env 惰性读取**（每次调用重读，切换立即生效） |
| `services/openaiCompatibleClient.ts` | OpenAI 兼容 Chat Completions 客户端 | fetch 实现，60s 超时，非 2xx 显式抛 `ChatCompletionError` |

## 关键设计

1. **Provider 表**：`openrouter` → baseURL `https://openrouter.ai/api/v1` + 模型 `deepseek/deepseek-v3.2`；`ark` → baseURL `https://ark.cn-beijing.volces.com/api/plan/v3` + 模型 `doubao-seed-1-6`（默认占位，须 `ARK_MODEL` 覆盖）。
2. **密钥优先级**：`AI_API_KEY` > provider 专属变量（`ARK_API_KEY` / `OPENROUTER_API_KEY`）。
3. **惰性读取**：原客户端 import-time 构造导致改 env 不生效；现每次调用 `resolveProviderConfig()`。
4. **错误语义**：网络/HTTP/解析错误抛 `ChatCompletionError`（带 status + 厂商原文），由 `ai.ts` 决定 fallback。
5. **兼容性**：`OPENROUTER_API_KEY` 旧变量名保留；无 `AI_PROVIDER` 时行为与接入前一致。

## 兼容性影响

- `AIAnalysis` 结构不变；调用方（hotspotChecker / routes）零改动。
- 移除 `@openrouter/sdk` 依赖（代码层），package.json 中仍未删除（见 Known Gaps）。
