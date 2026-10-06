import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'hotpulse-theme';

export type Theme = 'light' | 'dark';

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * 明暗主题。index.html 里的内联脚本已在首屏前设好 data-theme，
 * 这里只负责后续的读写与持久化。
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 隐私模式下 localStorage 会抛，忽略即可 —— 主题只是个人偏好
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}

interface Props {
  theme: Theme;
  onToggle: () => void;
}

export default function ThemeToggle({ theme, onToggle }: Props) {
  const isDark = theme === 'dark';
  const label = isDark ? '切换到浅色主题' : '切换到深色主题';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline
        bg-surface text-ink-2 transition-colors hover:text-ink hover:border-hairline-strong
        active:scale-95"
    >
      {isDark ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
