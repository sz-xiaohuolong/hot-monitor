/**
 * 信源健康度测试
 *
 * 这是「失败静默」修复的核心回归保护：
 * 必须能区分「成功但 0 条」与「抓取失败」。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runSource,
  toHealth,
  recordHealth,
  resetHealth,
  getHealthSnapshot,
  formatHealthLine
} from '../services/sourceHealth.js';
import type { SearchResult } from '../types.js';

function item(source: SearchResult['source'] = 'bing'): SearchResult {
  return { title: 't', content: 'c', url: 'https://example.com', source };
}

beforeEach(() => {
  resetHealth();
});

describe('runSource', () => {
  it('正常返回空数组判定为成功（真的没搜到）', async () => {
    const outcome = await runSource('bing', async () => []);

    expect(outcome.status).toBe('ok');
    expect(outcome.items).toEqual([]);
  });

  it('抛出异常判定为失败，并保留原因', async () => {
    const outcome = await runSource('twitter', async () => {
      throw new Error('Credits is not enough');
    });

    expect(outcome.status).toBe('error');
    expect(outcome.items).toEqual([]);
    if (outcome.status === 'error') {
      expect(outcome.error).toContain('Credits is not enough');
    }
  });

  it('非 Error 抛出物也能被记录', async () => {
    const outcome = await runSource('x', async () => {
      throw '字符串异常';
    });

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.error).toBe('字符串异常');
  });

  it('返回值不是数组时按空结果处理，不崩溃', async () => {
    const outcome = await runSource('x', async () => null as unknown as SearchResult[]);

    expect(outcome.status).toBe('ok');
    expect(outcome.items).toEqual([]);
  });
});

describe('健康度账本', () => {
  it('成功信源记录条数，失败信源记录原因', async () => {
    const ok = await runSource('bilibili', async () => [item('bilibili'), item('bilibili')]);
    const bad = await runSource('twitter', async () => {
      throw new Error('HTTP 402');
    });

    recordHealth(toHealth('bilibili', ok, 12));
    recordHealth(toHealth('twitter', bad, 5));

    const { sources } = getHealthSnapshot();
    const bili = sources.find(s => s.name === 'bilibili');
    const tw = sources.find(s => s.name === 'twitter');

    expect(bili).toMatchObject({ ok: true, items: 2, error: null });
    expect(tw).toMatchObject({ ok: false, items: 0 });
    expect(tw?.error).toContain('HTTP 402');
  });

  it('同名信源重复记录只保留最新一条', () => {
    recordHealth({ name: 'bing', ok: true, items: 3, error: null, durationMs: 1 });
    recordHealth({ name: 'bing', ok: true, items: 9, error: null, durationMs: 2 });

    const { sources } = getHealthSnapshot();
    expect(sources.filter(s => s.name === 'bing')).toHaveLength(1);
    expect(sources[0].items).toBe(9);
  });

  it('resetHealth 清空上一轮结果', () => {
    recordHealth({ name: 'bing', ok: true, items: 3, error: null, durationMs: 1 });
    resetHealth();

    expect(getHealthSnapshot().sources).toEqual([]);
  });

  it('摘要行显式标出失败信源', async () => {
    const bad = await runSource('twitter', async () => {
      throw new Error('Credits is not enough');
    });
    recordHealth(toHealth('twitter', bad, 1));
    recordHealth({ name: 'bing', ok: true, items: 10, error: null, durationMs: 1 });

    const line = formatHealthLine();

    expect(line).toContain('bing=10');
    expect(line).toContain('❌');
    expect(line).toContain('失败信源: twitter');
  });

  it('全部成功时不出现失败提示', () => {
    recordHealth({ name: 'bing', ok: true, items: 10, error: null, durationMs: 1 });

    expect(formatHealthLine()).not.toContain('失败信源');
  });

  it('无记录时给出明确提示', () => {
    expect(formatHealthLine()).toContain('无记录');
  });
});
