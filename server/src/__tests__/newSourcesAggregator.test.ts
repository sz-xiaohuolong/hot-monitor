/**
 * 新增信源聚合测试
 *
 * 重点验证：单点失败不影响其他信源，且失败被写入健康度账本。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from '../types.js';

vi.mock('../services/newSources.js', () => ({
  searchJuejin: vi.fn(),
  searchCsdn: vi.fn(),
  searchOschina: vi.fn(),
  searchGithub: vi.fn(),
  searchProductHunt: vi.fn(),
  searchWeixinSogou: vi.fn()
}));

import {
  searchJuejin,
  searchCsdn,
  searchOschina,
  searchGithub,
  searchProductHunt,
  searchWeixinSogou
} from '../services/newSources.js';
import { searchNewSources } from '../services/newSourcesAggregator.js';
import { getHealthSnapshot, resetHealth } from '../services/sourceHealth.js';

const mocks = {
  searchJuejin: vi.mocked(searchJuejin),
  searchCsdn: vi.mocked(searchCsdn),
  searchOschina: vi.mocked(searchOschina),
  searchGithub: vi.mocked(searchGithub),
  searchProductHunt: vi.mocked(searchProductHunt),
  searchWeixinSogou: vi.mocked(searchWeixinSogou)
};

function item(source: SearchResult['source']): SearchResult {
  return { title: `${source} item`, content: 'c', url: `https://example.com/${source}`, source };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHealth();
  Object.values(mocks).forEach(m => m.mockResolvedValue([]));
});

describe('searchNewSources', () => {
  it('合并全部信源的结果', async () => {
    mocks.searchJuejin.mockResolvedValue([item('juejin')]);
    mocks.searchCsdn.mockResolvedValue([item('csdn'), item('csdn')]);
    mocks.searchGithub.mockResolvedValue([item('github')]);

    const results = await searchNewSources('x');

    expect(results).toHaveLength(4);
    expect(results.map(r => r.source).sort()).toEqual(['csdn', 'csdn', 'github', 'juejin']);
  });

  it('单个信源失败不影响其他信源', async () => {
    mocks.searchJuejin.mockRejectedValue(new Error('HTTP 402 Credits is not enough'));
    mocks.searchCsdn.mockResolvedValue([item('csdn')]);

    const results = await searchNewSources('x');

    // 失败的源不贡献结果，但成功的源照常返回
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('csdn');
  });

  it('失败被写入健康度账本，而不是静默变成 0 条', async () => {
    mocks.searchCsdn.mockRejectedValue(new Error('HTTP 402 Credits is not enough'));

    await searchNewSources('x');

    const { sources } = getHealthSnapshot();
    const csdn = sources.find(s => s.name === 'csdn');

    expect(csdn?.ok).toBe(false);
    expect(csdn?.error).toContain('Credits is not enough');
  });

  it('成功但 0 条记为 ok=true（与失败可区分）', async () => {
    mocks.searchOschina.mockResolvedValue([]);

    await searchNewSources('x');

    const { sources } = getHealthSnapshot();
    const oschina = sources.find(s => s.name === 'oschina');

    expect(oschina).toMatchObject({ ok: true, items: 0, error: null });
  });

  it('六个信源全部被记录', async () => {
    await searchNewSources('x');

    const { sources } = getHealthSnapshot();
    const names = sources.map(s => s.name).sort();

    expect(names).toEqual(['csdn', 'github', 'juejin', 'oschina', 'producthunt', 'weixin']);
  });

  it('全部失败时返回空数组且不抛异常（聚合层本身要健壮）', async () => {
    Object.values(mocks).forEach(m => m.mockRejectedValue(new Error('boom')));

    await expect(searchNewSources('x')).resolves.toEqual([]);
    expect(getHealthSnapshot().sources.every(s => !s.ok)).toBe(true);
  });
});
