# Implementation — 扫描频率 30min → 2h

- Feature: `scan-frequency`
- Status: `IMPLEMENTED`（2026-10-05）

## 变更文件

| 文件 | 变更 |
|---|---|
| `server/src/index.ts` | cron `'*/30 * * * *'` → `'0 */2 * * *'`；启动横幅 "every 30 minutes" → "every 2 hours" |
| `client/src/App.tsx` | 两处 "每 30 分钟自动更新" → "每 2 小时自动更新" |
| `docs/REQUIREMENTS.md` | P0 需求表更新 + **变更记录**（不静默改写基线） |
| `docs/README.md` / `docs/API_INTEGRATION.md` / `docs/LOCAL_SETUP.md` | 频率表述同步；清除 phantom `MONITOR_INTERVAL` |

## 说明

- REQUIREMENTS.md 是产品基线，改动以"变更记录"标注决策而非静默替换。
- `MONITOR_INTERVAL=1800000` 是文档里的假变量（代码从未读取），已替换为对真实机制的说明。
