# 项目与调研上下文笔记

## 一、项目技术上下文

- 仓库：`liyupi/yupi-hot-monitor`（热点监控项目）
- 核心涉及文件：
  - `server/src/services/jevClient.ts`：TypeSafe System One 模型（Jev）客户端实现，基于 Axios，支持 QuickRouter /v1/systemone 协议，覆盖 Noul、Score、Choice 三种原语。
  - `server/src/services/ai.ts`：`analyzeContent` 两级过滤流水线，Jev 保守粗筛拦截明确垃圾（`isReal < 0.15` 或 `relevanceScore === 0`），幸存者继续交由 LLM 进行全量语义精判并生成 `relevanceReason` 和 `summary`。
  - `server/src/scripts/verifyJevConnection.ts`：Jev 端到端连通性与真实调用验证脚本。
  - `server/src/__tests__/jevClient.test.ts`：17 个 Jev 客户端单测，全量 145 测试回归通过。
  - `docs/vibe/releases/v1/PROPOSED_DESIGN.md`（决策 D2）与 `docs/vibe/releases/v1/`：Jev 预筛层架构决策与 v1 验证记录。
  - `docs/vibe/PROGRESS.md`：真实运行数据，真实扫描拦截 20 条垃圾，Ark 429 配额耗尽时 Jev 仍能独立工作。

## 二、浏览器尝试台账（URL Attempt Ledger）

| 序号 | 尝试 URL | 访问时间 | 访问结果 | 详细原因 / 备注 |
|---|---|---|---|---|
| 1 | `https://sidbharath.com/blog/jev-typesafe-system-one-model` | 2026-10-06T14:02:01+08:00 | 失败 | 目标链接返回 HTTP 404 页面丢失，无法获取正文及写作方法 |
| 2 | `https://blog.langchain.dev/building-a-harness-with-jev/` | 2026-10-06T14:02:21+08:00 | 成功 | LangChain 官方博客关于 Jev 核心原语与智能体决策门禁的实践文章，正文完整可读 |
| 3 | `https://blog.langchain.dev/building-prod-with-jev-and-langgraph/` | 2026-10-06T14:02:31+08:00 | 成功 | LangChain 官方博客关于在生产级架构中结合 Jev 与工作流图的实战教程，正文完整可读 |
