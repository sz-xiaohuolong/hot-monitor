import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame, Search, Plus, Bell, Trash2,
  ExternalLink, RefreshCw, X, Check,
  Zap, Twitter, Globe, Eye, Activity, Clock, Target,
  ChevronLeft, ChevronRight, Square,
  MessageCircle, Repeat2, Quote, User, Shield, ShieldAlert,
  ChevronDown, ChevronUp, ChevronsUpDown, ThermometerSun, FileText, Github, AlertTriangle
} from 'lucide-react';
import {
  keywordsApi, hotspotsApi, notificationsApi, scanApi, ApiError,
  type Keyword, type Hotspot, type Stats, type Notification,
  type ScanSnapshot, type ScanProgress, type SourceHealthResponse
} from './services/api';
import {
  onNewHotspot, onNotification, subscribeToKeywords,
  onScanStarted, onScanProgress, onScanCancelling, onScanCompleted, onSocketConnect
} from './services/socket';
import { cn } from './lib/utils';
import { Spotlight } from './components/ui/spotlight';
import { BackgroundBeams } from './components/ui/background-beams';
import ThemeToggle, { useTheme } from './components/ThemeToggle';
import FilterSortBar, { defaultFilterState, type FilterState } from './components/FilterSortBar';
import { sortHotspots } from './utils/sortHotspots';
import { relativeTime, formatDateTime } from './utils/relativeTime';

/** 计算热度综合指标（归一化 0-100） */
function calcHeatScore(h: Hotspot): number {
  const likes = h.likeCount ?? 0;
  const retweets = h.retweetCount ?? 0;
  const replies = h.replyCount ?? 0;
  const comments = h.commentCount ?? 0;
  const quotes = h.quoteCount ?? 0;
  const views = h.viewCount ?? 0;
  // 加权公式：转发最重、其次点赞、然后评论/回复
  const raw = likes * 2 + retweets * 3 + replies * 1.5 + comments * 1.5 + quotes * 2 + views / 100;
  // log 压缩到 0-100
  if (raw <= 0) return 0;
  return Math.min(100, Math.round(Math.log10(raw + 1) * 25));
}

function getHeatLabel(score: number): string {
  if (score >= 80) return '爆';
  if (score >= 60) return '热';
  if (score >= 40) return '温';
  if (score >= 20) return '凉';
  return '冷';
}

/**
 * 重要度：小圆点 + 文字，只有最高两级上色。
 * 颜色是信号不是装饰 —— 四个等级各配一个彩色填充徽章会稀释优先级本身。
 */
const IMPORTANCE_META: Record<string, { label: string; dot: string; text: string }> = {
  urgent: { label: '紧急', dot: 'bg-danger', text: 'text-danger' },
  high: { label: '重要', dot: 'bg-warn', text: 'text-warn' },
  medium: { label: '一般', dot: 'bg-dot-medium', text: 'text-ink-2' },
  low: { label: '低', dot: 'bg-dot-low', text: 'text-ink-3' }
};

type ScanState = 'idle' | 'running' | 'cancelling';

function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [newKeyword, setNewKeyword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'keywords' | 'search'>('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [dashboardFilters, setDashboardFilters] = useState<FilterState>({ ...defaultFilterState });
  const [searchFilters, setSearchFilters] = useState<FilterState>({ ...defaultFilterState });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchResults, setSearchResults] = useState<Hotspot[]>([]);
  // 展开/折叠状态
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedContents, setExpandedContents] = useState<Set<string>>(new Set());
  const [allReasonsExpanded, setAllReasonsExpanded] = useState(false);

  // 扫描状态机：idle | running | cancelling
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const scanRunIdRef = useRef<string | null>(null);

  // 本轮信源健康度：用于区分「今天没热点」与「信源挂了」
  const [sourceHealth, setSourceHealth] = useState<SourceHealthResponse | null>(null);
  const [healthDismissed, setHealthDismissed] = useState(false);

  const isChecking = scanState !== 'idle';

  // 加载数据
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const filterParams: Record<string, string | number> = {
        limit: 20,
        page: currentPage,
      };
      // Apply dashboard filters
      if (dashboardFilters.source) filterParams.source = dashboardFilters.source;
      if (dashboardFilters.importance) filterParams.importance = dashboardFilters.importance;
      if (dashboardFilters.keywordId) filterParams.keywordId = dashboardFilters.keywordId;
      if (dashboardFilters.timeRange) filterParams.timeRange = dashboardFilters.timeRange;
      if (dashboardFilters.isReal) filterParams.isReal = dashboardFilters.isReal;
      if (dashboardFilters.sortBy) filterParams.sortBy = dashboardFilters.sortBy;
      if (dashboardFilters.sortOrder) filterParams.sortOrder = dashboardFilters.sortOrder;

      const [keywordsData, hotspotsData, statsData, notifData] = await Promise.all([
        keywordsApi.getAll(),
        hotspotsApi.getAll(filterParams as any),
        hotspotsApi.getStats(),
        notificationsApi.getAll({ limit: 20 })
      ]);
      setKeywords(keywordsData);
      setHotspots(hotspotsData.data);
      setTotalPages(hotspotsData.pagination.totalPages);
      setStats(statsData);
      setNotifications(notifData.data);
      setUnreadCount(notifData.unreadCount);

      // 订阅关键词
      const activeKeywords = keywordsData.filter(k => k.isActive).map(k => k.text);
      if (activeKeywords.length > 0) {
        subscribeToKeywords(activeKeywords);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dashboardFilters, currentPage]);

  // socket 回调只注册一次，靠 ref 取最新的 loadData，避免每次筛选变化都重订阅
  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  // 当筛选条件变化时重置页码
  useEffect(() => {
    setCurrentPage(1);
  }, [dashboardFilters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── 扫描状态同步 ────────────────────────────────────────────────
  const applySnapshot = useCallback((snap?: ScanSnapshot | null) => {
    if (!snap) return;
    scanRunIdRef.current = snap.runId;
    setScanProgress(snap.progress);
    setScanState(snap.isRunning ? (snap.cancelRequested ? 'cancelling' : 'running') : 'idle');
  }, []);

  /** 拉一次服务端状态。挂载时和 socket 重连时都要调 —— 否则断线期间错过的终态事件会让按钮永远卡在"扫描中"。 */
  const syncScanState = useCallback(async () => {
    try {
      applySnapshot(await scanApi.getStatus());
    } catch {
      // 拿不到就维持现状，不打断界面
    }
  }, [applySnapshot]);

  /**
   * 拉取本轮信源健康度。
   * 只在扫描结束后调用（见下方 scanState 变化），避免无意义轮询。
   */
  const syncSourceHealth = useCallback(async () => {
    try {
      const health = await scanApi.getHealth();
      setSourceHealth(health);
      // 新的一轮出结果后，把上次的关闭动作重置，让新失败能再次提醒
      if (health.failed.length > 0) setHealthDismissed(false);
    } catch {
      // 健康度是辅助信息，拿不到不影响主流程
    }
  }, []);

  useEffect(() => {
    syncScanState();
    syncSourceHealth();
  }, [syncScanState, syncSourceHealth]);

  // 扫描从"进行中"回到 idle 时，刷新一次信源健康度
  const prevScanStateRef = useRef<ScanState>('idle');
  useEffect(() => {
    if (prevScanStateRef.current !== 'idle' && scanState === 'idle') {
      syncSourceHealth();
    }
    prevScanStateRef.current = scanState;
  }, [scanState, syncSourceHealth]);

  // WebSocket 事件
  useEffect(() => {
    const unsubHotspot = onNewHotspot((hotspot) => {
      setHotspots(prev => [hotspot as Hotspot, ...prev.slice(0, 19)]);
      showToast('发现新热点: ' + hotspot.title.slice(0, 30), 'success');
      // 这里不再 loadData()：一次扫描 20 条热点就是 20 次全量刷新。
      // 刷新时机挪到 scan:completed（见下）。
    });

    const unsubNotif = onNotification(() => {
      setUnreadCount(prev => prev + 1);
    });

    // 所有 scan:* 事件都带 runId，据此丢弃过期 run 的迟到事件
    const isStale = (runId: string) =>
      scanRunIdRef.current !== null && runId !== scanRunIdRef.current;

    const unsubScanStarted = onScanStarted((e) => {
      scanRunIdRef.current = e.runId;
      setScanProgress({ keywordIndex: 0, keywordTotal: 0, currentKeyword: null, newHotspots: 0 });
      setScanState('running');
    });

    const unsubScanProgress = onScanProgress((e) => {
      if (isStale(e.runId)) return;
      setScanProgress({
        keywordIndex: e.keywordIndex,
        keywordTotal: e.keywordTotal,
        currentKeyword: e.currentKeyword,
        newHotspots: e.newHotspots
      });
    });

    const unsubScanCancelling = onScanCancelling((e) => {
      if (isStale(e.runId)) return;
      setScanState('cancelling');
    });

    // 唯一的终态事件：completed / cancelled / failed 都走这里
    const unsubScanCompleted = onScanCompleted((e) => {
      if (isStale(e.runId)) return;
      scanRunIdRef.current = null;
      setScanState('idle');
      setScanProgress(null);
      loadDataRef.current?.();

      if (e.status === 'cancelled') {
        showToast(`已停止扫描，保留新增 ${e.newHotspots} 条`, 'success');
      } else if (e.status === 'failed') {
        showToast('扫描失败，请查看服务端日志', 'error');
      } else if (e.newHotspots > 0) {
        showToast(`扫描完成，新增 ${e.newHotspots} 条热点`, 'success');
      }
    });

    const unsubConnect = onSocketConnect(() => {
      syncScanState();
    });

    return () => {
      unsubHotspot();
      unsubNotif();
      unsubScanStarted();
      unsubScanProgress();
      unsubScanCancelling();
      unsubScanCompleted();
      unsubConnect();
    };
  }, [showToast, syncScanState]);

  // 添加关键词
  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;

    try {
      const keyword = await keywordsApi.create({ text: newKeyword.trim() });
      setKeywords(prev => [keyword, ...prev]);
      setNewKeyword('');
      showToast('关键词添加成功', 'success');
      subscribeToKeywords([keyword.text]);
    } catch (error: any) {
      showToast(error.message || '添加失败', 'error');
    }
  };

  // 删除关键词
  const handleDeleteKeyword = async (id: string) => {
    try {
      await keywordsApi.delete(id);
      setKeywords(prev => prev.filter(k => k.id !== id));
      showToast('关键词已删除', 'success');
    } catch (error) {
      showToast('删除失败', 'error');
    }
  };

  // 切换关键词状态
  const handleToggleKeyword = async (id: string) => {
    try {
      const updated = await keywordsApi.toggle(id);
      setKeywords(prev => prev.map(k => k.id === id ? updated : k));
    } catch (error) {
      showToast('操作失败', 'error');
    }
  };

  // 手动搜索
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    try {
      const result = await hotspotsApi.search(searchQuery);
      setSearchResults(result.results);
      showToast(`找到 ${result.results.length} 条结果`, 'success');
    } catch (error) {
      showToast('搜索失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  /** 扫描按钮：空闲→启动，运行中→停止，停止中→禁用 */
  const handleScanButton = async () => {
    if (scanState === 'cancelling') return;

    if (scanState === 'running') {
      setScanState('cancelling'); // 乐观切换，HTTP 响应回来再以服务端快照为准
      try {
        const res = await scanApi.cancel();
        applySnapshot(res.scan);
      } catch (error) {
        showToast('停止请求发送失败', 'error');
        syncScanState();
      }
      return;
    }

    try {
      const res = await scanApi.start();
      applySnapshot(res.scan);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // 已有扫描在跑不是错误 —— 同步状态即可，按钮会自己变成"停止扫描"
        applySnapshot(error.body?.scan);
        return;
      }
      showToast(error instanceof Error ? error.message : '触发失败', 'error');
    }
  };

  // 标记通知为已读
  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // 展开/折叠相关性理由
  const toggleReason = (id: string) => {
    setExpandedReasons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 展开/折叠原始内容
  const toggleContent = (id: string) => {
    setExpandedContents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 一键展开/折叠所有相关性理由
  const toggleAllReasons = (list: Hotspot[]) => {
    if (allReasonsExpanded) {
      setExpandedReasons(new Set());
    } else {
      setExpandedReasons(new Set(list.filter(h => h.relevanceReason).map(h => h.id)));
    }
    setAllReasonsExpanded(!allReasonsExpanded);
  };

  // Client-side filtering/sorting for search results
  const filteredSearchResults = useMemo(() => {
    let results = [...searchResults];

    // Apply filters
    if (searchFilters.source) {
      results = results.filter(h => h.source === searchFilters.source);
    }
    if (searchFilters.importance) {
      results = results.filter(h => h.importance === searchFilters.importance);
    }
    if (searchFilters.isReal === 'true') {
      results = results.filter(h => h.isReal);
    } else if (searchFilters.isReal === 'false') {
      results = results.filter(h => !h.isReal);
    }
    if (searchFilters.keywordId) {
      results = results.filter(h => h.keyword?.id === searchFilters.keywordId);
    }
    if (searchFilters.timeRange) {
      const now = new Date();
      let dateFrom: Date | null = null;
      switch (searchFilters.timeRange) {
        case '1h': dateFrom = new Date(now.getTime() - 60 * 60 * 1000); break;
        case 'today': dateFrom = new Date(now); dateFrom.setHours(0, 0, 0, 0); break;
        case '7d': dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case '30d': dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      }
      if (dateFrom) {
        results = results.filter(h => new Date(h.createdAt) >= dateFrom!);
      }
    }

    // Apply sorting using shared utility
    results = sortHotspots(results, searchFilters.sortBy || 'createdAt', (searchFilters.sortOrder || 'desc') as 'asc' | 'desc');

    return results;
  }, [searchResults, searchFilters]);

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'twitter': return <Twitter className="w-3.5 h-3.5" />;
      case 'bilibili': return <Eye className="w-3.5 h-3.5" />;
      case 'weibo': return <Activity className="w-3.5 h-3.5" />;
      case 'sogou':
      case 'weixin': return <Search className="w-3.5 h-3.5" />;
      case 'hackernews': return <Zap className="w-3.5 h-3.5" />;
      case 'github': return <Github className="w-3.5 h-3.5" />;
      case 'juejin':
      case 'csdn':
      case 'oschina': return <FileText className="w-3.5 h-3.5" />;
      case 'producthunt': return <Target className="w-3.5 h-3.5" />;
      default: return <Globe className="w-3.5 h-3.5" />;
    }
  };

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      twitter: 'Twitter',
      bing: 'Bing',
      google: 'Google',
      sogou: '搜狗',
      bilibili: 'Bilibili',
      weibo: '微博热搜',
      hackernews: 'HackerNews',
      duckduckgo: 'DuckDuckGo',
      juejin: '掘金',
      csdn: 'CSDN',
      oschina: '开源中国',
      github: 'GitHub',
      producthunt: 'Product Hunt',
      weixin: '微信公众号'
    };
    return labels[source] || source;
  };

  const activeKeywordCount = keywords.filter(k => k.isActive).length;
  const scanPercent = scanProgress && scanProgress.keywordTotal > 0
    ? Math.round((scanProgress.keywordIndex / scanProgress.keywordTotal) * 100)
    : 0;
  const scanIndeterminate = isChecking && (!scanProgress || scanProgress.keywordTotal === 0);

  // 扫描按钮三态
  const scanButton = {
    idle: {
      label: '立即扫描',
      icon: <RefreshCw className="w-4 h-4" />,
      className: 'bg-accent text-white hover:bg-accent-hover',
      disabled: false
    },
    running: {
      label: '停止扫描',
      icon: <Square className="w-3.5 h-3.5" />,
      className: 'bg-danger/10 text-danger border border-danger/25 hover:bg-danger/15',
      disabled: false
    },
    cancelling: {
      label: '停止中…',
      icon: <RefreshCw className="w-4 h-4 animate-spin" />,
      className: 'bg-hover text-ink-3 border border-hairline cursor-wait',
      disabled: true
    }
  }[scanState];

  const heroStatus = (() => {
    if (scanState === 'cancelling') return '正在停止当前扫描…';
    if (scanState === 'running') {
      const p = scanProgress;
      const at = p && p.keywordTotal > 0 ? ` ${p.keywordIndex}/${p.keywordTotal}` : '';
      const kw = p?.currentKeyword ? ` · ${p.currentKeyword}` : '';
      const found = p?.newHotspots ? ` · 已发现 ${p.newHotspots} 条` : '';
      return `正在扫描${at}${kw}${found}`;
    }
    return `正在监控 ${activeKeywordCount} 个关键词 · 每 2 小时自动更新`;
  })();
  return (
    <div className="min-h-screen bg-page relative">
      {/* 深色特效只在深色主题下渲染 —— 浅色下它们是纯噪音 */}
      {isDark && (
        <>
          <BackgroundBeams className="z-0" />
          <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#3b82f6" />
          <div className="fixed top-0 right-0 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="fixed bottom-0 left-0 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        </>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-6 left-1/2 z-50 px-5 py-3 rounded-xl backdrop-blur-xl flex items-center gap-3 shadow-[var(--shadow-pop)] border",
              toast.type === 'success'
                ? 'bg-surface border-hairline text-ink'
                : 'bg-surface border-danger/30 text-danger'
            )}
          >
            {toast.type === 'success' ? <Check className="w-4 h-4 text-accent" /> : <X className="w-4 h-4" />}
            <span className="text-body font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header — 毛玻璃导航，发丝线收底 */}
      <header className="sticky top-0 z-40 backdrop-blur-2xl bg-[var(--bg-nav)] border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-9 h-9 rounded-[10px] bg-accent flex items-center justify-center">
                  <Flame className="w-5 h-5 text-white" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[var(--bg-page)]" />
              </div>
              <div>
                <h1 className="text-card font-semibold text-ink">HotPulse</h1>
                <p className="text-caption text-ink-3">AI 热点雷达</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2.5">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />

              <button
                onClick={handleScanButton}
                disabled={scanButton.disabled}
                className={cn(
                  "px-4 py-2 rounded-[10px] text-[13px] font-medium flex items-center gap-2 transition-colors active:scale-[0.98]",
                  scanButton.className
                )}
              >
                {scanButton.icon}
                {scanButton.label}
              </button>

              {/* Notifications */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  aria-label="通知"
                  className="relative flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface text-ink-2 hover:text-ink transition-colors"
                >
                  <Bell className="w-[18px] h-[18px]" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-danger rounded-full text-[10px] font-semibold flex items-center justify-center text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {showNotifications && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
                      className="absolute right-0 top-12 w-80 bg-surface backdrop-blur-2xl rounded-2xl border border-hairline shadow-[var(--shadow-pop)] overflow-hidden"
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
                        <h3 className="text-[13px] font-semibold text-ink">通知</h3>
                        {unreadCount > 0 && (
                          <button onClick={handleMarkAllRead} className="text-caption text-accent hover:opacity-70">
                            全部已读
                          </button>
                        )}
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <p className="text-ink-3 text-body text-center py-8">暂无通知</p>
                        ) : (
                          <div className="divide-y divide-hairline">
                            {notifications.slice(0, 5).map(n => (
                              <div key={n.id} className={cn("px-4 py-3", n.isRead ? 'opacity-50' : '')}>
                                <p className="text-[13px] font-medium text-ink">{n.title}</p>
                                <p className="text-caption text-ink-2 mt-1 line-clamp-2">{n.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* 扫描进度条：整页唯一的"动"的地方 */}
        {isChecking && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-hover overflow-hidden">
            <div
              className={cn(
                "h-full bg-accent transition-[width] duration-500 ease-out",
                scanIndeterminate && "w-full animate-pulse-soft"
              )}
              style={scanIndeterminate ? undefined : { width: `${scanPercent}%` }}
            />
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 py-10">
        {/* Hero — 左对齐：这是扫读工具，居中没有对齐锚点 */}
        <div className="mb-8">
          <h2 className="text-hero font-semibold text-ink">热点雷达</h2>
          <p className="text-body text-ink-2 mt-2">{heroStatus}</p>

          {/* 信源故障提示：让"信源挂了"和"今天没热点"不再混为一谈 */}
          {sourceHealth && sourceHealth.failed.length > 0 && !healthDismissed && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-caption text-ink font-medium">
                  {sourceHealth.failed.length} 个信源抓取失败，本轮结果可能不完整
                </p>
                <p className="text-caption text-ink-3 mt-1 break-words">
                  {sourceHealth.sources
                    .filter(s => !s.ok)
                    .map(s => `${getSourceLabel(s.name)}${s.error ? `（${s.error}）` : ''}`)
                    .join('、')}
                </p>
              </div>
              <button
                onClick={() => setHealthDismissed(true)}
                className="text-ink-3 hover:text-ink shrink-0"
                aria-label="关闭提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Navigation Tabs — 分段控件 */}
        <div className="segmented mb-8">
          {([
            { key: 'dashboard', label: '热点雷达' },
            { key: 'keywords', label: '监控词' },
            { key: 'search', label: '搜索' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              data-active={activeTab === key}
              className="segmented-item"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {/* Stats — 单张卡 + 发丝线分栏，不是四张同款渐变卡 */}
            {stats && (
              <div className="card grid grid-cols-2 lg:grid-cols-4 overflow-hidden">
                {[
                  { label: '总热点', value: stats.total },
                  { label: '今日新增', value: stats.today },
                  { label: '紧急热点', value: stats.urgent },
                  { label: '监控词', value: activeKeywordCount },
                ].map((cell, i) => (
                  <div
                    key={cell.label}
                    className={cn(
                      "px-6 py-5",
                      i % 2 === 1 && "border-l border-hairline",
                      i >= 2 && "border-t border-hairline",
                      "lg:border-t-0",
                      i > 0 && "lg:border-l lg:border-hairline"
                    )}
                  >
                    <p className="text-metric font-semibold text-ink metric-num">{cell.value}</p>
                    <p className="text-caption text-ink-2 mt-1">{cell.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Hotspots Feed */}
            <div>
              <div className="flex items-baseline justify-between mb-4">
                <h3 className="text-section font-semibold text-ink">实时热点流</h3>
                <span className="text-caption text-ink-3">每 2 小时自动更新</span>
              </div>

              {/* Filter & Sort Bar */}
              <div className="mb-5">
                <FilterSortBar
                  filters={dashboardFilters}
                  onChange={setDashboardFilters}
                  keywords={keywords}
                />
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-7 h-7 border-2 border-hairline-strong border-t-accent rounded-full animate-spin" />
                </div>
              ) : hotspots.length === 0 ? (
                <div className="text-center py-16 rounded-[18px] border border-dashed border-hairline-strong">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-hover flex items-center justify-center">
                    <Search className="w-6 h-6 text-ink-3" />
                  </div>
                  <p className="text-body text-ink-2">尚未发现热点</p>
                  <p className="text-caption text-ink-3 mt-1">添加监控关键词开始追踪</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 一键展开/折叠所有理由 */}
                  {hotspots.some(h => h.relevanceReason) && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => toggleAllReasons(hotspots)}
                        className="flex items-center gap-1.5 text-caption text-ink-2 hover:text-accent transition-colors px-3 py-1.5 rounded-lg hover:bg-hover"
                      >
                        <ChevronsUpDown className="w-3.5 h-3.5" />
                        {allReasonsExpanded ? '折叠所有理由' : '展开所有理由'}
                      </button>
                    </div>
                  )}

                  {hotspots.map((hotspot) => {
                    const heatScore = calcHeatScore(hotspot);
                    const meta = IMPORTANCE_META[hotspot.importance] ?? IMPORTANCE_META.medium;
                    return (
                      <div
                        key={hotspot.id}
                        className="group card p-5 transition-colors hover:border-hairline-strong"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            {/* Row 1: 重要度圆点 + 来源 · 关键词 */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2.5">
                              <span className="flex items-center gap-1.5">
                                <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                                <span className={cn("text-caption font-medium", meta.text)}>{meta.label}</span>
                              </span>
                              <span className="flex items-center gap-1.5 text-caption text-ink-2">
                                {getSourceIcon(hotspot.source)}
                                {getSourceLabel(hotspot.source)}
                              </span>
                              {hotspot.keyword && (
                                <span className="text-caption text-ink-3">{hotspot.keyword.text}</span>
                              )}
                              {!hotspot.isReal && (
                                <span className="flex items-center gap-1 text-caption text-danger">
                                  <ShieldAlert className="w-3 h-3" />
                                  可疑
                                </span>
                              )}
                              {hotspot.isReal && hotspot.relevance >= 80 && (
                                <span className="flex items-center gap-1 text-caption text-ink-3">
                                  <Shield className="w-3 h-3" />
                                  可信
                                </span>
                              )}
                              {hotspot.keywordMentioned === true && (
                                <span className="flex items-center gap-1 text-caption text-ink-3">
                                  <Target className="w-3 h-3" />
                                  直接提及
                                </span>
                              )}
                              {hotspot.keywordMentioned === false && (
                                <span className="flex items-center gap-1 text-caption text-ink-3">
                                  <Target className="w-3 h-3" />
                                  间接相关
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-caption text-ink-3 metric-num">
                                <ThermometerSun className="w-3 h-3" />
                                {getHeatLabel(heatScore)} {heatScore}
                              </span>
                            </div>

                            {/* Title */}
                            <h4 className="text-card font-semibold text-ink mb-2 line-clamp-2 group-hover:text-accent transition-colors">
                              {hotspot.title}
                            </h4>

                            {/* AI Summary */}
                            {hotspot.summary && (
                              <p className="text-body text-ink-2 mb-2.5">
                                <span className="text-caption text-ink-3 mr-1.5">AI 摘要</span>
                                {hotspot.summary}
                              </p>
                            )}

                            {/* 作者信息 */}
                            {hotspot.authorName && (
                              <div className="flex items-center gap-2 mb-2.5">
                                {hotspot.authorAvatar ? (
                                  <img src={hotspot.authorAvatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                                ) : (
                                  <User className="w-4 h-4 text-ink-3" />
                                )}
                                <span className="text-caption text-ink-2">
                                  {hotspot.authorName}
                                  {hotspot.authorUsername && <span className="text-ink-3 ml-1">@{hotspot.authorUsername}</span>}
                                </span>
                                {hotspot.authorVerified && (
                                  <span className="text-caption text-accent">✓ 认证</span>
                                )}
                                {hotspot.authorFollowers != null && hotspot.authorFollowers > 0 && (
                                  <span className="text-caption text-ink-3 metric-num">{hotspot.authorFollowers.toLocaleString()} 粉丝</span>
                                )}
                              </div>
                            )}

                            {/* 互动数据 */}
                            <div className="flex flex-wrap items-center gap-3 text-caption text-ink-3 metric-num mb-2">
                              <span className="flex items-center gap-1">
                                <Target className="w-3.5 h-3.5" />
                                相关性 {hotspot.relevance}%
                              </span>
                              {hotspot.likeCount != null && hotspot.likeCount > 0 && (
                                <span className="flex items-center gap-1" title="点赞">
                                  <Zap className="w-3.5 h-3.5" />
                                  {hotspot.likeCount.toLocaleString()}
                                </span>
                              )}
                              {hotspot.retweetCount != null && hotspot.retweetCount > 0 && (
                                <span className="flex items-center gap-1" title="转发">
                                  <Repeat2 className="w-3.5 h-3.5" />
                                  {hotspot.retweetCount.toLocaleString()}
                                </span>
                              )}
                              {hotspot.replyCount != null && hotspot.replyCount > 0 && (
                                <span className="flex items-center gap-1" title="回复">
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  {hotspot.replyCount.toLocaleString()}
                                </span>
                              )}
                              {hotspot.commentCount != null && hotspot.commentCount > 0 && (
                                <span className="flex items-center gap-1" title="评论">
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  {hotspot.commentCount.toLocaleString()}
                                </span>
                              )}
                              {hotspot.quoteCount != null && hotspot.quoteCount > 0 && (
                                <span className="flex items-center gap-1" title="引用">
                                  <Quote className="w-3.5 h-3.5" />
                                  {hotspot.quoteCount.toLocaleString()}
                                </span>
                              )}
                              {hotspot.viewCount != null && hotspot.viewCount > 0 && (
                                <span className="flex items-center gap-1" title="浏览量">
                                  <Eye className="w-3.5 h-3.5" />
                                  {hotspot.viewCount.toLocaleString()}
                                </span>
                              )}
                              {hotspot.danmakuCount != null && hotspot.danmakuCount > 0 && (
                                <span className="flex items-center gap-1" title="弹幕">
                                  💬 {hotspot.danmakuCount.toLocaleString()}
                                </span>
                              )}
                            </div>

                            {/* 时间信息 */}
                            <div className="flex flex-wrap items-center gap-3 text-caption text-ink-3">
                              {hotspot.publishedAt && (
                                <span className="flex items-center gap-1" title={`发布于 ${formatDateTime(hotspot.publishedAt)}`}>
                                  <Clock className="w-3 h-3" />
                                  发布 {relativeTime(hotspot.publishedAt)}
                                </span>
                              )}
                              <span className="flex items-center gap-1" title={`抓取于 ${formatDateTime(hotspot.createdAt)}`}>
                                <Activity className="w-3 h-3" />
                                抓取 {relativeTime(hotspot.createdAt)}
                              </span>
                            </div>

                            {/* AI 相关性理由 - 可折叠 */}
                            {hotspot.relevanceReason && (
                              <div className="mt-2">
                                <button
                                  onClick={() => toggleReason(hotspot.id)}
                                  className="flex items-center gap-1 text-caption text-ink-2 hover:text-accent transition-colors"
                                >
                                  {expandedReasons.has(hotspot.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  AI 分析理由
                                </button>
                                <AnimatePresence initial={false}>
                                  {expandedReasons.has(hotspot.id) && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                                      className="overflow-hidden"
                                    >
                                      <p className="text-caption text-ink-2 mt-1.5 pl-3 border-l border-hairline-strong">
                                        {hotspot.relevanceReason}
                                      </p>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}

                            {/* 原始内容 - 可折叠 */}
                            {hotspot.content && hotspot.content !== hotspot.summary && (
                              <div className="mt-2">
                                <button
                                  onClick={() => toggleContent(hotspot.id)}
                                  className="flex items-center gap-1 text-caption text-ink-2 hover:text-accent transition-colors"
                                >
                                  {expandedContents.has(hotspot.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  <FileText className="w-3 h-3" />
                                  原始内容
                                </button>
                                <AnimatePresence initial={false}>
                                  {expandedContents.has(hotspot.id) && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                                      className="overflow-hidden"
                                    >
                                      <p className="text-caption text-ink-2 mt-1.5 pl-3 border-l border-hairline-strong whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                        {hotspot.content}
                                      </p>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}
                          </div>

                          {/* Link */}
                          <a
                            href={hotspot.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            aria-label="打开原文"
                            className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full border border-hairline text-ink-3 hover:text-accent hover:border-hairline-strong transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && !isLoading && (
                <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    aria-label="上一页"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-ink-2 hover:text-ink hover:border-hairline-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let page: number;
                      if (totalPages <= 7) {
                        page = i + 1;
                      } else if (currentPage <= 4) {
                        page = i + 1;
                      } else if (currentPage >= totalPages - 3) {
                        page = totalPages - 6 + i;
                      } else {
                        page = currentPage - 3 + i;
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={cn(
                            "w-8 h-8 rounded-full text-caption font-medium transition-colors metric-num",
                            currentPage === page
                              ? "bg-accent-soft text-accent"
                              : "text-ink-2 hover:text-ink hover:bg-hover"
                          )}
                        >
                          {page}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    aria-label="下一页"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-ink-2 hover:text-ink hover:border-hairline-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="text-caption text-ink-3 ml-2 metric-num">
                    共 {stats?.total || 0} 条
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Keywords Tab */}
        {activeTab === 'keywords' && (
          <div className="space-y-6">
            {/* Add Keyword Card */}
            <form onSubmit={handleAddKeyword} className="card p-5">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="输入要监控的关键词，如：GPT-5、AI编程、Cursor..."
                    className="w-full px-4 py-3 rounded-xl bg-page border border-hairline text-ink text-body placeholder:text-ink-3 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-accent text-white text-body font-medium flex items-center gap-2 hover:bg-accent-hover transition-colors active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4" />
                  添加
                </button>
              </div>
            </form>

            {/* Keywords Grid */}
            <div className="grid gap-3 md:grid-cols-2">
              <AnimatePresence initial={false}>
                {keywords.map((keyword) => (
                  <motion.div
                    key={keyword.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    className={cn(
                      "group card p-4 transition-colors",
                      keyword.isActive ? "hover:border-hairline-strong" : "opacity-55"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Toggle */}
                        <button
                          onClick={() => handleToggleKeyword(keyword.id)}
                          role="switch"
                          aria-checked={keyword.isActive}
                          aria-label={`${keyword.isActive ? '停用' : '启用'} ${keyword.text}`}
                          className={cn(
                            "w-10 h-6 rounded-full transition-colors relative shrink-0",
                            keyword.isActive ? "bg-accent" : "bg-hairline-strong"
                          )}
                        >
                          <span className={cn(
                            "absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all",
                            keyword.isActive ? "left-5" : "left-1"
                          )} />
                        </button>

                        <div>
                          <span className={cn("text-body font-medium", keyword.isActive ? "text-ink" : "text-ink-3")}>
                            {keyword.text}
                          </span>
                          {keyword._count && keyword._count.hotspots > 0 && (
                            <span className="ml-2 text-caption text-ink-3 metric-num">
                              {keyword._count.hotspots} 条热点
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteKeyword(keyword.id)}
                        aria-label={`删除 ${keyword.text}`}
                        className="p-2 rounded-lg text-ink-3 hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {keywords.length === 0 && (
              <div className="text-center py-16 rounded-[18px] border border-dashed border-hairline-strong">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-hover flex items-center justify-center">
                  <Target className="w-6 h-6 text-ink-3" />
                </div>
                <p className="text-body text-ink-2">还没有监控关键词</p>
                <p className="text-caption text-ink-3 mt-1">添加你想追踪的技术热点词</p>
              </div>
            )}
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            {/* Search Form */}
            <form onSubmit={handleSearch} className="card p-5">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索热点内容..."
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-page border border-hairline text-ink text-body placeholder:text-ink-3 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-3 rounded-xl bg-accent text-white text-body font-medium flex items-center gap-2 hover:bg-accent-hover transition-colors active:scale-[0.98] disabled:opacity-50"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  搜索
                </button>
              </div>
            </form>

            {/* Search Filter & Sort Bar */}
            <FilterSortBar
              filters={searchFilters}
              onChange={setSearchFilters}
              keywords={keywords}
            />

            {/* Search Results */}
            <div className="space-y-3">
              {filteredSearchResults.length === 0 && searchResults.length > 0 && (
                <div className="text-center py-12 rounded-[18px] border border-dashed border-hairline-strong">
                  <p className="text-body text-ink-2">当前筛选条件下无结果</p>
                  <p className="text-caption text-ink-3 mt-1">尝试调整筛选条件</p>
                </div>
              )}
              {filteredSearchResults.map((hotspot) => {
                const heatScore = calcHeatScore(hotspot);
                const meta = IMPORTANCE_META[hotspot.importance] ?? IMPORTANCE_META.medium;
                return (
                  <div
                    key={hotspot.id}
                    className="group card p-5 transition-colors hover:border-hairline-strong"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2.5">
                          <span className="flex items-center gap-1.5">
                            <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                            <span className={cn("text-caption font-medium", meta.text)}>{meta.label}</span>
                          </span>
                          <span className="flex items-center gap-1.5 text-caption text-ink-2">
                            {getSourceIcon(hotspot.source)}
                            {getSourceLabel(hotspot.source)}
                          </span>
                          {!hotspot.isReal && (
                            <span className="flex items-center gap-1 text-caption text-danger">
                              <ShieldAlert className="w-3 h-3" />
                              可疑
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-caption text-ink-3 metric-num">
                            <ThermometerSun className="w-3 h-3" />
                            {getHeatLabel(heatScore)} {heatScore}
                          </span>
                        </div>
                        <h4 className="text-card font-semibold text-ink mb-2 group-hover:text-accent transition-colors">
                          {hotspot.title}
                        </h4>
                        {hotspot.summary && (
                          <p className="text-body text-ink-2 mb-2">
                            <span className="text-caption text-ink-3 mr-1.5">AI 摘要</span>
                            {hotspot.summary}
                          </p>
                        )}
                        {hotspot.authorName && (
                          <div className="flex items-center gap-2 mb-2">
                            <User className="w-4 h-4 text-ink-3" />
                            <span className="text-caption text-ink-2">{hotspot.authorName}</span>
                            {hotspot.authorVerified && (
                              <span className="text-caption text-accent">✓ 认证</span>
                            )}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-caption text-ink-3 metric-num">
                          <span className="flex items-center gap-1">
                            <Target className="w-3.5 h-3.5" />
                            相关性 {hotspot.relevance}%
                          </span>
                          {hotspot.likeCount != null && hotspot.likeCount > 0 && (
                            <span className="flex items-center gap-1" title="点赞">
                              <Zap className="w-3.5 h-3.5" />
                              {hotspot.likeCount.toLocaleString()}
                            </span>
                          )}
                          {hotspot.viewCount != null && hotspot.viewCount > 0 && (
                            <span className="flex items-center gap-1" title="浏览量">
                              <Eye className="w-3.5 h-3.5" />
                              {hotspot.viewCount.toLocaleString()}
                            </span>
                          )}
                        </div>
                        {hotspot.publishedAt && (
                          <div className="flex items-center gap-1 text-caption text-ink-3 mt-1.5" title={formatDateTime(hotspot.publishedAt)}>
                            <Clock className="w-3 h-3" />
                            发布 {relativeTime(hotspot.publishedAt)}
                          </div>
                        )}
                      </div>
                      <a
                        href={hotspot.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 px-4 py-2 rounded-full bg-accent-soft text-accent text-caption font-medium hover:bg-accent hover:text-white transition-colors"
                      >
                        查看
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
