/**
 * 新增信源测试
 *
 * 全部使用 mock，不发起真实网络请求：
 * - 断言各源返回结构与字段映射正确
 * - 断言「失败抛异常」而不是「静默返回空数组」
 *
 * 真实可达性由 src/scripts/verifyNewSources.ts 单独验证。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

import {
  searchJuejin,
  searchCsdn,
  searchOschina,
  searchGithub,
  searchProductHunt,
  searchWeixinSogou
} from '../services/newSources.js';

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================
// 掘金
// ============================================================

describe('掘金 (juejin)', () => {
  function feedItem(overrides: Record<string, unknown> = {}) {
    return {
      item_type: 2,
      item_info: {
        article_info: {
          article_id: '7637856870833635343',
          title: 'Cursor 转 Codex 大半个月',
          brief_content: '聊聊真实感受',
          ctime: '1778379468',
          view_count: 125409,
          digg_count: 506,
          comment_count: 88,
          ...overrides
        },
        author_user_info: { user_name: '深小乐', user_id: '1204720475313342' },
        tags: [{ tag_name: '人工智能' }]
      }
    };
  }

  it('解析推荐流并映射字段', async () => {
    mockedAxios.post.mockResolvedValue({ data: { err_no: 0, data: [feedItem()] } });

    const results = await searchJuejin('Codex');

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('juejin');
    expect(results[0].title).toBe('Cursor 转 Codex 大半个月');
    expect(results[0].url).toBe('https://juejin.cn/post/7637856870833635343');
    expect(results[0].viewCount).toBe(125409);
    expect(results[0].author?.name).toBe('深小乐');
  });

  it('ctime 按「秒」解析，不是当成毫秒', async () => {
    mockedAxios.post.mockResolvedValue({ data: { err_no: 0, data: [feedItem()] } });

    const results = await searchJuejin('Codex');

    // 1778379468 秒 ≈ 2026 年；若误当毫秒会得到 1970 年
    const year = results[0].publishedAt?.getUTCFullYear();
    expect(year).toBeGreaterThan(2020);
  });

  it('按关键词过滤推荐流（掘金无检索接口，只能本地过滤）', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        err_no: 0,
        data: [
          feedItem(),
          feedItem({ article_id: '999', title: 'Vue 组件库实践', brief_content: '与关键词无关' })
        ]
      }
    });

    const results = await searchJuejin('Codex');

    expect(results).toHaveLength(1);
    expect(results[0].title).toContain('Codex');
  });

  it('err_no 非 0 时抛异常，而不是返回空数组', async () => {
    mockedAxios.post.mockResolvedValue({ data: { err_no: 2, err_msg: '请求路由不存在' } });

    await expect(searchJuejin('Codex')).rejects.toThrow(/err_no=2/);
  });

  it('真的没匹配到时返回空数组（不是失败）', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { err_no: 0, data: [feedItem({ title: '完全无关的内容', brief_content: '无关' })] }
    });

    await expect(searchJuejin('ZzzzNotExist')).resolves.toEqual([]);
  });
});

// ============================================================
// CSDN
// ============================================================

describe('CSDN (csdn)', () => {
  it('解析搜索结果并清理高亮标签与追踪参数', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        result_vos: [
          {
            title: '【<em>Claude</em> Code】使用指南',
            url: 'https://blog.csdn.net/u/article/details/155242671?utm_medium=distribute&request_id=abc',
            description: '介绍 <em>Claude</em> Code 的基础操作',
            create_time: '1764000000000',
            view_num: '11694',
            digg: '37',
            author: 'm0_75022408'
          }
        ]
      }
    });

    const results = await searchCsdn('Claude');

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('csdn');
    expect(results[0].title).toBe('【Claude Code】使用指南');
    expect(results[0].content).toBe('介绍 Claude Code 的基础操作');
    // 追踪参数应被去掉
    expect(results[0].url).toBe('https://blog.csdn.net/u/article/details/155242671');
    expect(results[0].viewCount).toBe(11694);
    expect(results[0].likeCount).toBe(37);
  });

  it('create_time（毫秒）解析正确', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result_vos: [{ title: 't', url: 'https://blog.csdn.net/a', create_time: '1764000000000' }] }
    });

    const results = await searchCsdn('x');

    expect(results[0].publishedAt?.getUTCFullYear()).toBe(2025);
  });

  it('缺少 title 或 url 的条目被跳过', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result_vos: [{ title: '只有标题' }, { url: 'https://blog.csdn.net/b' }] }
    });

    await expect(searchCsdn('x')).resolves.toEqual([]);
  });
});

// ============================================================
// 开源中国
// ============================================================

describe('开源中国 (oschina)', () => {
  const html = `
    <div id="newsList">
      <div class="item news-item" data-url="https://www.oschina.net/news/502842">
        <div class="content">
          <h3 class="header"><div class="title" title="NocoBase 更新">🔥 AI 员工支持知识库文档引用：NocoBase</div></h3>
          <div class="description"><p class="line-clamp">汇总一周产品更新日志，NocoBase 更新包括三个分支</p></div>
        </div>
      </div>
      <div class="item news-item" data-url="https://www.oschina.net/news/502841">
        <div class="content">
          <h3 class="header"><div class="title" title="Zig 发布">破釜沉舟奔向 1.0：Zig 0.17.0 正式发布</div></h3>
          <div class="description"><p class="line-clamp">底层系统编程语言 Zig 迎来里程碑</p></div>
        </div>
      </div>
    </div>`;

  it('从 #newsList 解析资讯条目', async () => {
    mockedAxios.get.mockResolvedValue({ data: html });

    const results = await searchOschina('NocoBase');

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('oschina');
    expect(results[0].title).toContain('NocoBase');
    expect(results[0].url).toBe('https://www.oschina.net/news/502842');
    expect(results[0].content).toContain('产品更新日志');
  });

  it('关键词不匹配的条目被过滤', async () => {
    mockedAxios.get.mockResolvedValue({ data: html });

    await expect(searchOschina('ZzzzNotExist')).resolves.toEqual([]);
  });

  it('页面结构变化导致解析不到节点时返回空数组（可被健康度捕获为 0 条）', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html><body>改了版式</body></html>' });

    await expect(searchOschina('NocoBase')).resolves.toEqual([]);
  });
});

// ============================================================
// GitHub
// ============================================================

describe('GitHub (github)', () => {
  it('解析仓库搜索结果', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        total_count: 540006,
        items: [
          {
            full_name: 'anthropics/claude-code',
            html_url: 'https://github.com/anthropics/claude-code',
            description: 'Claude Code CLI',
            stargazers_count: 12345,
            forks_count: 678,
            pushed_at: '2026-10-01T00:00:00Z',
            owner: { login: 'anthropics', avatar_url: 'https://avatars.example/a.png' }
          }
        ]
      }
    });

    const results = await searchGithub('Claude Code');

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('github');
    expect(results[0].title).toBe('anthropics/claude-code');
    expect(results[0].url).toBe('https://github.com/anthropics/claude-code');
    expect(results[0].viewCount).toBe(12345);
    expect(results[0].author?.name).toBe('anthropics');
  });

  it('GitHub 返回 message（限流/鉴权）时抛异常而不是空数组', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { message: 'API rate limit exceeded for 1.2.3.4.' }
    });

    await expect(searchGithub('x')).rejects.toThrow(/rate limit/);
  });

  it('配置 GITHUB_TOKEN 时带上 Authorization 头', async () => {
    const original = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_test';
    mockedAxios.get.mockResolvedValue({ data: { items: [] } });

    try {
      await searchGithub('x');
      const call = mockedAxios.get.mock.calls[0];
      expect(call[1]?.headers).toMatchObject({ Authorization: 'Bearer ghp_test' });
    } finally {
      if (original === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = original;
    }
  });

  it('未配置 token 时不带 Authorization 头', async () => {
    const original = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    mockedAxios.get.mockResolvedValue({ data: { items: [] } });

    try {
      await searchGithub('x');
      const call = mockedAxios.get.mock.calls[0];
      expect(call[1]?.headers).not.toHaveProperty('Authorization');
    } finally {
      if (original !== undefined) process.env.GITHUB_TOKEN = original;
    }
  });
});

// ============================================================
// Product Hunt（Atom 格式，不是 RSS 2.0）
// ============================================================

describe('Product Hunt (producthunt)', () => {
  const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Product Hunt</title>
  <entry>
    <title>Claude Devboard</title>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/posts/claude-devboard"/>
    <published>2026-10-05T00:00:00-07:00</published>
    <content type="html">&lt;p&gt;An AI dashboard for Claude&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>无关产品</title>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/posts/other"/>
    <published>2026-10-05T00:00:00-07:00</published>
    <content type="html">&lt;p&gt;nothing related&lt;/p&gt;</content>
  </entry>
</feed>`;

  it('解析 Atom <entry>（不是 <item>）并按关键词过滤', async () => {
    mockedAxios.get.mockResolvedValue({ data: atom });

    const results = await searchProductHunt('Claude');

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('producthunt');
    expect(results[0].title).toBe('Claude Devboard');
    expect(results[0].url).toBe('https://www.producthunt.com/posts/claude-devboard');
    expect(results[0].publishedAt).toBeInstanceOf(Date);
  });

  it('正确解码 CDATA 与 HTML 实体', async () => {
    mockedAxios.get.mockResolvedValue({ data: atom });

    const results = await searchProductHunt('Claude');

    expect(results[0].content).toBe('An AI dashboard for Claude');
  });
});

// ============================================================
// 搜狗微信
// ============================================================

describe('搜狗微信 (weixin)', () => {
  const html = `
    <ul class="news-list">
      <li id="sogou_vr_11002601_box_0">
        <div class="txt-box">
          <h3><a href="/link?url=abc123&type=2&query=Claude">Claude注册+下载教程</a></h3>
          <p class="txt-info">很多人刚准备使用 Claude，就卡在账号注册上</p>
          <div class="s-p">每日搞笑猛料document.write(timeConvert('1791186681'))</div>
        </div>
      </li>
    </ul>`;

  it('解析标题、摘要，并把相对链接转成绝对链接', async () => {
    mockedAxios.get.mockResolvedValue({ data: html });

    const results = await searchWeixinSogou('Claude');

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('weixin');
    expect(results[0].title).toBe('Claude注册+下载教程');
    expect(results[0].content).toContain('账号注册');
    expect(results[0].url).toMatch(/^https:\/\/weixin\.sogou\.com\/link\?url=/);
  });

  it('从 document.write(timeConvert(...)) 中提取发布时间', async () => {
    mockedAxios.get.mockResolvedValue({ data: html });

    const results = await searchWeixinSogou('Claude');

    // 1791186681 秒 → 2026 年
    expect(results[0].publishedAt?.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('抽取不到条目时返回空数组', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html>请输入验证码</html>' });

    await expect(searchWeixinSogou('Claude')).resolves.toEqual([]);
  });
});

// ============================================================
// 失败语义：所有新源都必须抛异常，而不是静默返回 []
// ============================================================

describe('失败语义（关键回归点）', () => {
  const sources: Array<[string, (q: string) => Promise<unknown>]> = [
    ['juejin', searchJuejin],
    ['csdn', searchCsdn],
    ['oschina', searchOschina],
    ['github', searchGithub],
    ['producthunt', searchProductHunt],
    ['weixin', searchWeixinSogou]
  ];

  it.each(sources)('%s 在网络异常时必须抛异常（不能吞成空数组）', async (_name, fn) => {
    mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fn('x')).rejects.toThrow('ECONNREFUSED');
  });
});
