/**
 * Jev 接入真实验证（真实网络调用，消耗 QuickRouter 小额额度）
 *
 * 用法：
 *   npx tsx src/scripts/verifyJevConnection.ts
 *
 * 验证内容：
 *   1. JEV 配置解析（.env）
 *   2. Jev System One 决策（真实调用 jev-1.13.0）
 *   3. analyzeContent 两级流水线（Jev 预筛 + LLM 文本生成）端到端
 */

import dotenv from 'dotenv';
dotenv.config();

import { resolveJevConfig, requireJevConfig, requestJevDecisions } from '../services/jevClient.js';
import { analyzeContent } from '../services/ai.js';

async function main() {
  const envCfg = resolveJevConfig();
  console.log('=== Jev 配置（.env）===');
  console.log(`enabled   : ${envCfg.enabled}`);
  console.log(`baseURL   : ${envCfg.baseURL}`);
  console.log(`model     : ${envCfg.model}`);
  console.log(`apiKey    : ${envCfg.apiKey ? `已配置(len=${envCfg.apiKey.length})` : '未配置 ✗'}`);

  if (!envCfg.enabled) {
    console.log('\n⚠️ JEV_ENABLED 未开启，跳过真实调用（这符合默认行为）');
    console.log('如需验证请先设置 JEV_ENABLED=true');
    return;
  }

  const config = requireJevConfig();

  console.log('\n=== 1) Jev 决策（真实调用）===');
  const state = `Anthropic 正式发布 Claude Sonnet 4.6，在 SWE-bench 上取得 77.2%，
推理能力显著提升，并支持 100 万 token 上下文窗口。开发者可以通过 API 立即使用该模型。`;
  const questions = {
    isReal: { type: 'noul' as const, instructions: '这是真实有价值的信息吗？', criteria: { true: '是', false: '否' } },
    relevance: { type: 'score' as const, instructions: '与关键词 Claude 的相关程度', criteria: ['完全无关', '弱相关', '直接相关', '核心主题'] },
    keywordMentioned: { type: 'noul' as const, instructions: '是否直接提及 Claude？', criteria: { true: '是', false: '否' } },
    importance: { type: 'choice' as const, instructions: '重要程度', criteria: { low: '低', medium: '中', high: '高', urgent: '紧急' } }
  };

  const started = Date.now();
  const response = await requestJevDecisions(config, state, questions);
  const elapsed = Date.now() - started;
  console.log(`耗时: ${elapsed}ms`);
  console.log(JSON.stringify(response, null, 2));
  console.log(`usage: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);

  console.log('\n=== 2) analyzeContent 端到端（Jev 预筛 + LLM 文本）===');
  const analysis = await analyzeContent(
    state,
    'Claude Sonnet 4.6',
    { matched: true, matchedTerms: ['Claude Sonnet 4.6'] }
  );
  console.log(JSON.stringify(analysis, null, 2));

  const isFallback = analysis.relevanceReason.includes('默认分数') || analysis.relevanceReason.includes('Jev 预筛未通过');
  if (isFallback) {
    console.log('\n❌ 未走通完整流水线（可能是 Jev 预筛未通过或 LLM 降级）');
    process.exitCode = 1;
  } else {
    console.log('\n✅ 端到端成功：Jev 决策 + LLM 文本生成');
  }
}

main().catch(err => {
  console.error('❌ 验证失败:', err);
  process.exitCode = 1;
});
