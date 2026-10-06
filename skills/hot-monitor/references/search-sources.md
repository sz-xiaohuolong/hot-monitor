# Search Sources Reference

Detailed information about each data source, including endpoints, rate limits, parsing strategies, and known quirks.

## International Sources

### Bing Web Search

- **Method**: HTML scraping (no API key)
- **URL**: `https://www.bing.com/search?q={query}&count=20`
- **Rate limit**: 5 seconds between requests
- **Parsing**: CSS selector `li.b_algo` → title from `h2 a`, snippet from `.b_caption p`
- **Quirks**: Requires rotating User-Agent. Returns up to ~20 results per page. Occasionally returns captcha pages if rate limit is hit.

### Google Web Search

- **Method**: HTML scraping (no API key)
- **URL**: `https://www.google.com/search?q={query}&num=20&hl=en`
- **Rate limit**: 10 seconds between requests (stricter anti-bot)
- **Parsing**: CSS selector `div.g` → title from `h3`, snippet from `.VwiC3b`
- **Quirks**: Most aggressive anti-bot protection. May require proxy for frequent use. Google changes HTML structure periodically.

### DuckDuckGo

- **Method**: HTML version scraping (no API key)
- **URL**: `https://html.duckduckgo.com/html/?q={query}`
- **Rate limit**: 3 seconds between requests
- **Parsing**: CSS selector `.result` → title from `.result__title a`, snippet from `.result__snippet`
- **Quirks**: Uses redirect URLs containing `uddg=` parameter — must extract actual URL via URL decoding. Most reliable for scraping (minimal anti-bot).

### Hacker News (Algolia API)

- **Method**: Official JSON API (no API key)
- **URL**: `https://hn.algolia.com/api/v1/search?query={query}&tags=story&hitsPerPage=20`
- **Rate limit**: 1 second (very permissive)
- **Filter**: `numericFilters=created_at_i>{unix_timestamp}` for time-based filtering (default: last 24 hours)
- **Response fields**: `title`, `url`, `story_text`, `author`, `points`, `num_comments`, `created_at`
- **Quirks**: Best source for tech/programming news. `url` may be null for "Ask HN" or "Show HN" posts — use `https://news.ycombinator.com/item?id={objectID}` as fallback.

## Chinese Sources

### Sogou (搜狗搜索)

- **Method**: HTML scraping (no API key)
- **URL**: `https://www.sogou.com/web?query={query}&ie=utf-8`
- **Rate limit**: 3 seconds between requests
- **Parsing**: CSS selectors `.vrwrap, .rb` → title from `h3 a`, snippet from `.space-txt, .str-text-info`
- **Quirks**: URLs starting with `/link?url=` need prefix `https://www.sogou.com`. Filter out results containing "大家还在搜". More lenient than Baidu for scraping.

### Bilibili (B站)

- **Method**: Public JSON API (no API key)
- **Video search URL**: `https://api.bilibili.com/x/web-interface/search/type?keyword={query}&search_type=video&order=pubdate&page=1&pagesize=20`
- **User search URL**: `https://api.bilibili.com/x/web-interface/search/type?keyword={query}&search_type=bili_user`
- **User videos URL**: `https://api.bilibili.com/x/space/arc/search?mid={mid}&pn=1&ps=10&order=pubdate`
- **Rate limit**: 2 seconds between requests
- **Required headers**: `Referer: https://search.bilibili.com/`, random `Cookie: buvid3={uuid}infoc` (prevents 412 errors)
- **Response**: `code=0` indicates success. Video titles may contain `<em>` highlight tags — strip with regex.
- **Engagement metrics**: `play` (views), `like`, `review` (comments), `danmaku`, `favorites`
- **Account detection**: Search `bili_user` type first. Match by exact name or fuzzy match (fans > 1000 + name contains keyword).

### Weibo Hot Search (微博热搜)

- **Method**: Public JSON API (no API key, no login)
- **URL**: `https://weibo.com/ajax/side/hotSearch`
- **Rate limit**: 3 seconds between requests
- **Required headers**: `Referer: https://weibo.com/`
- **Response**: `ok=1` and `data.realtime` array of hot topics
- **Each item**: `word` (topic text), `num` (heat score), `note` (display name)
- **Matching strategy**: Check if any query word appears in topic, or vice versa (bidirectional fuzzy match)
- **Link format**: `https://s.weibo.com/weibo?q={encoded_hashtag_topic}`
- **Quirks**: Returns current trending topics only — not a general search. Best for detecting if a topic is actively trending in China.

## Twitter/X

- **Method**: REST API via `twitterapi.io` (requires API key)
- **Base URL**: `https://api.twitterapi.io`
- **Auth**: Header `X-API-Key: {key}`
- **Search endpoint**: `GET /twitter/tweet/advanced_search?query={query}&queryType={Top|Latest}`
- **Trends endpoint**: `GET /twitter/trends?woeid=1`
- **User tweets**: `GET /twitter/user/last_tweets?userName={username}`
- **Advanced query syntax**:
  - `-filter:retweets -filter:replies` — exclude RTs and replies
  - `since:YYYY-MM-DD` — time filter
  - `min_faves:10` — minimum likes (for Top queries)
- **Strategy**: Top search (7-day, 2 pages) + Latest search (3-day, 1 page), deduplicate by tweet ID
- **Quality filter thresholds**: likes ≥ 10, retweets ≥ 5, views ≥ 500, followers ≥ 100 (halved for blue-verified users)
- **Pagination**: Response includes `has_next_page` and `next_cursor`

## New Sources (2026-10, server implementation only)

Implemented in `server/src/services/newSources.ts` + `newSourcesAggregator.ts`.
These sources **throw on failure** instead of returning `[]` — the health ledger
(`server/src/services/sourceHealth.ts`) records per-source ok/error per scan and is
exposed at `GET /api/scan/health`.

### Juejin (掘金推荐流)

- **Method**: Public JSON API (no API key)
- **URL**: `POST https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed`
- **Body**: `{"id_type":2,"client_type":2608,"sort_type":200,"cursor":"0","limit":30}`
- **Parsing**: `data[].item_info.article_info` → `title`, `brief_content`, `ctime` (**seconds**, ×1000),
  `view_count`, `digg_count`; `author_user_info.user_name`; article URL = `https://juejin.cn/post/{article_id}`
- **Quirks**: No keyword search endpoint — pulls recommendation feed then filters locally by keyword.
  `err_no !== 0` is treated as failure (throws).

### CSDN

- **Method**: Public JSON API (no API key)
- **URL**: `https://so.csdn.net/api/v3/search?q={query}&t=blog&p=1&s=0&tm=0`
- **Parsing**: `result_vos[]` → `title`/`description` (contain `<em>` highlight tags — strip),
  `url` (strip tracking query params), `create_time` (**milliseconds**), `view_num`, `digg`, `author`

### OSChina (开源中国资讯)

- **Method**: HTML scraping (no API key)
- **URL**: `https://www.oschina.net/news`
- **Parsing**: `#newsList .news-item` → url from `data-url` attribute (NOT href),
  title from `.title`, description from `.description .line-clamp`
- **Quirks**: `.news-item` also matches author rows elsewhere on the page — scope to `#newsList`.
  Filtered by keyword locally.

### GitHub (仓库搜索)

- **Method**: Official JSON API (60 req/h anonymous, higher with token)
- **URL**: `https://api.github.com/search/repositories?q={query}&sort=stars&order=desc&per_page=15`
- **Auth**: optional `GITHUB_TOKEN` env var → `Authorization: Bearer`
- **Parsing**: `items[]` → `full_name`, `html_url`, `description`, `stargazers_count`,
  `forks_count`, `pushed_at`, `owner.login`
- **Quirks**: Rate-limit/auth errors come back as HTTP 200 with `message` field and no `items`
  — must throw on that shape instead of treating as empty.

### Product Hunt

- **Method**: Official RSS feed — **Atom format** (`<entry>`, not `<item>`)
- **URL**: `https://www.producthunt.com/feed`
- **Parsing**: split on `<entry>`; link is in `<link rel="alternate" href="...">` attribute;
  content is **HTML-entity-encoded** (`&lt;p&gt;`) — decode entities *before* stripping tags;
  dates in `<published>` (RFC3339)
- **Quirks**: No keyword search — pulls 50 entries then filters locally.

### 微信公众号（搜狗微信）

- **Method**: HTML scraping (no API key)
- **URL**: `https://weixin.sogou.com/weixin?type=2&query={query}`
- **Parsing**: `li[id^="sogou_vr"]` → title from `h3 a`, snippet from `.txt-info`,
  relative `/link?url=` hrefs need `https://weixin.sogou.com` prefix,
  timestamp hidden in `document.write(timeConvert('{unix_seconds}'))` inside `.s-p`
- **Quirks**: The `/link` URLs carry an expiring token — fine for per-scan use, not durable links.
  May hit captcha under heavy use.

## Rate Limiting Strategy

All sources implement per-source rate limiting via minimum interval enforcement:

| Source | Min Interval | Anti-Bot Risk |
|--------|-------------|---------------|
| Bing | 5s | Medium |
| Google | 10s | High |
| DuckDuckGo | 3s | Low |
| HackerNews | 1s | None (official API) |
| Sogou | 3s | Low-Medium |
| Bilibili | 2s | Low (official API) |
| Weibo | 3s | Low (official API) |
| Twitter | N/A | None (paid API) |

## User-Agent Rotation

Use these User-Agents randomly for web scraping sources:

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15
```

## URL Deduplication

Normalize URLs before deduplication:
1. Remove trailing `/`
2. Replace `http://www.` and `https://www.` with `https://`
3. Compare normalized URLs
