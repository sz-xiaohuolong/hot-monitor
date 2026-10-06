# Requirement — 新增 6 个信息源

- Feature: `new-sources`
- Status: `FROZEN`（2026-10-05 会话问答确认）
- 来源: 项目负责人需求（国内 5 + 国外 3 候选，经可行性探测收敛为 6 个可用源）
- 关联: docs/REQUIREMENTS.md §2.2 多数据源

## 需求条目

| ID | 需求 | 验收 |
|---|---|---|
| REQ-SRC-01 | 接入掘金（推荐流 API） | 返回真实文章 |
| REQ-SRC-02 | 接入 CSDN（搜索 API） | 返回真实结果，清理 `<em>` 高亮与追踪参数 |
| REQ-SRC-03 | 接入开源中国（HTML 解析） | 解析 `#newsList .news-item` |
| REQ-SRC-04 | 接入 GitHub（官方 Search API） | 限流/鉴权错误显式抛错 |
| REQ-SRC-05 | 接入 Product Hunt（官方 Atom RSS） | 解析 `<entry>` 并本地过滤 |
| REQ-SRC-06 | 接入微信公众号（搜狗微信） | 相对链接转绝对，解析时间戳 |
| REQ-SRC-07 | **新源失败必须抛异常，不得静默返回 []** | 健康度账本可识别失败 |

## 范围与边界

- In Scope: 上述 6 源 + source 类型扩展 + 前端图标/标签/筛选
- Out of Scope: Gitee（需 token）、知乎（需登录）、Reddit（需 OAuth）—— 探测后明确不做
- 已知限制: 掘金 / Product Hunt 无关键词检索接口，采用"拉全量 → 本地过滤"

## 决策

见 `docs/vibe/features/provider-abstraction/DEC.md` 的 rejected alternatives（Gitee/知乎/Reddit 暂不做，会话确认）。
