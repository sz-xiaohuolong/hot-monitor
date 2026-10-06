# Design — 信源健康度

- Feature: `scan-health`
- Status: `IMPLEMENTED`（2026-10-05）

## 目标架构

```
collector（抛异常 或 返回 items）
  → runSource(name, fn) 包装：异常→SourceOutcome{status:'error'}；正常→{status:'ok'}
  → toHealth → recordHealth（内存账本）
  → GET /api/scan/health 读取快照 → 前端横幅
  → formatHealthLine() 扫描结束打印摘要
```

## 核心类型

```ts
type SourceOutcome =
  | { status: 'ok'; items: SearchResult[] }
  | { status: 'error'; items: SearchResult[]; error: string };

interface SourceHealth { name; ok; items; error; durationMs }
```

**关键区分**：`ok + items=0`（真的没搜到）≠ `error`（抓取失败）。旧实现把两者都变 `[]`。

## 组件

| 组件 | 职责 |
|---|---|
| `services/sourceHealth.ts` | `runSource` / `toHealth` / 内存账本（reset/record/get snapshot）/ `formatHealthLine` |
| `services/newSourcesAggregator.ts` | 新 6 源并行抓取 + 每源 recordHealth |
| `jobs/hotspotChecker.ts` | 扫描开始 resetHealth；每轮对旧 6 源也做 runSource 包装（捕获向外抛的异常）；结束打印摘要 |
| `routes/scan.ts` | `GET /scan/health` → `{checkedAt, failed[], sources[]}` |
| `client/src/App.tsx` + `api.ts` | 扫描结束拉取 health；失败信源显示黄色横幅（可关闭） |

## 已知限制

- 旧 collector 内部 catch 的错误仍表现为 `ok:true, items:0`（runSource 只能捕获向外抛的异常）。这是显式记录的行为缺口。
- 账本为内存态，进程重启即清空。
