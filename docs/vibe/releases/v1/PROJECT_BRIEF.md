# PROJECT BRIEF — v1

## Requirement Control

- Requirement Version: `1`
- Requirement Status: `FROZEN`（2026-10-05 项目负责人批准；v1 为存量接管，事实来自已实现功能，非新需求）
- Current Release: `v1`
- Approved By: 项目负责人
- Approved At: 2026-10-05

## Problem

个人 AI 内容创作者需要持续监控 AI 领域热点。原系统依赖单一 OpenRouter + 少量信源，存在：模型供应商锁定、信源单一（B站占比过高）、信源失败静默（欠费/被反爬显示为 0 条）、扫描频率过密导致第三方 API 费用高。

## Target User

AI 编程内容创作者（个人使用），关注中文技术内容，需要每小时级的新鲜度。

## Core Scenario

用户配置监控关键词 → 系统按 2 小时周期从 12 个信源抓取候选 → AI 判定真实性与相关性 → 过滤后入库并推送（WebSocket + 高重要级邮件）→ 用户在前端浏览热点雷达。

## In Scope

- 多信源聚合：既有 6 源（Twitter/Bing/HN/搜狗/B站/微博）+ 新增 6 源（掘金/CSDN/开源中国/GitHub/Product Hunt/微信公众号）
- AI Provider 可配置：openrouter / ark（OpenAI 兼容），env 切换
- Jev（TypeSafe System One）决策预筛：保守粗筛拦截垃圾（经实测调优，默认关闭）
- 信源健康度可观测：`GET /api/scan/health` + 前端告警横幅
- 扫描频率 2 小时；AI 不可用时规则化降级

## Out of Scope

- Gitee / 知乎 / Reddit（可行性探测后明确不做：需 token/登录/OAuth）
- Jev 替换 LLM 或迁移 `expandKeyword`（Jev 不生成文本，不可行）
- 多用户/账号体系、移动端、历史数据分析
- Twitter 依赖第三方付费 API（当前欠费停供，属已知外部依赖）

## Constraints

- `AIAnalysis` 对外结构不变（前端/入库零改动）
- `JEV_ENABLED=false` 时行为与接入前逐字节等价
- 代理环境：QuickRouter 为海外服务，客户端须走 HTTP 代理（axios 自动继承 env）
- Ark 有 5 小时配额限制（实测 429）

## Acceptance Goals

| Goal ID | 可观察目标 | 验证方式 | 状态 |
|---|---|---|---|
| GOAL-001 | 12 个信源均能真实抓取 | `verifyNewSources.ts` 逐源验证 | `VERIFIED` |
| GOAL-002 | AI provider 切换真实生效 | `verifyAiConnection.ts` + env 覆盖反向验证 | `VERIFIED` |
| GOAL-003 | 信源失败不再静默 | `GET /api/scan/health` 返回逐源状态 + 前端横幅 | `VERIFIED` |
| GOAL-004 | Jev 预筛拦截垃圾且不误杀 | 生产扫描拦截 20 条 + 阈值调优实验 | `VERIFIED`（当前按负责人要求关闭） |
| GOAL-005 | 扫描周期 2 小时生效 | cron 验证 + 重启横幅 | `VERIFIED` |

## Open Questions

- 无（v1 冻结）
