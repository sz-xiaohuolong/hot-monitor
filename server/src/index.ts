import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cron from 'node-cron';

import { prisma } from './db.js';
import keywordsRouter from './routes/keywords.js';
import hotspotsRouter from './routes/hotspots.js';
import settingsRouter from './routes/settings.js';
import notificationsRouter from './routes/notifications.js';
import { createScanRouter, startScan } from './routes/scan.js';
import { executeScan } from './jobs/hotspotChecker.js';
import { tryStartScan } from './jobs/scanManager.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/keywords', keywordsRouter);
app.use('/api/hotspots', hotspotsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/scan', createScanRouter(io));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 旧路径，语义与 POST /api/scan 完全一致（202 启动 / 409 已在跑）
app.post('/api/check-hotspots', startScan(io));

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('subscribe', (keywords: string[]) => {
    keywords.forEach(kw => socket.join(`keyword:${kw}`));
    console.log(`Socket ${socket.id} subscribed to:`, keywords);
  });

  socket.on('unsubscribe', (keywords: string[]) => {
    keywords.forEach(kw => socket.leave(`keyword:${kw}`));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Scheduled job: Run hotspot check every 2 hours
// 频率同时体现在 client/src/App.tsx 的展示文案与 docs 说明中，调整时需三处同步。
cron.schedule('0 */2 * * *', () => {
  console.log('🔄 Running scheduled hotspot check...');
  // 撞上运行中的扫描就跳过，不排队 —— 排队会在长扫描结束后立刻再打一轮外部 API。
  // tryStartScan 是同步返回的，异常已在内部收口，所以这里不需要 try/catch。
  const { started } = tryStartScan(io, 'cron', (ctx) => executeScan(ctx, io));
  if (!started) {
    console.warn('⏭ 定时扫描跳过：已有扫描在进行中');
  }
});

// Export for use in other modules
export { io };

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`
  🔥 热点监控服务启动成功!
  📡 Server running on http://localhost:${PORT}
  🔌 WebSocket ready
  ⏰ Hotspot check scheduled every 2 hours
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
