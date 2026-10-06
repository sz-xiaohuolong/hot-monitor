# Requirement — 信源健康度（失败静默修复）

- Feature: `scan-health`
- Status: `FROZEN`（2026-10-05 会话问答确认，随"新增信源"一并批准）
- 来源: 会话中发现"信源失败静默"缺陷（Twitter 欠费显示为 0 条，无法与"没热点"区分）

## 问题

- 旧 collector 内部 try/catch 吞错返回 `[]` → 欠费/被反爬/接口变更在日志里只是一行 "0 results"。
- 无法回答「今天没有热点」还是「信源挂了」。

## 需求条目

| ID | 需求 | 验收 |
|---|---|---|
| REQ-HLTH-01 | 每个信源本轮状态可查询（ok/条数/错误/耗时） | `GET /api/scan/health` 返回 12 源逐条状态 |
| REQ-HLTH-02 | 新源失败必须暴露（抛异常→账本→告警） | 前端横幅提示失败信源 |
| REQ-HLTH-03 | 扫描结束日志显式列出失败信源 | `信源健康度: ... ❌失败信源: ...` |

## 范围与边界

- In Scope: 新 6 源完整覆盖；健康度 API；前端告警横幅；日志摘要
- **Out of Scope（已知缺口）**: 旧 6 源（twitter/bing/hn/sogou/bilibili/weibo）内部吞错未被改造 → 健康表无法识别其失败（如 Twitter 欠费显示 ok:true, items:0）。记录于 TECH_DESIGN Known Gaps #1。
