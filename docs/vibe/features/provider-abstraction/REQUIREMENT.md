# Requirement — AI Provider 抽象（openrouter / ark 可切换）

- Feature: `provider-abstraction`
- Status: `FROZEN`（2026-10-05 会话问答确认）
- 来源: 项目负责人需求 "通过配置文件无缝从 OpenRouter 切换到火山方舟"
- 关联: docs/REQUIREMENTS.md §5.1；DEC.md

## 问题

- 原实现硬编码 `@openrouter/sdk`，模型 `deepseek/deepseek-v3.2` 写死两处（ai.ts）。
- 需要接入火山方舟 `https://ark.cn-beijing.volces.com/api/plan/v3`（OpenAI 兼容协议）。

## 需求条目

| ID | 需求 | 验收 |
|---|---|---|
| REQ-AI-01 | 通过配置文件切换 AI provider，不修改代码 | 改 `.env` 后重启生效 |
| REQ-AI-02 | 支持 openrouter 与 ark 两个 provider | 两者均可真实调用 |
| REQ-AI-03 | 每个 provider 有独立默认模型，可被 env 覆盖 | 切换 provider 不要求改代码 |
| REQ-AI-04 | 向后兼容：现有 `OPENROUTER_API_KEY` 继续可用 | 不改 `.env` 的旧部署行为不变 |
| REQ-AI-05 | AI 不可用时降级为规则化打分，不中断扫描 | 无 key 时返回 fallback 分析 |

## 范围与边界

- In Scope: provider 解析、统一 OpenAI 兼容客户端、ai.ts 重构
- Out of Scope: 运行时切换（仅重启生效）、前端配置 UI、TypeSafe 直连

## 决策

见 `DEC.md`（Approved: Option A 纯 fetch 客户端）。
