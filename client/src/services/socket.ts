import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('🔌 Socket connected:', socket?.id);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Socket disconnected');
    });

    socket.on('connect_error', (error) => {
      console.error('🔌 Socket connection error:', error);
    });
  }

  return socket;
}

export function subscribeToKeywords(keywords: string[]): void {
  const s = getSocket();
  s.emit('subscribe', keywords);
}

export function unsubscribeFromKeywords(keywords: string[]): void {
  const s = getSocket();
  s.emit('unsubscribe', keywords);
}

export interface HotspotEvent {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  importance: string;
  summary: string | null;
  keyword?: { text: string } | null;
}

export interface NotificationEvent {
  type: string;
  title: string;
  content: string;
  hotspotId?: string;
  importance?: string;
}

export function onNewHotspot(callback: (hotspot: HotspotEvent) => void): () => void {
  const s = getSocket();
  s.on('hotspot:new', callback);
  return () => s.off('hotspot:new', callback);
}

export function onNotification(callback: (notification: NotificationEvent) => void): () => void {
  const s = getSocket();
  s.on('notification', callback);
  return () => s.off('notification', callback);
}

// ── 扫描生命周期事件 ──────────────────────────────────────────────
// 全部带 runId，前端据此丢弃过期事件（例如停止后旧 run 迟到的事件）。

export interface ScanStartedEvent {
  runId: string;
  trigger: 'manual' | 'cron';
  startedAt: string;
}

export interface ScanProgressEvent {
  runId: string;
  keywordIndex: number;
  keywordTotal: number;
  currentKeyword: string | null;
  newHotspots: number;
}

export interface ScanCancellingEvent {
  runId: string;
}

/** 唯一的终态事件。completed / cancelled / failed 都走这里，靠 status 区分。 */
export interface ScanCompletedEvent {
  runId: string;
  status: 'completed' | 'cancelled' | 'failed';
  newHotspots: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export function onScanStarted(callback: (e: ScanStartedEvent) => void): () => void {
  const s = getSocket();
  s.on('scan:started', callback);
  return () => s.off('scan:started', callback);
}

export function onScanProgress(callback: (e: ScanProgressEvent) => void): () => void {
  const s = getSocket();
  s.on('scan:progress', callback);
  return () => s.off('scan:progress', callback);
}

export function onScanCancelling(callback: (e: ScanCancellingEvent) => void): () => void {
  const s = getSocket();
  s.on('scan:cancelling', callback);
  return () => s.off('scan:cancelling', callback);
}

export function onScanCompleted(callback: (e: ScanCompletedEvent) => void): () => void {
  const s = getSocket();
  s.on('scan:completed', callback);
  return () => s.off('scan:completed', callback);
}

/** 重连后需要重新拉一次扫描状态，否则断线期间错过的终态事件会让按钮永远卡在"扫描中"。 */
export function onSocketConnect(callback: () => void): () => void {
  const s = getSocket();
  s.on('connect', callback);
  return () => s.off('connect', callback);
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
