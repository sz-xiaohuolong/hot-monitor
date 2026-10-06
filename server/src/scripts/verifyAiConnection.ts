/**
 * AI 连通性自检脚本
 *
 * 直接调用应用真实代码路径 analyzeContent / expandKeyword，
 * 确认当前配置的 provider 能拿到可解析的 JSON 结果。
 *
 * 运行：
 *   npx tsx src/scripts/verifyAiConnection.ts
 *   AI_PROVIDER=openrouter npx tsx src/scripts/verifyAiConnection.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { analyzeContent, expandKeyword } from '../services/ai.js';
import { resolveProviderConfig } from '../services/aiProvider.js';

const config = resolveProviderConfig();

console.log('=== provider 配置 ===');
console.log(`provider : ${config.name}`);
console.log(`baseURL  : ${config.baseURL}`);
console.log(`model    : ${config.model}`);
console.log(`apiKey   : ${config.apiKey ? `已配置(len=${config.apiKey.length})` : '未配置 ✗'}`);
console.log('');

async function main() {
  const keyword = 'Claude Sonnet 4.6';

  console.log('=== analyzeContent（真实 AI 相关性分析）===');
  const content = `Anthropic 正式发布 Claude Sonnet 4.6，在 SWE-bench 上取得 77.2%，
推理能力显著提升，并支持 100 万 token 上下文窗口。开发者可以通过 API 立即使用该模型。`;

  const started = Date.now();
  const analysis = await analyzeContent(content, keyword, {
    matched: true,
    matchedTerms: [keyword]
  });
  const elapsed = Date.now() - started;

  console.log(JSON.stringify(analysis, null, 2));
  console.log(`耗时: ${elapsed}ms`);

  const isFallback = analysis.relevanceReason.includes('默认分数');
  if (isFallback) {
    console.log('\n❌ 命中 fallback，说明调用失败，未真正使用 AI');
    process.exitCode = 1;
  } else {
    console.log('\n✅ 真实 AI 分析成功（未命中 fallback）');
  }

  console.log('\n=== expandKeyword（真实查询扩展）===');
  const expanded = await expandKeyword(keyword);
  console.log(`扩展出 ${expanded.length} 个变体:`, expanded);

  if (expanded.length <= 2) {
    console.log('⚠️  变体数量偏少，可能走了规则化 fallback');
  } else {
    console.log('✅ 查询扩展成功');
  }
}

main().catch(err => {
  console.error('❌ 验证脚本异常:', err);
  process.exitCode = 1;
});
