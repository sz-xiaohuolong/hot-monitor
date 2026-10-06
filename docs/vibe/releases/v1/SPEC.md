# Effective SPEC — v1

| 范围 | 冻结的产品事实 | 待澄清/边界 | 验收入口 |
|---|---|---|---|
| Release v1 | 12 信源聚合 + AI 判定 + 健康度 + 可选 Jev 预筛 | 无（冻结） | 见各 REQ/AC |
| 核心能力 | 关键词驱动扫描 → AI 审核 → 入库推送 | — | GOAL-001~005 |
| 异常与边界 | AI/信源不可用时降级不中断扫描 | Jev 默认关闭；Ark 有配额限制 | ERR/BND |

## Control

- Release: `v1`
- Requirement Version: `1`
- Requirement Baseline: `PROJECT_BRIEF.md`
- Status: `FROZEN`

## Product Behaviors

### REQ-01 — 多信源聚合（12 源）

- Source: PROJECT_BRIEF §In Scope
- Actors: 定时/手动扫描任务
- Preconditions: 至少一个 active 关键词
- Trigger: cron（每 2h）或手动 `POST /api/scan`
- Expected Behavior: 逐关键词并行抓取 12 信源，去重/新鲜度过滤/按优先级排序后进入 AI 审核
- Resulting State: 候选条目进入 AI 审核，通过者入库
- Explicit Non-goals: 不采集 Gitee/知乎/Reddit

#### Acceptance Criteria

- AC-01: `verifyNewSources.ts <词>` 对 6 个新源均返回真实结果（实测 64 条）
- AC-02: 既有 6 源继续工作（回归 128→145 测试通过）
- AC-03: 掘金/Product Hunt 无检索接口时本地过滤（已知限制，非故障）

#### Error Scenarios

- ERR-01: 单信源失败 → 不影响其他信源（`Promise.all` + `runSource`），记入健康度账本

#### Boundary Conditions

- BND-01: 每关键词每源抓取上限（Twitter 15 / 其他共享 10）

### REQ-02 — AI Provider 可配置（openrouter / ark）

- Source: PROJECT_BRIEF §In Scope
- Actors: 部署者
- Preconditions: `.env` 配置 `AI_PROVIDER`
- Trigger: 修改配置后重启
- Expected Behavior: AI 审核与查询扩展走所选 provider；模型按 provider 默认，可被 env 覆盖
- Resulting State: AI 请求发往所选端点
- Explicit Non-goals: 运行时热切换（仅重启生效）

#### Acceptance Criteria

- AC-04: `AI_PROVIDER=ark` 时真实调用成功（模型 `deepseek-v4-flash-ga-260731`）
- AC-05: `AI_PROVIDER=openrouter` 覆盖时请求发往 openrouter.ai（实测 402 反向验证）
- AC-06: 无 `AI_PROVIDER` 时默认 openrouter，`OPENROUTER_API_KEY` 旧变量兼容

#### Error Scenarios

- ERR-02: 无 API Key → `ApiKeyMissingError` → 规则化 fallback（30/10 分），不中断扫描

### REQ-03 — 信源健康度可观测

- Source: PROJECT_BRIEF §In Scope
- Actors: 运维/浏览者
- Preconditions: 至少一轮扫描已运行
- Trigger: `GET /api/scan/health` 或前端扫描结束
- Expected Behavior: 返回 12 源逐条 `{ok, items, error, durationMs}`；前端对失败源显示可关闭横幅
- Resulting State: 失败信源可见（区别于"今天没热点"）
- Explicit Non-goals: 旧 6 源内部吞错的失败不暴露（已知缺口，见 REQ-03 BND）

#### Acceptance Criteria

- AC-07: 扫描后 health 接口返回 12 源状态，`failed` 列表正确
- AC-08: 扫描日志打印 `信源健康度: ... ❌失败信源: ...` 摘要

#### Boundary Conditions

- BND-02: 旧 6 源（twitter/bing/hn/sogou/bilibili/weibo）内部 try/catch 吞错 → 健康表显示 `ok:true, items:0`，无法识别其失败。这是记录的缺口，不视为 REQ-03 未完成。

### REQ-04 — Jev 决策预筛（可选，默认关闭）

- Source: PROJECT_BRIEF §In Scope；DEC-002
- Actors: 部署者（开关）
- Preconditions: `JEV_ENABLED=true` + `JEV_API_KEY`
- Trigger: `analyzeContent` 调用
- Expected Behavior: Jev 保守粗筛（isReal<0.15 或 relevance=0 拦截），幸存者走 LLM 全量精判
- Resulting State: 明确垃圾零 LLM 成本拦截；真实内容不误杀
- Explicit Non-goals: Jev 不替代 LLM 决策、不生成文本、不迁移 expandKeyword

#### Acceptance Criteria

- AC-09: `verifyJevConnection.ts` 端到端成功（Jev 决策 + LLM 文本）
- AC-10: 生产扫描出现 `⚡ Jev 拦截` 行（实测 20 条）
- AC-11: `JEV_ENABLED=false` 时完全不调用 Jev，行为与接入前一致
- AC-12: Jev 调用失败自动降级 LLM 全量（实测 502→降级）

#### Error Scenarios

- ERR-03: Jev 网络/HTTP/解析失败 → `try/catch` 降级 LLM 全量，不中断扫描

#### Boundary Conditions

- BND-03: 阈值 `JEV_ISREAL_REJECT=0.15`、`JEV_RELEVANCE_REJECT_LEVEL=0`（经真实调用调优）

### REQ-05 — 扫描频率 2 小时

- Source: PROJECT_BRIEF §In Scope
- Actors: 部署者
- Preconditions: 服务运行
- Trigger: cron `0 */2 * * *`
- Expected Behavior: 整点每 2 小时触发一次定时扫描
- Resulting State: 无

#### Acceptance Criteria

- AC-13: cron 表达式合法且整点触发（08:00/10:00...）
- AC-14: 前端文案与文档同步为"每 2 小时"

## User Flows

```text
配置关键词 → 定时/手动扫描 → 抓取 12 源 → 去重/新鲜度/排序 → Jev 粗筛(可选) → LLM 审核
→ 通过者入库 + WebSocket 推送 + 高重要级邮件 → 前端热点雷达 / 健康度横幅
```

## 验收索引

| REQ | AC | Source |
|---|---|---|
| REQ-01 | AC-01~03 | PROJECT_BRIEF §In Scope |
| REQ-02 | AC-04~06 | PROJECT_BRIEF §In Scope |
| REQ-03 | AC-07~08 | PROJECT_BRIEF §In Scope |
| REQ-04 | AC-09~12 | DEC-002 |
| REQ-05 | AC-13~14 | 负责人决策 |

## Limitations & Disclaimers

- 本 SPEC 为存量接管产物：v1 功能已实现后才冻结，SPEC 描述的是已实现并验证的真实行为，而非先写需求再实现。Jev 默认关闭（`JEV_ENABLED=false`）是当前运行状态。
