# Implementation — Jev 决策预筛

- Feature: `jev-prefilter`
- Status: `IMPLEMENTED`（2026-10-05）
- 设计: 见 `DESIGN.md`；决策: 见 `DEC.md`

## 变更文件

| 文件 | 变更 |
|---|---|
| `server/src/services/jevClient.ts` | **新增**：System One 客户端（`requestJevDecisions`）、primitive 取值器（`noulValue`/`scoreValue`/`choiceValue`）、配置解析（`resolveJevConfig`/`requireJevConfig`） |
| `server/src/services/ai.ts` | `analyzeContent` 两级流水线：`runJevPrefilter` 保守粗筛 → 幸存者 LLM 全量 |
| `server/src/__tests__/jevClient.test.ts` | **新增**：17 项（mock axios，不花真钱） |
| `server/src/scripts/verifyJevConnection.ts` | **新增**：真实端到端验证脚本 |
| `server/.env.example` / `.env` | `JEV_ENABLED`/`JEV_API_KEY`/`JEV_BASE_URL`/`JEV_MODEL` |

## 实现要点

- **axios 而非原生 fetch**：QuickRouter 为海外服务，本机经 HTTP 代理（127.0.0.1:7890）；undici fetch 不读代理环境变量会超时，axios 自动继承 `HTTP_PROXY/HTTPS_PROXY`。
- 粗筛阈值：`JEV_ISREAL_REJECT = 0.15`、`JEV_RELEVANCE_REJECT_LEVEL = 0`（经真实调用调优）。
- 拦截日志：`⚡ Jev 拦截 [keyword]: 原因 (relevance=x)`。
- `JEV_ENABLED` 缺省 false；未启用时 `analyzeContent` 完全不进入 Jev 分支（不碰 axios/key）。

## 已知缺口

- JEV_API_KEY 曾在对话中暴露，建议轮换（见 PROGRESS 风险表）。
