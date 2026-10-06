import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, X, ChevronDown, Check, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Keyword } from '../services/api';

export interface FilterState {
  source: string;
  importance: string;
  keywordId: string;
  timeRange: string;
  isReal: string;
  sortBy: string;
  sortOrder: string;
}

export const defaultFilterState: FilterState = {
  source: '',
  importance: '',
  keywordId: '',
  timeRange: '',
  isReal: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

interface FilterSortBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  keywords: Keyword[];
}

const SORT_OPTIONS = [
  { value: 'createdAt', label: '最新发现' },
  { value: 'publishedAt', label: '最新发布' },
  { value: 'importance', label: '重要程度' },
  { value: 'relevance', label: '相关性' },
  { value: 'hot', label: '热度综合' },
];

const SOURCE_OPTIONS = [
  { value: '', label: '全部来源' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'bing', label: 'Bing' },
  { value: 'sogou', label: '搜狗' },
  { value: 'bilibili', label: 'Bilibili' },
  { value: 'weibo', label: '微博热搜' },
  { value: 'juejin', label: '掘金' },
  { value: 'csdn', label: 'CSDN' },
  { value: 'oschina', label: '开源中国' },
  { value: 'weixin', label: '微信公众号' },
  { value: 'hackernews', label: 'HackerNews' },
  { value: 'github', label: 'GitHub' },
  { value: 'producthunt', label: 'Product Hunt' },
];

// 小圆点与列表里的重要度标记保持一致；只有最高两级上色
const IMPORTANCE_OPTIONS = [
  { value: '', label: '全部等级' },
  { value: 'urgent', label: '紧急', dot: 'bg-danger' },
  { value: 'high', label: '重要', dot: 'bg-warn' },
  { value: 'medium', label: '一般', dot: 'bg-dot-medium' },
  { value: 'low', label: '低', dot: 'bg-dot-low' },
];

const TIME_RANGE_OPTIONS = [
  { value: '', label: '全部时间' },
  { value: '1h', label: '最近 1 小时' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
];

const REAL_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'true', label: '真实' },
  { value: 'false', label: '疑似虚假' },
];

// Dropdown component
function Dropdown({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: { value: string; label: string; dot?: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const isActive = value !== '';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-caption font-medium transition-colors whitespace-nowrap border",
          isActive
            ? "bg-accent-soft text-accent border-accent/25"
            : "bg-surface text-ink-2 border-hairline hover:border-hairline-strong hover:text-ink"
        )}
      >
        <span>{isActive ? selected?.label : label}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
              className="absolute left-0 top-full mt-1.5 z-50 min-w-[160px] bg-surface backdrop-blur-xl rounded-xl border border-hairline shadow-[var(--shadow-pop)] overflow-hidden p-1"
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => { onChange(option.value); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-caption transition-colors text-left",
                    value === option.value
                      ? "bg-accent-soft text-accent"
                      : "text-ink-2 hover:bg-hover hover:text-ink"
                  )}
                >
                  {option.dot && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", option.dot)} />}
                  <span>{option.label}</span>
                  {value === option.value && <Check className="w-3 h-3 shrink-0 ml-auto" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FilterSortBar({ filters, onChange, keywords }: FilterSortBarProps) {
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = [
    filters.source,
    filters.importance,
    filters.keywordId,
    filters.timeRange,
    filters.isReal,
  ].filter(v => v !== '').length;

  const hasNonDefaultSort = filters.sortBy !== 'createdAt';

  const update = (key: keyof FilterState, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  const resetFilters = () => {
    onChange({ ...defaultFilterState });
  };

  const keywordOptions = [
    { value: '', label: '全部关键词' },
    ...keywords.filter(k => k.isActive).map(k => ({ value: k.id, label: k.text })),
  ];

  return (
    <div className="space-y-3">
      {/* Main Bar: Sort + Filter Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sort Selector — 分段控件 */}
        <div className="segmented max-w-full overflow-x-auto">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('sortBy', opt.value)}
              data-active={filters.sortBy === opt.value}
              className="segmented-item"
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2 rounded-full text-caption font-medium transition-colors border",
            showFilters || activeFilterCount > 0
              ? "bg-accent-soft text-accent border-accent/25"
              : "bg-surface text-ink-2 border-hairline hover:border-hairline-strong hover:text-ink"
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          筛选
          {activeFilterCount > 0 && (
            <span className="min-w-[16px] h-4 px-1 rounded-full bg-accent text-[10px] text-white flex items-center justify-center font-semibold metric-num">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Reset */}
        {(activeFilterCount > 0 || hasNonDefaultSort) && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 px-2.5 py-2 rounded-full text-caption text-ink-2 hover:text-ink transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            重置
          </button>
        )}

        {/* Active Filter Tags */}
        {activeFilterCount > 0 && !showFilters && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {filters.source && (
              <FilterTag
                label={SOURCE_OPTIONS.find(o => o.value === filters.source)?.label || filters.source}
                onRemove={() => update('source', '')}
              />
            )}
            {filters.importance && (
              <FilterTag
                label={IMPORTANCE_OPTIONS.find(o => o.value === filters.importance)?.label || filters.importance}
                onRemove={() => update('importance', '')}
              />
            )}
            {filters.keywordId && (
              <FilterTag
                label={keywords.find(k => k.id === filters.keywordId)?.text || '关键词'}
                onRemove={() => update('keywordId', '')}
              />
            )}
            {filters.timeRange && (
              <FilterTag
                label={TIME_RANGE_OPTIONS.find(o => o.value === filters.timeRange)?.label || filters.timeRange}
                onRemove={() => update('timeRange', '')}
              />
            )}
            {filters.isReal && (
              <FilterTag
                label={REAL_OPTIONS.find(o => o.value === filters.isReal)?.label || '真实性'}
                onRemove={() => update('isReal', '')}
              />
            )}
          </div>
        )}
      </div>

      {/* Expanded Filter Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center gap-2 flex-wrap p-3 rounded-[14px] bg-subtle border border-hairline">
              <Dropdown label="来源" value={filters.source} options={SOURCE_OPTIONS} onChange={(v) => update('source', v)} />
              <Dropdown label="重要程度" value={filters.importance} options={IMPORTANCE_OPTIONS} onChange={(v) => update('importance', v)} />
              <Dropdown label="关键词" value={filters.keywordId} options={keywordOptions} onChange={(v) => update('keywordId', v)} />
              <Dropdown label="时间" value={filters.timeRange} options={TIME_RANGE_OPTIONS} onChange={(v) => update('timeRange', v)} />
              <Dropdown label="真实性" value={filters.isReal} options={REAL_OPTIONS} onChange={(v) => update('isReal', v)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-accent-soft text-accent text-caption font-medium">
      {label}
      <button onClick={onRemove} aria-label={`移除筛选：${label}`} className="hover:opacity-60 transition-opacity">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
