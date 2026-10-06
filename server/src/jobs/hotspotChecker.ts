import { Server } from 'socket.io';
import { prisma } from '../db.js';
import { searchTwitter } from '../services/twitter.js';
import { searchBing, searchHackerNews, deduplicateResults } from '../services/search.js';
import { searchSogou, searchBilibili, searchWeibo, detectAndFetchAccount } from '../services/chinaSearch.js';
import { searchNewSources } from '../services/newSourcesAggregator.js';
import {
  runSource,
  recordHealth,
  toHealth,
  resetHealth,
  formatHealthLine
} from '../services/sourceHealth.js';
import { analyzeContent, expandKeyword, preMatchKeyword } from '../services/ai.js';
import { sendHotspotEmail } from '../services/email.js';
import { assertNotCancelled, sleep, ScanCancelledError, type ScanContext } from './scanManager.js';
import type { SearchResult } from '../types.js';

// 新鲜度过滤：丢弃超过指定小时数的内容
// Twitter 层面已通过 since: 限制了时间范围，这里只做兜底
const MAX_AGE_HOURS = 7 * 24; // 7天

function filterByFreshness(results: SearchResult[]): SearchResult[] {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000);
  return results.filter(item => {
    // 没有发布时间的，暂时保留（搜索引擎结果通常没有时间）
    if (!item.publishedAt) return true;
    return item.publishedAt >= cutoff;
  });
}

// 按来源优先级排序：Twitter > 微博 > B站/账号内容 > 搜索引擎
function prioritizeResults(results: SearchResult[]): SearchResult[] {
  const priorityMap: Record<string, number> = {
    twitter: 1,
    weibo: 2,
    bilibili: 3,
    hackernews: 4,
    github: 5,
    juejin: 6,
    csdn: 7,
    oschina: 8,
    weixin: 9,
    producthunt: 10,
    sogou: 11,
    bing: 12,
    google: 13,
    duckduckgo: 14
  };
  return [...results].sort((a, b) => {
    return (priorityMap[a.source] || 99) - (priorityMap[b.source] || 99);
  });
}

/**
 * 执行一轮扫描。取消经 ctx.signal 传递，在检查点显式抛出 ScanCancelledError。
 *
 * ⚠️ 检查点只能落在**热点条目边界**。绝不能插在
 * hotspot.create → notification.create → emit → sendHotspotEmail 这条链中间，
 * 否则会留下"有热点无通知"的孤儿数据。
 */
export async function executeScan(ctx: ScanContext, io: Server): Promise<number> {
  const { signal } = ctx;
  console.log('🔍 Starting hotspot check...');

  // 清空上一轮的信源健康度，本轮结果会被重新填充
  resetHealth();

  assertNotCancelled(signal); // 检查点 1：覆盖"拿到锁后、首个 await 前"到达的取消

  // 获取所有激活的关键词
  const keywords = await prisma.keyword.findMany({
    where: { isActive: true }
  });

  if (keywords.length === 0) {
    console.log('No active keywords to monitor');
    return 0;
  }

  console.log(`Checking ${keywords.length} keywords...`);
  ctx.reportProgress({ keywordTotal: keywords.length, keywordIndex: 0, currentKeyword: null });

  let newHotspotsCount = 0;

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    assertNotCancelled(signal); // 检查点 2：关键词循环顶部
    ctx.reportProgress({ keywordIndex: i + 1, currentKeyword: keyword.text });
    console.log(`\n📎 Checking keyword: "${keyword.text}"`);

    try {
      // 第一步：检测关键词是否为某个平台账号
      console.log(`  🎯 Detecting account for "${keyword.text}"...`);
      const accountResult = await detectAndFetchAccount(keyword.text);
      
      if (accountResult.accounts.length > 0) {
        for (const acc of accountResult.accounts) {
          console.log(`  ✅ Found ${acc.platform} account: ${acc.name} (${acc.followers} followers)`);
        }
      }

      // 第 1.5 步：Query Expansion（查询扩展）
      console.log(`  🔍 Expanding keyword "${keyword.text}"...`);
      const expandedKeywords = await expandKeyword(keyword.text);
      console.log(`  📋 Expanded to ${expandedKeywords.length} variants: ${expandedKeywords.slice(0, 5).join(', ')}${expandedKeywords.length > 5 ? '...' : ''}`);

      // 第二步：从多个来源获取数据（国际 + 国内并行请求）
      // 用 runSource 包装每个信源：旧实现里各 collector 自己 try/catch 后返回 []，
      // 于是"欠费/被反爬/接口变更"与"今天确实没热点"在日志里无法区分。
      // 注意：现有 collector 内部已 catch 的失败仍会表现为 0 条，
      // 这层包装能捕获的是它们向外抛出的异常（如 future 改动、超时）。
      const wrapped = await Promise.all(
        (
          [
            ['twitter', () => searchTwitter(keyword.text)],
            ['bing', () => searchBing(keyword.text)],
            ['hackernews', () => searchHackerNews(keyword.text)],
            ['sogou', () => searchSogou(keyword.text)],
            ['bilibili', () => searchBilibili(keyword.text)],
            ['weibo', () => searchWeibo(keyword.text)]
          ] as Array<[string, () => Promise<SearchResult[]>]>
        ).map(async ([name, runner]) => {
          const startedAt = Date.now();
          const outcome = await runSource(name, runner);
          return { name, outcome, durationMs: Date.now() - startedAt };
        })
      );

      // 新增信源（自带健康度记录）
      const newSourceOutcome = await Promise.allSettled([searchNewSources(keyword.text)]);

      // 检查点 3：6 路搜索是最慢且不可中断的阶段，在这里放行取消
      // 可以跳过整个 AI 内层循环（那才是真正烧钱的部分）
      assertNotCancelled(signal);

      const allResults: SearchResult[] = [];
      
      // 优先添加账号检测到的最新内容
      if (accountResult.results.length > 0) {
        allResults.push(...accountResult.results);
        console.log(`  AccountFetch: ${accountResult.results.length} results`);
      }

      for (const { name, outcome, durationMs } of wrapped) {
        recordHealth(toHealth(name, outcome, durationMs));
        if (outcome.status === 'error') {
          console.log(`  ${name}: ❌ 失败 - ${outcome.error}`);
        } else {
          console.log(`  ${name}: ${outcome.items.length} results`);
        }
        allResults.push(...outcome.items);
      }

      if (newSourceOutcome[0].status === 'fulfilled') {
        allResults.push(...newSourceOutcome[0].value);
      } else {
        console.error('  新增信源聚合失败:', newSourceOutcome[0].reason);
      }

      // 去重 → 新鲜度过滤 → 按来源优先级排序
      const uniqueResults = deduplicateResults(allResults);
      const freshResults = filterByFreshness(uniqueResults);
      const sortedResults = prioritizeResults(freshResults);
      console.log(`  Total: ${allResults.length} raw → ${uniqueResults.length} unique → ${freshResults.length} fresh (within ${MAX_AGE_HOURS}h)`);

      // 处理结果：Twitter 优先多给配额
      // Twitter 最多处理 15 条，其他来源共享 10 条配额
      let twitterProcessed = 0;
      let otherProcessed = 0;
      const TWITTER_QUOTA = 15;
      const OTHER_QUOTA = 10;

      for (const item of sortedResults) {
        // 检查点 4：条目循环顶部。保证取消永远从条目边界切入，
        // 不会切在"已分析完但还没入库"或"已入库但还没建通知"的中间。
        assertNotCancelled(signal);

        // 检查配额
        if (item.source === 'twitter' && twitterProcessed >= TWITTER_QUOTA) continue;
        if (item.source !== 'twitter' && otherProcessed >= OTHER_QUOTA) continue;
        if (twitterProcessed + otherProcessed >= TWITTER_QUOTA + OTHER_QUOTA) break;
        try {
          // 检查是否已存在
          const existing = await prisma.hotspot.findFirst({
            where: {
              url: item.url,
              source: item.source
            }
          });

          if (existing) {
            continue;
          }

          // AI 分析（传入关键词和预匹配结果）
          const fullText = item.title + '\n' + item.content;
          const preMatch = preMatchKeyword(fullText, expandedKeywords);
          const analysis = await analyzeContent(fullText, keyword.text, preMatch);

          // 只保存真实且相关的热点
          if (!analysis.isReal) {
            console.log(`  ❌ Filtered fake/spam: ${item.title.slice(0, 30)}...`);
            continue;
          }

          // 相关性阈值：50 分以下过滤
          if (analysis.relevance < 50) {
            console.log(`  ⏭ Low relevance (${analysis.relevance}): ${item.title.slice(0, 30)}...`);
            continue;
          }

          // 额外规则：关键词未被提及且相关性不足 65 → 过滤
          if (!analysis.keywordMentioned && analysis.relevance < 65) {
            console.log(`  ⏭ Keyword not mentioned & relevance < 65 (${analysis.relevance}): ${item.title.slice(0, 30)}...`);
            continue;
          }

          // 保存热点
          const hotspot = await prisma.hotspot.create({
            data: {
              title: item.title,
              content: item.content,
              url: item.url,
              source: item.source,
              sourceId: item.sourceId || null,
              isReal: analysis.isReal,
              relevance: analysis.relevance,
              relevanceReason: analysis.relevanceReason || null,
              keywordMentioned: analysis.keywordMentioned ?? null,
              importance: analysis.importance,
              summary: analysis.summary,
              viewCount: item.viewCount || null,
              likeCount: item.likeCount || null,
              retweetCount: item.retweetCount || null,
              replyCount: item.replyCount || null,
              commentCount: item.commentCount || null,
              quoteCount: item.quoteCount || null,
              danmakuCount: item.danmakuCount || null,
              authorName: item.author?.name || null,
              authorUsername: item.author?.username || null,
              authorAvatar: item.author?.avatar || null,
              authorFollowers: item.author?.followers || null,
              authorVerified: item.author?.verified ?? null,
              publishedAt: item.publishedAt || null,
              keywordId: keyword.id
            },
            include: {
              keyword: true
            }
          });

          if (item.source === 'twitter') twitterProcessed++;
          else otherProcessed++;
          console.log(`  ✅ New hotspot [${item.source}]: ${hotspot.title.slice(0, 40)}... (${analysis.importance})`);

          // 创建通知
          await prisma.notification.create({
            data: {
              type: 'hotspot',
              title: `发现新热点: ${hotspot.title.slice(0, 50)}`,
              content: analysis.summary || hotspot.content.slice(0, 100),
              hotspotId: hotspot.id
            }
          });

          // WebSocket 通知
          io.to(`keyword:${keyword.text}`).emit('hotspot:new', hotspot);
          io.emit('notification', {
            type: 'hotspot',
            title: '发现新热点',
            content: hotspot.title,
            hotspotId: hotspot.id,
            importance: hotspot.importance
          });

          // 邮件通知（仅对高重要级别）
          if (['high', 'urgent'].includes(analysis.importance)) {
            await sendHotspotEmail(hotspot);
          }

          // 一个热点条目到这里才算完整落地 —— 这是原子单位的边界。
          // 计数放在这里而不是 create 之后，是为了让"完成"与"取消"两条路径口径一致。
          newHotspotsCount++;
          ctx.onHotspotFound();

        } catch (error) {
          console.error(`  Error processing result:`, error);
        }
      }

      // 避免过快请求（可中断：停止请求不必干等这两秒空转）
      await sleep(2000, signal); // 检查点 5

    } catch (error) {
      // 取消必须向上抛，交给 scanManager 转成 cancelled 终态。
      // 检查点 3/4/5 都在这层 try 里面，靠这一处 rethrow 兜住。
      // 其它异常（单个关键词失败）继续吞掉，不影响后续关键词。
      if (error instanceof ScanCancelledError) throw error;
      console.error(`Error checking keyword "${keyword.text}":`, error);
    }
  }

  // 把本轮信源健康度显式打出来：失败信源一目了然，不再静默
  console.log(`\n${formatHealthLine()}`);
  console.log(`\n✨ Hotspot check completed. Found ${newHotspotsCount} new hotspots.`);
  return newHotspotsCount;
}
