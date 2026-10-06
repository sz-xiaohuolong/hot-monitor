import { Router, type Request, type Response } from 'express';
import type { Server } from 'socket.io';
import { executeScan } from '../jobs/hotspotChecker.js';
import { getScanSnapshot, tryStartScan, requestCancel } from '../jobs/scanManager.js';
import { getHealthSnapshot } from '../services/sourceHealth.js';

/**
 * 启动一轮扫描。已返回 202 而非等待完成 —— 一轮扫描要跑几分钟，
 * 同步接口会被 Vite dev proxy / nginx 的默认超时掐断。
 */
export function startScan(io: Server) {
  return (_req: Request, res: Response) => {
    const { started, snapshot } = tryStartScan(io, 'manual', (ctx) => executeScan(ctx, io));

    if (!started) {
      // 409 的响应体带上快照，让前端同步状态而不是弹一个没用的错误。
      return res.status(409).json({
        error: 'SCAN_IN_PROGRESS',
        message: '已有扫描在进行中',
        scan: snapshot
      });
    }

    res.status(202).json({ message: '扫描已启动', scan: snapshot });
  };
}

export function createScanRouter(io: Server): Router {
  const router = Router();

  // 页面刷新后据此恢复按钮状态（内存态，进程重启即归零）
  router.get('/status', (_req: Request, res: Response) => {
    res.json(getScanSnapshot());
  });

  router.post('/', startScan(io));

  /**
   * 本轮信源健康度。用于回答「今天没有热点」还是「信源挂了」——
   * 这两件事在旧实现里都表现为 0 条，无法区分。
   * 内存态，进程重启后为空。
   */
  router.get('/health', (_req: Request, res: Response) => {
    const { checkedAt, sources } = getHealthSnapshot();
    res.json({
      checkedAt,
      failed: sources.filter(s => !s.ok).map(s => s.name),
      sources
    });
  });

  // 幂等：没有进行中的扫描也返回 200，只是 cancelRequested: false
  router.post('/cancel', (_req: Request, res: Response) => {
    const { cancelRequested, snapshot } = requestCancel();
    res.json({
      message: cancelRequested ? '已请求停止扫描' : '当前没有进行中的扫描',
      cancelRequested,
      scan: snapshot
    });
  });

  return router;
}
