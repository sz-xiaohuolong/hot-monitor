import type { Server } from 'socket.io';

export type ScanTrigger = 'manual' | 'cron';
export type ScanTerminalStatus = 'completed' | 'cancelled' | 'failed';

/** 取消信号。hotspotChecker 在检查点抛出，由 scanManager 统一转成 cancelled 终态。 */
export class ScanCancelledError extends Error {
  constructor() {
    super('扫描已停止');
    this.name = 'ScanCancelledError';
  }
}

export interface ScanProgress {
  /** 1-based，正在处理第几个关键词 */
  keywordIndex: number;
  keywordTotal: number;
  currentKeyword: string | null;
  newHotspots: number;
}

export interface LastRunSnapshot {
  runId: string;
  trigger: ScanTrigger;
  status: ScanTerminalStatus;
  newHotspots: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
}

export interface ScanSnapshot {
  isRunning: boolean;
  cancelRequested: boolean;
  runId: string | null;
  trigger: ScanTrigger | null;
  startedAt: string | null;
  progress: ScanProgress | null;
  lastRun: LastRunSnapshot | null;
}

/** 传给 hotspotChecker 的运行上下文。它只消费这个，不直接碰模块状态。 */
export interface ScanContext {
  runId: string;
  signal: AbortSignal;
  reportProgress: (patch: Partial<ScanProgress>) => void;
  /** 在一个热点条目完整落库并推送之后调用（原子单位的边界）。 */
  onHotspotFound: () => void;
}

interface ActiveRun {
  runId: string;
  trigger: ScanTrigger;
  startedAt: number;
  controller: AbortController;
  progress: ScanProgress;
}

// 模块级状态：唯一真相源。锁与运行态是同一个对象，不可能出现"锁住了但没运行态"。
let activeRun: ActiveRun | null = null;
let lastRun: LastRunSnapshot | null = null;
let ioRef: Server | null = null;

let seq = 0;
function nextRunId(): string {
  seq += 1;
  return `scan_${Date.now().toString(36)}_${seq}`;
}

/** 取消检查点。analyzeContent 会吞掉所有异常，所以取消必须显式抛。 */
export function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ScanCancelledError();
}

/** 可中断的 sleep，替代裸 setTimeout —— 那是取消延迟的最大浪费点。 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ScanCancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ScanCancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function getScanSnapshot(): ScanSnapshot {
  if (!activeRun) {
    return {
      isRunning: false,
      cancelRequested: false,
      runId: null,
      trigger: null,
      startedAt: null,
      progress: null,
      lastRun
    };
  }
  return {
    isRunning: true,
    cancelRequested: activeRun.controller.signal.aborted,
    runId: activeRun.runId,
    trigger: activeRun.trigger,
    startedAt: new Date(activeRun.startedAt).toISOString(),
    progress: { ...activeRun.progress },
    lastRun
  };
}

function finish(
  run: ActiveRun,
  status: ScanTerminalStatus,
  newHotspots: number,
  error?: unknown
): void {
  const finishedAt = Date.now();

  // ⭐ runId 守卫：旧 run 迟到的收尾绝不能释放新 run 的锁。
  // 没有这一行，用户"停止后立刻再点扫描"会让旧 run 把新 run 的锁释放掉，
  // 第三次触发就能溜进来，又变成并发扫描。
  if (activeRun?.runId === run.runId) {
    activeRun = null;
  }

  lastRun = {
    runId: run.runId,
    trigger: run.trigger,
    status,
    newHotspots,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - run.startedAt,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
  };

  // 终态只有一个事件，用 status 区分。前端一个 handler，不会因两事件乱序卡死。
  ioRef?.emit('scan:completed', {
    runId: run.runId,
    status,
    newHotspots,
    startedAt: lastRun.startedAt,
    finishedAt: lastRun.finishedAt,
    durationMs: lastRun.durationMs
  });

  const label: Record<ScanTerminalStatus, string> = {
    completed: '完成',
    cancelled: '已停止',
    failed: '失败'
  };
  console.log(
    `🏁 扫描${label[status]}（${run.trigger}）：新增 ${newHotspots} 条，耗时 ${Math.round(lastRun.durationMs / 1000)}s`
  );
}

/**
 * 尝试启动一轮扫描。已在跑则返回 started:false，调用方应回 409。
 *
 * ⚠️ 从检查 activeRun 到赋值之间**不能有任何 await**，否则与 cron tick 存在竞态。
 */
export function tryStartScan(
  io: Server,
  trigger: ScanTrigger,
  execute: (ctx: ScanContext) => Promise<number>
): { started: boolean; snapshot: ScanSnapshot } {
  ioRef = io;

  if (activeRun) {
    return { started: false, snapshot: getScanSnapshot() };
  }

  const runId = nextRunId();
  const run: ActiveRun = {
    runId,
    trigger,
    startedAt: Date.now(),
    controller: new AbortController(),
    progress: { keywordIndex: 0, keywordTotal: 0, currentKeyword: null, newHotspots: 0 }
  };
  activeRun = run; // 同步占锁

  // keywordTotal 要等 hotspotChecker 查到关键词才知道，由首次 reportProgress 带上。
  io.emit('scan:started', {
    runId,
    trigger,
    startedAt: new Date(run.startedAt).toISOString()
  });
  console.log(`\n🚀 扫描启动（${trigger}）${runId}`);

  const ctx: ScanContext = {
    runId,
    signal: run.controller.signal,
    reportProgress: (patch) => {
      if (activeRun?.runId !== runId) return; // 过期 run 不再改状态
      Object.assign(run.progress, patch);
      io.emit('scan:progress', { runId, ...run.progress });
    },
    onHotspotFound: () => {
      if (activeRun?.runId !== runId) return;
      run.progress.newHotspots += 1;
      io.emit('scan:progress', { runId, ...run.progress });
    }
  };

  void execute(ctx)
    .then((newHotspots) => finish(run, 'completed', newHotspots))
    .catch((error) => {
      if (error instanceof ScanCancelledError) {
        // 已入库的热点保留不回滚：它们已经推给前端、可能已发邮件，
        // 且都是去重后的有效数据。取消 = 停止继续产出，不是撤销已产出。
        finish(run, 'cancelled', run.progress.newHotspots);
      } else {
        console.error('❌ 扫描异常:', error);
        finish(run, 'failed', run.progress.newHotspots, error);
      }
    });

  return { started: true, snapshot: getScanSnapshot() };
}

/** 请求停止当前扫描。幂等：没在跑也返回 200 语义。 */
export function requestCancel(): { cancelRequested: boolean; snapshot: ScanSnapshot } {
  if (!activeRun) {
    return { cancelRequested: false, snapshot: getScanSnapshot() };
  }

  if (!activeRun.controller.signal.aborted) {
    const { runId } = activeRun;
    activeRun.controller.abort();
    console.log(`🛑 收到停止请求，正在中断 ${runId}...`);
    // 中间态事件，只用于 UI 显示"停止中…"，不改变 isRunning。
    // 丢了这个事件也不影响状态正确性 —— 刻意的降级设计。
    ioRef?.emit('scan:cancelling', { runId });
  }

  return { cancelRequested: true, snapshot: getScanSnapshot() };
}
