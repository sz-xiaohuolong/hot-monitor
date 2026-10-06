# Implementation — 信源健康度

- Feature: `scan-health`
- Status: `IMPLEMENTED`（2026-10-05）

## 变更文件

| 文件 | 变更 |
|---|---|
| `server/src/services/sourceHealth.ts` | **新增**：`SourceOutcome`/`runSource`/`toHealth`/`recordHealth`/`resetHealth`/`getHealthSnapshot`/`formatHealthLine` |
| `server/src/jobs/hotspotChecker.ts` | 扫描开始 `resetHealth()`；旧 6 源改用 `runSource` 包装并 `recordHealth`；结束打印 `formatHealthLine()` |
| `server/src/routes/scan.ts` | **新增** `GET /scan/health` 路由 |
| `client/src/services/api.ts` | **新增** `SourceHealth`/`SourceHealthResponse` 类型 + `scanApi.getHealth()` |
| `client/src/App.tsx` | **新增** `sourceHealth` 状态 + 扫描结束刷新 + 失败信源黄色横幅 |
| `server/src/__tests__/sourceHealth.test.ts` | **新增**：10 项 |

## 实现要点

- 扫描结束（`scanState` 从 running→idle）时前端才拉取 health，避免轮询。
- 新源在 `newSourcesAggregator` 内 recordHealth；旧源在 `hotspotChecker` 内 recordHealth，统一进同一账本。
- 同名信源重复记录只保留最新（`filter` + `push`）。
