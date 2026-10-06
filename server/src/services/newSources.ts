import axios from 'axios';
import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.js';

/**
 * 新增信源（国内 4 / 国外 2）
 *
 * 与既有 collector 的**关键区别**：失败时抛异常，不返回空数组。
 * 旧实现把"抓取失败"和"没搜到"都变成 `[]`，导致信源断供无法察觉。
 * 这里的返回语义是：正常返回 = 真的没搜到；抛异常 = 抓取失败。
 *
 * 已知源的过滤行为：掘金与 Product Hunt 没有关键词检索接口（只有推荐流/RSS），
 * 采用"拉全量 → 本地按关键词过滤"策略，属行为已知的限制，不是故障。
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

class RateLimiter {
  private lastRequestTime = 0;
  constructor(private minIntervalMs: number = 2000) {}

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}

const juejinLimiter = new RateLimiter(2000);
const csdnLimiter = new RateLimiter(3000);
const oschinaLimiter = new RateLimiter(3000);
const githubLimiter = new RateLimiter(1000);
const productHuntLimiter = new RateLimiter(2000);
const weixinLimiter = new RateLimiter(3000);

/**
 * 去掉 HTML 标签与多余空白（CSDN/搜狗的高亮标签、OSChina 的换行缩进）。
 *
 * 先解码实体再去标签：Atom feed 里的正文是实体编码的（&lt;p&gt;…&lt;/p&gt;），
 * 若顺序反过来，标签会以字面量形式残留下来。
 */
function stripHtml(input: string | undefined | null): string {
  if (!input) return '';
  return String(input)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 关键词是否命中文本（不区分大小写，按空格拆词，任一词命中即算） */
function matchesKeyword(text: string, keyword: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase().trim();
  if (lowerText.includes(lowerKeyword)) return true;
  const words = lowerKeyword.split(/\s+/).filter(w => w.length >= 2);
  return words.some(w => lowerText.includes(w));
}

// ============================================================
// 国内
// ============================================================

interface JuejinItem {
  item_type?: number;
  item_info?: {
    article_info?: {
      article_id?: string;
      title?: string;
      brief_content?: string;
      ctime?: string;
      view_count?: number;
      digg_count?: number;
      comment_count?: number;
    };
    author_user_info?: { user_name?: string; user_id?: string; avatar_large?: string };
    tags?: Array<{ tag_name?: string }>;
  };
}

/**
 * 掘金推荐流。
 * 注意：掘金没有公开的关键词检索接口，此处拉推荐流后本地过滤。
 */
export async function searchJuejin(query: string): Promise<SearchResult[]> {
  await juejinLimiter.wait();

  const response = await axios.post(
    'https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed',
    { id_type: 2, client_type: 2608, sort_type: 200, cursor: '0', limit: 30 },
    {
      headers: { 'User-Agent': randomUserAgent(), 'Content-Type': 'application/json' },
      timeout: 15000
    }
  );

  if (response.data?.err_no !== 0) {
    throw new Error(`掘金接口返回错误 err_no=${response.data?.err_no} ${response.data?.err_msg ?? ''}`);
  }

  const items: JuejinItem[] = Array.isArray(response.data?.data) ? response.data.data : [];
  const results: SearchResult[] = [];

  for (const entry of items) {
    const info = entry?.item_info?.article_info;
    if (!info?.article_id || !info.title) continue;

    const title = stripHtml(info.title);
    const brief = stripHtml(info.brief_content);
    if (!matchesKeyword(`${title} ${brief}`, query)) continue;

    // ctime 是「秒」级时间戳字符串，必须乘 1000
    const seconds = Number(info.ctime);
    const publishedAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;

    results.push({
      title,
      content: brief || title,
      url: `https://juejin.cn/post/${info.article_id}`,
      source: 'juejin',
      sourceId: info.article_id,
      publishedAt,
      viewCount: info.view_count ?? undefined,
      likeCount: info.digg_count ?? undefined,
      commentCount: info.comment_count ?? undefined,
      author: {
        name: entry.item_info?.author_user_info?.user_name ?? '',
        username: entry.item_info?.author_user_info?.user_id,
        avatar: entry.item_info?.author_user_info?.avatar_large
      }
    });
  }

  console.log(`Juejin search for "${query}": ${results.length} matched of ${items.length} feed items`);
  return results;
}

interface CsdnItem {
  title?: string;
  url?: string;
  url_location?: string;
  description?: string;
  create_time?: string;
  view_num?: string;
  view?: string;
  digg?: string;
  author?: string;
}

/** CSDN 搜索 */
export async function searchCsdn(query: string): Promise<SearchResult[]> {
  await csdnLimiter.wait();

  const response = await axios.get('https://so.csdn.net/api/v3/search', {
    params: { q: query, t: 'blog', p: 1, s: 0, tm: 0 },
    headers: { 'User-Agent': randomUserAgent() },
    timeout: 15000
  });

  const items: CsdnItem[] = Array.isArray(response.data?.result_vos)
    ? response.data.result_vos
    : [];

  const results: SearchResult[] = items
    .filter(item => item?.title && (item.url || item.url_location))
    .map(item => {
      // create_time 是毫秒级时间戳字符串
      const ms = Number(item.create_time);
      const publishedAt = Number.isFinite(ms) && ms > 0 ? new Date(ms) : undefined;

      // url 带搜索追踪参数，去掉 query 保留文章地址
      const rawUrl = item.url_location || item.url || '';
      const cleanUrl = rawUrl.split('?')[0];

      return {
        title: stripHtml(item.title),
        content: stripHtml(item.description) || stripHtml(item.title),
        url: cleanUrl,
        source: 'csdn' as const,
        sourceId: cleanUrl.split('/').pop(),
        publishedAt,
        viewCount: Number(item.view_num ?? item.view) || undefined,
        likeCount: Number(item.digg) || undefined,
        author: { name: item.author ?? '' }
      };
    });

  console.log(`CSDN search for "${query}": found ${results.length} results`);
  return results;
}

/**
 * 开源中国资讯。
 * 该站没有公开 JSON API，只能解析 HTML 列表。
 */
export async function searchOschina(query: string): Promise<SearchResult[]> {
  await oschinaLimiter.wait();

  const response = await axios.get('https://www.oschina.net/news', {
    headers: { 'User-Agent': randomUserAgent() },
    timeout: 15000
  });

  const $ = cheerio.load(String(response.data));
  const results: SearchResult[] = [];

  // 优先限定在资讯列表容器内，避免抓到侧栏的栏目导航与作者条目
  const nodes = $('#newsList .news-item').length > 0
    ? $('#newsList .news-item')
    : $('.news-item[data-url]');

  nodes.each((_, el) => {
    const node = $(el);
    const url = node.attr('data-url') ?? node.find('a').first().attr('href') ?? '';
    const title = stripHtml(node.find('.title').first().text()) || stripHtml(node.find('h3').first().text());
    const description = stripHtml(node.find('.description .line-clamp').first().text())
      || stripHtml(node.find('.description').first().text());

    if (!title || !url.startsWith('http')) return;

    results.push({
      title,
      content: description || title,
      url,
      source: 'oschina',
      sourceId: url.split('/').pop()
    });
  });

  const filtered = results.filter(r => matchesKeyword(`${r.title} ${r.content}`, query));

  console.log(`OSChina search for "${query}": ${filtered.length} matched of ${results.length} news items`);
  return filtered;
}

// ============================================================
// 国外
// ============================================================

interface GithubRepo {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  created_at?: string;
  pushed_at?: string;
  owner?: { login?: string; avatar_url?: string };
  topics?: string[];
}

/**
 * GitHub 仓库搜索（官方 API）。
 * 未配置 GITHUB_TOKEN 时走匿名配额（60 次/小时），对本项目的调用量足够。
 */
export async function searchGithub(query: string): Promise<SearchResult[]> {
  await githubLimiter.wait();

  const headers: Record<string, string> = {
    'User-Agent': randomUserAgent(),
    Accept: 'application/vnd.github+json'
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await axios.get('https://api.github.com/search/repositories', {
    params: { q: query, sort: 'stars', order: 'desc', per_page: 15 },
    headers,
    timeout: 15000
  });

  // GitHub 用 message 字段表达限流/鉴权错误，必须显式抛出而不是当作空结果
  if (response.data?.message && !response.data?.items) {
    throw new Error(`GitHub API 错误: ${response.data.message}`);
  }

  const items: GithubRepo[] = Array.isArray(response.data?.items) ? response.data.items : [];

  const results: SearchResult[] = items
    .filter(repo => repo?.html_url && repo.full_name)
    .map(repo => ({
      title: repo.full_name as string,
      content: stripHtml(repo.description) || `${repo.full_name}`,
      url: repo.html_url as string,
      source: 'github' as const,
      sourceId: String(repo.full_name),
      publishedAt: repo.pushed_at ? new Date(repo.pushed_at) : undefined,
      viewCount: repo.stargazers_count,
      likeCount: repo.stargazers_count,
      commentCount: repo.forks_count,
      author: { name: repo.owner?.login ?? '', username: repo.owner?.login, avatar: repo.owner?.avatar_url }
    }));

  console.log(`GitHub search for "${query}": found ${results.length} results`);
  return results;
}

/**
 * Product Hunt 官方 RSS（Atom 格式，不是 RSS 2.0，没有 <item> 标签）。
 * 无关键词检索能力，拉全量后本地过滤。
 */
export async function searchProductHunt(query: string): Promise<SearchResult[]> {
  await productHuntLimiter.wait();

  const response = await axios.get('https://www.producthunt.com/feed', {
    headers: { 'User-Agent': randomUserAgent() },
    timeout: 15000
  });

  const xml = String(response.data);
  const entries = xml.split('<entry>').slice(1);
  const results: SearchResult[] = [];

  for (const raw of entries) {
    const entry = raw.split('</entry>')[0] ?? '';
    const pick = (tag: string): string => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? stripHtml(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : '';
    };

    const title = pick('title');
    // Atom 的链接在属性里：<link rel="alternate" ... href="..."/>
    const hrefMatch = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)
      ?? entry.match(/<link[^>]*href="([^"]+)"/);
    const url = hrefMatch?.[1] ?? '';
    const summary = pick('content') || pick('summary');
    const published = pick('published') || pick('updated');

    if (!title || !url) continue;
    if (!matchesKeyword(`${title} ${summary}`, query)) continue;

    const publishedAt = published ? new Date(published) : undefined;
    results.push({
      title,
      content: summary || title,
      url,
      source: 'producthunt',
      sourceId: url,
      publishedAt: Number.isNaN(publishedAt?.getTime()) ? undefined : publishedAt
    });
  }

  console.log(`Product Hunt search for "${query}": ${results.length} matched of ${entries.length} entries`);
  return results;
}

interface WeixinItem {
  title?: string;
  url?: string;
  content?: string;
  publishedAt?: Date;
}

/**
 * 搜狗微信搜索（公众号文章入口）。
 * 该站没有公开 API，解析 HTML 列表。
 */
export async function searchWeixinSogou(query: string): Promise<SearchResult[]> {
  await weixinLimiter.wait();

  const response = await axios.get('https://weixin.sogou.com/weixin', {
    params: { type: 2, query },
    headers: { 'User-Agent': randomUserAgent() },
    timeout: 15000
  });

  const $ = cheerio.load(String(response.data));
  const items: WeixinItem[] = [];

  $('li[id^="sogou_vr"]').each((_, el) => {
    const node = $(el);
    const anchor = node.find('h3 a').first();
    const title = stripHtml(anchor.text());
    const href = anchor.attr('href') ?? '';
    const content = stripHtml(node.find('.txt-info').first().text());

    if (!title || !href) return;

    // 时间戳藏在 document.write(timeConvert('1791186681')) 里
    const timeMatch = node.find('.s-p').text().match(/timeConvert\('?(\d+)'?\)/);
    const publishedAt = timeMatch ? new Date(Number(timeMatch[1]) * 1000) : undefined;

    items.push({
      title,
      // 相对链接转绝对；该链接是跳转入口，带时效 token
      url: href.startsWith('http') ? href : `https://weixin.sogou.com${href}`,
      content,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined
    });
  });

  const results: SearchResult[] = items.map(item => ({
    title: item.title as string,
    content: item.content || (item.title as string),
    url: item.url as string,
    source: 'weixin' as const,
    publishedAt: item.publishedAt
  }));

  console.log(`Weixin(Sogou) search for "${query}": found ${results.length} results`);
  return results;
}
