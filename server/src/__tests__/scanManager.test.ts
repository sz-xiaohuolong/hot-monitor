import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Server } from 'socket.io';

// scanManager 是模块级单例（锁 + 运行态都在模块作用域里），
// 所以每个用例都要拿一份全新的模块实例，否则上一个用例的锁会漏到下一个。
type ScanManager = typeof import('../jobs/scanManager.js');

let sm: ScanManager;

beforeEach(async () => {
  vi.resetModules();
  sm = await import('../jobs/scanManager.js');
});

/** 假的 socket.io Server：只关心 emit 被调了什么。 */
function fakeIo() {
  const emit = vi.fn();
  return { io: { emit } as unknown as Server, emit };
}

/** 手工控制 resolve 时机的 execute，用来复现"旧 run 迟到收尾"的时序。 */
function deferred() {
  let resolve!: (n: number) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 让已 resolve 的 promise 的 .then 回调跑完。 */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('tryStartScan 并发锁', () => {
  it('第一次启动成功，第二次被拒（started:false）', () => {
    const { io } = fakeIo();
    const d = deferred();

    const first = sm.tryStartScan(io, 'manual', () => d.promise);
    expect(first.started).toBe(true);
    expect(first.snapshot.isRunning).toBe(true);
    expect(first.snapshot.trigger).toBe('manual');

    const second = sm.tryStartScan(io, 'cron', () => Promise.resolve(0));
    expect(second.started).toBe(false);
    // 被拒时也要带快照，前端据此同步状态而不是弹错误
    expect(second.snapshot.isRunning).toBe(true);
    expect(second.snapshot.runId).toBe(first.snapshot.runId);

    d.resolve(0);
  });

  it('cron 撞上运行中的扫描时不会启动第二轮', () => {
    const { io } = fakeIo();
    const d = deferred();
    const cronExecute = vi.fn(() => Promise.resolve(0));

    sm.tryStartScan(io, 'manual', () => d.promise);
    sm.tryStartScan(io, 'cron', cronExecute);

    expect(cronExecute).not.toHaveBeenCalled();

    d.resolve(0);
  });

  it('扫描结束后锁释放，可以再次启动', async () => {
    const { io } = fakeIo();

    const first = sm.tryStartScan(io, 'manual', () => Promise.resolve(3));
    expect(first.started).toBe(true);
    await flush();

    expect(sm.getScanSnapshot().isRunning).toBe(false);

    const second = sm.tryStartScan(io, 'manual', () => Promise.resolve(0));
    expect(second.started).toBe(true);
    await flush();
  });

  // 注：finish() 里的 runId 守卫是纵深防御，当前**无法**从公开 API 触发 ——
  // 锁要等 execute settle 才释放，所以新 run 不可能早于旧 run 的收尾拿到锁。
  // 它防的是将来有人把"取消立即释放锁"当成改进（那时旧 run 迟到的 finally
  // 就会释放新 run 的锁，第三次触发溜进来又变成并发扫描）。
  // 这里只能验证可达的那条路径：收尾顺序正确、lastRun 归属不被串。
  it('取消 → 旧 run 收尾 → 新 run 启动：状态与 lastRun 归属正确', async () => {
    const { io } = fakeIo();
    const d1 = deferred();
    const d2 = deferred();

    // run1 启动后取消，但它还卡在不可中断的 AI 调用里（execute 尚未 settle）。
    // execute 等 d1 放行后再查信号 —— 和 executeScan 在检查点抛取消是一致的。
    const run1 = sm.tryStartScan(io, 'manual', async (ctx) => {
      await d1.promise;
      sm.assertNotCancelled(ctx.signal);
      return 0;
    });
    sm.requestCancel();
    expect(sm.getScanSnapshot().cancelRequested).toBe(true);

    // 锁不提前释放：旧 run 未收尾前，新触发被拒（前端当"已在跑"同步状态）
    expect(sm.tryStartScan(io, 'manual', () => d2.promise).started).toBe(false);

    // 旧 run 收尾
    d1.resolve(0);
    await flush();
    expect(sm.getScanSnapshot().isRunning).toBe(false);
    expect(sm.getScanSnapshot().lastRun?.status).toBe('cancelled');

    // 锁已释放，新 run 可以启动，快照归属新 run
    const run2 = sm.tryStartScan(io, 'manual', () => d2.promise);
    expect(run2.started).toBe(true);
    expect(run2.snapshot.runId).not.toBe(run1.snapshot.runId);
    expect(sm.getScanSnapshot().runId).toBe(run2.snapshot.runId);

    d2.resolve(5);
    await flush();
    expect(sm.getScanSnapshot().lastRun?.status).toBe('completed');
    expect(sm.getScanSnapshot().lastRun?.newHotspots).toBe(5);
    expect(sm.getScanSnapshot().lastRun?.runId).toBe(run2.snapshot.runId);
  });
});

describe('取消', () => {
  it('requestCancel 让 signal 变为 aborted', () => {
    const { io } = fakeIo();
    const d = deferred();
    let captured: AbortSignal | null = null;

    sm.tryStartScan(io, 'manual', (ctx) => {
      captured = ctx.signal;
      return d.promise;
    });

    expect(captured!.aborted).toBe(false);
    const { cancelRequested } = sm.requestCancel();
    expect(cancelRequested).toBe(true);
    expect(captured!.aborted).toBe(true);

    d.resolve(0);
  });

  it('取消后 execute 抛 ScanCancelledError → 终态是 cancelled，且保留已产出条数', async () => {
    const { io, emit } = fakeIo();
    let found = 0;

    sm.tryStartScan(io, 'manual', async (ctx) => {
      ctx.onHotspotFound();
      ctx.onHotspotFound();
      found = 2;
      // 让出一次，模拟真实扫描里的 await —— 取消正是在这个空档到达的
      await Promise.resolve();
      sm.assertNotCancelled(ctx.signal); // 下一个检查点
      return 999; // 走不到
    });

    sm.requestCancel();
    await flush();

    const snap = sm.getScanSnapshot();
    expect(snap.isRunning).toBe(false);
    expect(snap.lastRun?.status).toBe('cancelled');
    // 已入库的热点保留不回滚：终态报的是实际产出，不是 execute 的返回值
    expect(snap.lastRun?.newHotspots).toBe(found);

    const completed = emit.mock.calls.find(([event]) => event === 'scan:completed');
    expect(completed?.[1]).toMatchObject({ status: 'cancelled', newHotspots: 2 });
  });

  it('没有进行中的扫描时 cancel 是幂等的', () => {
    const { cancelRequested, snapshot } = sm.requestCancel();
    expect(cancelRequested).toBe(false);
    expect(snapshot.isRunning).toBe(false);
  });

  it('cancel 后立即再触发，旧 run 未 settle 前返回 409 语义（started:false）', () => {
    const { io } = fakeIo();
    const d = deferred();

    sm.tryStartScan(io, 'manual', () => d.promise);
    sm.requestCancel();

    // 旧 run 还卡在不可中断的调用里 —— 此时拒绝新触发是正确行为
    expect(sm.tryStartScan(io, 'manual', () => Promise.resolve(0)).started).toBe(false);

    d.resolve(0);
  });
});

describe('assertNotCancelled / sleep', () => {
  it('未取消时 assertNotCancelled 不抛', () => {
    const controller = new AbortController();
    expect(() => sm.assertNotCancelled(controller.signal)).not.toThrow();
  });

  it('已取消时抛 ScanCancelledError', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => sm.assertNotCancelled(controller.signal)).toThrow(sm.ScanCancelledError);
  });

  it('sleep 到点正常 resolve', async () => {
    const controller = new AbortController();
    await expect(sm.sleep(10, controller.signal)).resolves.toBeUndefined();
  });

  it('sleep 中途取消立即 reject，不等满时长', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const p = sm.sleep(5000, controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow(sm.ScanCancelledError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('已取消的信号传给 sleep 直接 reject', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sm.sleep(5000, controller.signal)).rejects.toThrow(sm.ScanCancelledError);
  });
});

describe('终态与事件', () => {
  it('正常跑完 → status completed，lastRun 带上新增条数', async () => {
    const { io, emit } = fakeIo();
    sm.tryStartScan(io, 'cron', () => Promise.resolve(7));
    await flush();

    const snap = sm.getScanSnapshot();
    expect(snap.lastRun?.status).toBe('completed');
    expect(snap.lastRun?.newHotspots).toBe(7);
    expect(snap.lastRun?.trigger).toBe('cron');

    expect(emit.mock.calls.map(([e]) => e)).toContain('scan:started');
    expect(emit.mock.calls.map(([e]) => e)).toContain('scan:completed');
  });

  it('execute 抛非取消异常 → status failed，并记录错误信息', async () => {
    const { io } = fakeIo();
    sm.tryStartScan(io, 'manual', () => Promise.reject(new Error('搜索接口挂了')));
    await flush();

    const snap = sm.getScanSnapshot();
    expect(snap.isRunning).toBe(false);
    expect(snap.lastRun?.status).toBe('failed');
    expect(snap.lastRun?.error).toBe('搜索接口挂了');
  });

  it('reportProgress 广播 scan:progress，且只改自己的 run', async () => {
    const { io, emit } = fakeIo();
    const d = deferred();

    sm.tryStartScan(io, 'manual', (ctx) => {
      ctx.reportProgress({ keywordIndex: 3, keywordTotal: 7, currentKeyword: 'Claude' });
      ctx.onHotspotFound();
      return d.promise;
    });

    const progress = emit.mock.calls.filter(([e]) => e === 'scan:progress');
    expect(progress.at(-1)?.[1]).toMatchObject({
      keywordIndex: 3,
      keywordTotal: 7,
      currentKeyword: 'Claude',
      newHotspots: 1
    });

    d.resolve(0);
  });
});
