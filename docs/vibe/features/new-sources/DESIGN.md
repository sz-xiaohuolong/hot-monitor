# Design — 新增 6 个信息源

- Feature: `new-sources`
- Status: `IMPLEMENTED`（2026-10-05）

## 目标架构

```
hotspotChecker → newSourcesAggregator.searchNewSources(query)
  → 并行调用 6 个 collector（runSource 包装）
  → 每个 collector：成功→items；失败→抛异常（由 runSource 捕获记入健康度）
```

## 组件

| 组件 | 职责 | 关键点 |
|---|---|---|
| `services/newSources.ts` | 6 个 collector | **失败抛异常**（区别于旧 collector 吞错）；每源独立 RateLimiter；`stripHtml` 先解码实体再去标签 |
| `services/newSourcesAggregator.ts` | 并行聚合 + 健康度记录 | `Promise.all` + `runSource`；单点失败不影响其他源 |
| `services/sourceHealth.ts` | 健康度账本 | `SourceOutcome` 区分"成功但 0 条"与"失败" |

## 各源实现要点

| 源 | 接入 | 解析 |
|---|---|---|
| 掘金 | POST `recommend_all_feed` | `data[].item_info.article_info`；ctime **秒**×1000；本地按关键词过滤 |
| CSDN | GET `so.csdn.net/api/v3/search` | `result_vos[]`；create_time **毫秒**；url 去追踪参数 |
| OSChina | GET `oschina.net/news` | `#newsList .news-item`；url 取 `data-url` 属性（非 href） |
| GitHub | GET `api.github.com/search/repositories` | `items[]`；`message` 字段无 items 时**抛错**（限流）；可选 `GITHUB_TOKEN` |
| Product Hunt | GET `producthunt.com/feed` | **Atom `<entry>`**（非 RSS `<item>`）；link 在属性中；content 实体编码先解码 |
| 微信公众号 | GET `weixin.sogou.com/weixin` | `li[id^=sogou_vr]`；时间戳在 `document.write(timeConvert(...))` |

## 错误语义（核心设计）

旧 collector：内部 try/catch 吞错返回 `[]` → 失败与"没搜到"不可区分。
新 collector：**失败抛异常**，`runSource` 捕获并记入健康度账本 → 前端可告警。
这是"失败静默修复"的新源侧实现。
