# Current Technical Design

## Control

- Applies To Release: 未建立（描述当前工作树实现，2026-10-05 核验）
- Last Updated: 2026-10-05
- Related Decisions: 决策 D1（provider 抽象）、决策 D2（Jev 预筛）——见 `releases/v1/PROPOSED_DESIGN.md`

## Architecture Summary

单体 Node.js 服务（Express 5 + Socket.io + Prisma/SQLite）+ React 19 前端（Vite）。核心闭环：

```
cron 每 2h / 手动触发 → scanManager（单飞锁 + 可取消）
  → hotspotChecker（逐关键词）
      ① 账号检测（B站）② AI 查询扩展 ③ 12 路信源并行抓取
      ④ 去重/新鲜度/优先级 ⑤ 配额 ⑥ AI 逐条审核 ⑦ 入库+通知+WS+邮件
  → 信源健康度账本（每源 ok/条数/错误/耗时）→ GET /api/scan/health → 前端告警

AI 审核两级（JEV_ENABLED=true 时）：
  每条条目 → Jev 粗筛（isReal<0.15 或 relevance=0 → 拦截，零 LLM 成本）
          → 幸存者 → LLM 全量精判（Ark，生成 6 字段）
  Jev 任何失败 → 自动降级 LLM 全量（与现状一致）
```

抓取（axios/fetch + cheerio）与 AI 判定（Ark 的 OpenAI 兼容端点）是两条独立链路：抓取不依赖 AI；AI 只收纯文本做判定。AI 不可用时回落规则化打分，不中断抓取。

## Components

| Component | Responsibility | Interface | Dependencies | Related REQ/AC |
|---|---|---|---|---|
| `server/src/index.ts` | 服务装配、cron 调度（`0 */2 * * *`）、路由注册 | HTTP :3001 / WS | express, socket.io, node-cron | 定时抓取 P0 |
| `jobs/scanManager.ts` | 单飞锁、进度广播、取消检查点 | `tryStartScan/requestCancel/getScanSnapshot` | socket.io | 手动/定时扫描 |
| `jobs/hotspotChecker.ts` | 扫描编排：抓取→过滤→AI→入库 | `executeScan(ctx, io)` | 全部 services | 核心闭环 |
| `services/aiProvider.ts` | provider 解析（openrouter/ark）、模型/密钥、惰性 env 读取 | `resolveProviderConfig/requireProviderConfig` | — | 决策 D1 |
| `services/openaiCompatibleClient.ts` | OpenAI 兼容 Chat Completions 客户端（fetch，60s 超时） | `chatCompletion/extractMessageContent` | fetch | 决策 D1 |
| `services/ai.ts` | 查询扩展 + 内容审核 + Jev 粗筛 + fallback | `expandKeyword/analyzeContent/batchAnalyze` | aiProvider, client, jevClient | AI 审核 |
| `services/jevClient.ts` | Jev（TypeSafe System One）决策客户端，走 QuickRouter `/v1/systemone`，axios（支持代理） | `requestJevDecisions/noulValue/scoreValue/choiceValue` | axios, `JEV_API_KEY` | 决策 D2 |
| `services/sourceHealth.ts` | 信源健康度账本（内存） | `runSource/recordHealth/getHealthSnapshot` | — | 失败静默修复 |
| `services/newSources.ts` | 6 新信源（掘金/CSDN/OSChina/GitHub/PH/微信），失败抛异常 | `searchJuejin/…/searchWeixinSogou` | axios, cheerio | 多数据源 |
| `services/newSourcesAggregator.ts` | 新源并行聚合 + 健康度记录 | `searchNewSources(query)` | newSources, sourceHealth | 多数据源 |
| `services/search.ts` | Bing/HN/DDG/Google 抓取（后两者死代码未调用） | `searchBing/…/searchAll` | axios, cheerio | 多数据源 |
| `services/chinaSearch.ts` | 搜狗/B站/微博 + 账号检测 | `searchSogou/…/detectAndFetchAccount` | axios, cheerio | 多数据源 |
| `services/twitter.ts` | twitterapi.io 付费 API | `searchTwitter` | fetch + `TWITTER_API_KEY` | 多数据源 |
| `routes/scan.ts` | 扫描启动/取消/状态/**健康度** | `POST /`、`POST /cancel`、`GET /status`、`GET /health` | scanManager, sourceHealth | 可观测 |
| `routes/hotspots.ts` | 热点 CRUD + 临时搜索分析 | REST | prisma, ai | 热点列表 |
| 前端 `client/src/App.tsx` | 热点流/监控词/搜索/扫描控制/信源告警 | React + socket | scanApi, socket | 全部展示 |

## Data and State

| Entity/State | Meaning | Owner | Lifecycle | Security/Privacy |
|---|---|---|---|---|
| Hotspot | 热点条目（含 source 12 种、AI 审核字段、互动指标） | `routes/hotspots.ts` 写入 | 扫描时创建 | 公开数据聚合，无敏感信息 |
| Keyword | 监控关键词（isActive） | `routes/keywords.ts` | CRUD | — |
| Notification | 通知（hotspot 关联） | hotspotChecker | 扫描时创建 | — |
| 信源健康度 | 本轮各源 ok/条数/错误（**内存态**） | sourceHealth | 每轮扫描重置 | 无敏感信息，重启即清空 |
| 扫描快照 | 运行状态（**内存态**） | scanManager | 进程生命周期 | — |
| .env | 密钥（`ARK_API_KEY`/`AI_PROVIDER`/`TWITTER_API_KEY`/可选 `GITHUB_TOKEN`/**`JEV_API_KEY`**） | 用户 | — | 已 gitignore；`AI_API_KEY` 为通用覆盖变量 |

Schema：Prisma + SQLite（`server/prisma/`）；`Hotspot.source` 为 String，无枚举约束，新增信源**无需迁移**。

## Interfaces and Compatibility

- Public APIs（前端消费）:
  - `GET /api/hotspots`、`/api/hotspots/stats`、`POST /api/hotspots/search`
  - `GET/POST /api/keywords`、`/api/settings`、`/api/notifications`
  - `GET /api/scan/status`、`POST /api/scan`、`POST /api/scan/cancel`、**`GET /api/scan/health`**
  - WebSocket: `hotspot:new`、`notification`、`scan:*`
- Internal Contracts: `SearchResult.source` 联合类型（12 值）；信源函数签名 `(query) => Promise<SearchResult[]>`（新源失败抛异常，旧源吞错返回 [] —— 语义不一致，见 Known Gaps）
- Platforms: Node ≥ 22（本机 23）、浏览器（Vite dev proxy 5173→3001）
- Compatibility: `OPENROUTER_API_KEY` 旧变量名向后兼容；`AI_PROVIDER` 缺省 = openrouter

## Error and Recovery Design

- Failure Modes:
  - 信源挂/欠费/被反爬 → 新源：异常→健康度账本→前端横幅；旧源：吞错→0 条（不可见，Gap）
  - AI 不可用 → 规则化 fallback 打分（30/10），不中断扫描
  - AI JSON 解析失败 → 该条目 fallback，偶发
  - 扫描取消 → 检查点断言 + `ScanCancelledError`，保证不产生孤儿数据
- User-visible Errors: 前端 toast/横幅；扫描失败终态带 error 字段
- Retry/Idempotency: 扫描单飞锁防重入；Hotspot `[url, source]` 唯一防重复入库；信源内部有限速器
- Recovery/Rollback: 无数据库迁移风险（source 为 String）；降级手段为回退 `AI_PROVIDER`

## Verification Entrypoints

- Tests: `cd server && npx vitest run src`（128 passed / 11 skipped；8 个测试文件）
- Build: `server: npm run build`（tsc）；`client: npm run build`（tsc -b && vite build）
- Typecheck: `npx tsc --noEmit`（tsconfig 已修 `module: NodeNext`）
- Critical Flows: `POST /api/scan` 全量扫描；`npx tsx src/scripts/verifyNewSources.ts <词>`；`npx tsx src/scripts/verifyAiConnection.ts`
- Observability: `GET /api/scan/health`；服务端控制台日志（`信源健康度:` 摘要行）；`GET /api/scan/status`

## Known Gaps

1. **错误语义不一致**：新 6 源失败抛异常，旧 6 源（twitter/bing/hn/sogou/bilibili/weibo）内部吞错返回 `[]` → 健康度账本无法识别旧源失败（Twitter 欠费显示 ok）。修复 = 改造旧 collector 错误语义。
2. B站 `searchBilibiliUser` 缺 `buvid3` cookie → 间歇 412。
3. AI JSON 解析只匹配裸 `{...}`，模型输出 code fence 时会失败（fallback 兜底）。
4. `searchGoogle`/`searchDuckDuckGo` 死代码未清理。
5. `skills/hot-monitor`（Python）与 server 双实现，信源清单已分叉。
6. 掘金/Product Hunt 无关键词检索接口，靠本地过滤，命中率取决于推荐流内容。
7. **Ark 5 小时配额限制**（本轮 429 `AccountQuotaExceeded` 实证）：幸存者 LLM 通道单点依赖 Ark 配额；Jev 预筛可缓解但无法完全替代文本生成。可考虑幸存者通道同样支持 QuickRouter 或提升 Ark 配额。
8. **Jev 安全**：JEV_API_KEY 曾在对话中暴露，建议轮换。
