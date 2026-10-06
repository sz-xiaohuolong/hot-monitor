import type { AIAnalysis } from '../types.js';
import { requireProviderConfig, ApiKeyMissingError } from './aiProvider.js';
import { chatCompletion, extractMessageContent } from './openaiCompatibleClient.js';
import {
  requireJevConfig,
  resolveJevConfig,
  requestJevDecisions,
  noulValue,
  scoreValue,
  type JevQuestions
} from './jevClient.js';

/**
 * 调用一次 AI 补全，provider 与模型均由配置决定（见 aiProvider.ts）。
 * 未配置 API Key 时抛出 ApiKeyMissingError，调用方据此走规则化 fallback。
 */
async function requestCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  params: { temperature: number; maxTokens: number }
): Promise<string> {
  const config = requireProviderConfig();
  const response = await chatCompletion(config, {
    model: config.model,
    messages,
    temperature: params.temperature,
    maxTokens: params.maxTokens
  });
  return extractMessageContent(response);
}

// ========== Query Expansion（查询扩展） ==========

/**
 * 使用 AI 将关键词扩展为多个变体，用于文本预过滤。
 * 返回扩展后的关键词列表（含原始关键词）。
 * 结果会被缓存，同一关键词不会重复调用 AI。
 */
const expansionCache = new Map<string, string[]>();

export async function expandKeyword(keyword: string): Promise<string[]> {
  // 缓存命中
  if (expansionCache.has(keyword)) {
    return expansionCache.get(keyword)!;
  }

  // 不管 AI 是否可用，先提取基础核心词
  const coreTerms = extractCoreTerms(keyword);

  try {
    const responseContent = await requestCompletion(
      [
        {
          role: 'system',
          content: `你是一个搜索查询扩展专家。给定一个监控关键词，生成该关键词的变体和相关检索词，用于文本匹配。

规则：
1. 包含原始关键词的各种写法（大小写、空格、连字符变体）
2. 包含关键词的核心组成词（拆分后的各个有意义的词）
3. 包含常见别称、缩写、中英文对照
4. 不要加入泛化词（比如关键词是"Claude Sonnet 4.6"，不要加"AI模型"这种泛化词）
5. 总数控制在 5-15 个

输出 JSON 数组，只输出 JSON，不要有其他内容。
示例输入："Claude Sonnet 4.6"
示例输出：["Claude Sonnet 4.6", "Claude Sonnet", "Sonnet 4.6", "claude-sonnet-4.6", "Claude 4.6", "Anthropic Sonnet"]`
        },
        {
          role: 'user',
          content: keyword
        }
      ],
      { temperature: 0.2, maxTokens: 300 }
    );

    const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed: string[] = JSON.parse(jsonMatch[0]);
      // 确保原始关键词和核心词都在列表中
      const expanded = [...new Set([keyword, ...coreTerms, ...parsed.map(s => s.trim()).filter(Boolean)])];
      expansionCache.set(keyword, expanded);
      console.log(`  🔍 Query expansion for "${keyword}": ${expanded.length} variants`);
      return expanded;
    }
  } catch (error) {
    // 未配置 API Key 属于预期情况，降级为规则化扩展，不当作错误上报
    if (!(error instanceof ApiKeyMissingError)) {
      console.error('Query expansion failed:', error);
    }
  }

  // Fallback：使用基础核心词
  const fallback = [keyword, ...coreTerms];
  expansionCache.set(keyword, fallback);
  return fallback;
}

/**
 * 从关键词中提取核心词（纯文本方式，不依赖 AI）
 */
function extractCoreTerms(keyword: string): string[] {
  const terms: string[] = [];
  // 按空格、连字符、下划线分割
  const parts = keyword.split(/[\s\-_\/\\·]+/).filter(p => p.length >= 2);
  if (parts.length > 1) {
    terms.push(...parts);
    // 两两组合
    for (let i = 0; i < parts.length - 1; i++) {
      terms.push(parts[i] + ' ' + parts[i + 1]);
    }
  }
  // 去重，排除原始关键词本身
  return [...new Set(terms)].filter(t => t.toLowerCase() !== keyword.toLowerCase());
}

// ========== 关键词预匹配 ==========

/**
 * 检查文本中是否包含任一扩展关键词（不区分大小写）。
 * 返回是否匹配以及匹配到的词。
 */
export function preMatchKeyword(text: string, expandedKeywords: string[]): { matched: boolean; matchedTerms: string[] } {
  const lowerText = text.toLowerCase();
  const matchedTerms: string[] = [];
  for (const kw of expandedKeywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matchedTerms.push(kw);
    }
  }
  return { matched: matchedTerms.length > 0, matchedTerms };
}

// ========== Jev 决策预筛（System One 模型） ==========

/**
 * Jev 粗筛阈值（经真实调用调优，2026-10-05）：
 * - isRealNoul < JEV_ISREAL_REJECT：明确垃圾（营销软文 0.03、标题党 0.20）
 * - relevanceScore === 0：完全无关
 *
 * 注意：Jev 对真实内容的 isReal 判定不稳定（实测真实新闻 0.22~0.69），
 * 所以 Jev 只用于拦截"明确垃圾"，不做最终决策 —— 幸存者仍走 LLM 全量精判。
 */
export const JEV_ISREAL_REJECT = 0.15;
export const JEV_RELEVANCE_REJECT_LEVEL = 0; // score 0 = 完全无关

/**
 * 组装 Jev 的 typed questions（只问粗筛所需的两个维度，减少 token）。
 */
function buildJevQuestions(keyword: string): JevQuestions {
  return {
    isReal: {
      type: 'noul',
      instructions: '这段内容是否为真实有价值的信息（排除标题党、假新闻、营销软文）？',
      criteria: { true: '真实有价值', false: '标题党/假新闻/营销软文' }
    },
    relevance: {
      type: 'score',
      instructions: `内容与监控关键词【${keyword}】的直接相关程度`,
      criteria: ['完全无关', '弱相关', '直接相关', '核心主题']
    }
  };
}

export interface JevPrefilterResult {
  /** Jev 原始 noul 概率（0~1） */
  isRealNoul: number;
  /** Jev 原始 score（0..levels-1） */
  relevanceScore: number;
  /** 是否被 Jev 明确拦截（垃圾/完全无关） */
  rejected: boolean;
  /** 被拦截的原因 */
  rejectReason: string | null;
}

/**
 * Jev 粗筛阶段。仅在启用 JEV_ENABLED 且有密钥时尝试。
 * 任何失败（未启用、缺 key、网络、解析）都抛错 → 由调用方降级到 LLM 全量。
 */
async function runJevPrefilter(content: string, keyword: string): Promise<JevPrefilterResult> {
  const config = requireJevConfig();
  const state = content.slice(0, 2000);

  const response = await requestJevDecisions(config, state, buildJevQuestions(keyword));

  const isRealNoul = noulValue(response, 'isReal');
  const relevanceScore = scoreValue(response, 'relevance');

  let rejected = false;
  let rejectReason: string | null = null;
  if (isRealNoul < JEV_ISREAL_REJECT) {
    rejected = true;
    rejectReason = `Jev 判定疑似垃圾（isReal=${isRealNoul.toFixed(2)} < ${JEV_ISREAL_REJECT}）`;
  } else if (relevanceScore <= JEV_RELEVANCE_REJECT_LEVEL) {
    rejected = true;
    rejectReason = 'Jev 判定与关键词完全无关（score=0）';
  }

  return { isRealNoul, relevanceScore, rejected, rejectReason };
}

// ========== AI 内容分析（关键词感知） ==========

function buildAnalysisPrompt(keyword: string, preMatchResult: { matched: boolean; matchedTerms: string[] }): string {
  const matchHint = preMatchResult.matched 
    ? `\n注意：文本预匹配发现内容中包含以下关键词变体：${preMatchResult.matchedTerms.join('、')}` 
    : `\n注意：文本预匹配发现内容中未直接提及关键词"${keyword}"的任何变体，请特别严格审核相关性。`;

  return `你是一个热点内容精准匹配专家。你的任务是判断一段内容是否与指定的监控关键词【${keyword}】直接相关。

${matchHint}

分析要点：
1. 判断是否为真实有价值的信息（排除标题党、假新闻、营销软文）
2. 判断内容是否【直接】涉及关键词"${keyword}"。注意：
   - 仅仅属于同一领域但未提及关键词的内容，相关性应低于 40 分
   - 内容必须直接讨论、提及或与"${keyword}"有实质关联才能获得 60 分以上
   - 只是间接沾边（如同类产品、同领域但不同主题）应给 30-50 分
3. 判断内容中是否直接提及了"${keyword}"或其等价表述（keywordMentioned）
4. 评估热点的重要程度（对关注"${keyword}"的人来说有多重要）
5. 用一句话说明此内容与"${keyword}"的关系（不是介绍内容本身，而是说"此内容与关键词的关联是什么"）
6. 用一句话解释你的相关性打分理由

请以 JSON 格式输出：
{
  "isReal": true/false,
  "relevance": 0-100,
  "relevanceReason": "相关性打分理由...",
  "keywordMentioned": true/false,
  "importance": "low/medium/high/urgent",
  "summary": "此内容与【${keyword}】的关联：..."
}

只输出 JSON，不要有其他内容。`;
}

/**
 * Jev 粗筛只拦截明确垃圾，幸存者由 LLM 全量精判（见 analyzeContent）。
 */

export async function analyzeContent(content: string, keyword: string, preMatchResult?: { matched: boolean; matchedTerms: string[] }): Promise<AIAnalysis> {
  // 默认预匹配结果
  const matchResult = preMatchResult ?? { matched: false, matchedTerms: [] };

  // ===== 阶段 1：Jev 保守粗筛（可选，默认关闭） =====
  // 只拦截"明确垃圾/完全无关"（阈值经真实调用调优），
  // 不替代 LLM 的最终决策 —— 任何 Jev 失败都降级到 LLM 全量，行为与现状一致。
  if (resolveJevConfig().enabled) {
    try {
      const prefilter = await runJevPrefilter(content, keyword);
      if (prefilter.rejected) {
        // 明确垃圾：零 LLM 成本直接返回低分（会被调用方过滤）
        console.log(`  ⚡ Jev 拦截 [${keyword}]: ${prefilter.rejectReason} (relevance=${prefilter.relevanceScore})`);
        return {
          isReal: false,
          relevance: prefilter.relevanceScore > 0 ? 10 : 0,
          relevanceReason: prefilter.rejectReason ?? 'Jev 预筛拦截',
          keywordMentioned: false,
          importance: 'low',
          summary: ''
        };
      }
      // 幸存者：继续走 LLM 全量精判（保持与现状一致的决策质量）
    } catch (error) {
      console.warn('Jev prefilter failed, falling back to LLM full analysis:', error instanceof Error ? error.message : error);
    }
  }

  // ===== 阶段 2：LLM 全量分析（现状路径，Jev 未启用/幸存者/降级） =====
  try {
    const prompt = buildAnalysisPrompt(keyword, matchResult);

    const responseContent = await requestCompletion(
      [
        {
          role: 'system',
          content: prompt
        },
        {
          role: 'user',
          content: content.slice(0, 2000) // 限制内容长度
        }
      ],
      { temperature: 0.2, maxTokens: 500 } // 降低温度，提高判断一致性
    );

    // 尝试解析 JSON
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isReal: Boolean(parsed.isReal),
        relevance: Math.min(100, Math.max(0, Number(parsed.relevance) || 0)),
        relevanceReason: String(parsed.relevanceReason || '').slice(0, 200),
        keywordMentioned: Boolean(parsed.keywordMentioned),
        importance: ['low', 'medium', 'high', 'urgent'].includes(parsed.importance) 
          ? parsed.importance 
          : 'low',
        summary: String(parsed.summary || '').slice(0, 150)
      };
    }

    throw new Error('Failed to parse AI response');
  } catch (error) {
    // 未配置 API Key：走与「AI 不可用」一致的降级路径
    if (error instanceof ApiKeyMissingError) {
      console.warn(error.message);
    } else {
      console.error('AI analysis failed:', error);
    }
    // Fallback
    return {
      isReal: true,
      relevance: matchResult.matched ? 30 : 10,
      relevanceReason: 'AI 分析失败，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: content.slice(0, 50) + '...'
    };
  }
}

export async function batchAnalyze(contents: string[], keyword: string, expandedKeywords?: string[]): Promise<AIAnalysis[]> {
  // 并行分析，但限制并发数
  const batchSize = 3;
  const results: AIAnalysis[] = [];

  for (let i = 0; i < contents.length; i += batchSize) {
    const batch = contents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(content => {
        const preMatch = expandedKeywords 
          ? preMatchKeyword(content, expandedKeywords) 
          : undefined;
        return analyzeContent(content, keyword, preMatch);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
