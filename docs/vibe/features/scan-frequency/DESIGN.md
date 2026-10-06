# Design — 扫描频率 30min → 2h

- Feature: `scan-frequency`
- Status: `IMPLEMENTED`（2026-10-05）

## 方案

- `server/src/index.ts` cron 表达式：`'*/30 * * * *'` → `'0 */2 * * *'`（整点每 2 小时）。
- 频率为**代码内固定值**（非 env 可配）；三处需同步：index.ts、client App.tsx 文案、docs。
- 注释明确写出"调整需三处同步"。

## 为什么不是 env 可配

- 需求未要求运行时配置；保持最小改动。
- 文档中曾出现 phantom env `MONITOR_INTERVAL`（代码从未读取），已从 docs 清除并标注真实机制，避免误导。
