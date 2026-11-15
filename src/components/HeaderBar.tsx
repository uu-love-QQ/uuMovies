import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  ChevronDown,
  Sun,
  Moon,
  Laptop,
  Palette,
  Minus,
  Square,
  Copy,
  X,
  Radio,
  Layers,
} from 'lucide-react';
import type { Source } from '../types';
import type { TabType } from './Navbar';
import { api, isRunningInTauri } from '../services/api';
import { cn } from '../lib/utils';
import {
  getThemeSettings,
  applyTheme,
  ACCENT_COLORS,
  type ThemeSettings,
  type ThemeMode,
  type AccentColor,
} from '../lib/theme';

interface HeaderBarProps {
  currentTab: TabType;
  sources: Source[];
  activeSourceId: string;
  onSelectActiveSource: (sourceId: string) => void;
  onOpenSourceManager: () => void;
  onQuickSearch: (query: string) => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  currentTab,
  sources,
  activeSourceId,
  onSelectActiveSource,
  onOpenSourceManager,
  onQuickSearch,
}) => {
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const [theme, setTheme] = useState<ThemeSettings>(getThemeSettings());
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    api.isWindowMaximized().then(setIsMaximized);
    const interval = setInterval(() => {
      api.isWindowMaximized().then(setIsMaximized);
    }, 600);
    return () => clearInterval(interval);
  }, []);

  const handleToggleMaximize = async () => {
    await api.toggleMaximizeWindow();
    const max = await api.isWindowMaximized();
    setIsMaximized(max);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(target)) {
        setShowSourceDropdown(false);
      }
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(target)) {
        setShowThemeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const activeSource = sources.find((s) => s.id === activeSourceId) || sources[0];

  const tabTitles: Record<TabType, string> = {
    home: '精选影院',
    categories: '影视分类',
    search: '聚合搜索',
    downloads: '离线下载',
    history: '播放历史',
    favorites: '我的收藏',
    settings: '设置与偏好',
  };

  const handleSearchSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchVal.trim()) {
      onQuickSearch(searchVal.trim());
    }
  };

  const handleCycleThemeMode = (mode: ThemeMode) => {
    const updated: ThemeSettings = { ...theme, mode };
    setTheme(updated);
    applyTheme(updated);
    setShowThemeDropdown(false);
  };

  const handleSelectAccent = (accent: AccentColor) => {
    const updated: ThemeSettings = { ...theme, accent };
    setTheme(updated);
    applyTheme(updated);
    setShowThemeDropdown(false);
  };
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (
      e.button === 0 &&
      !(e.target as HTMLElement).closest(
        'button, input, select, textarea, [data-no-drag]'
      )
    ) {
      api.dragWindow();
    }
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      className="h-14 w-full flex items-center justify-between px-4 sm:px-6 border-b border-border bg-[var(--header-bg)] backdrop-blur-md select-none z-10 sticky top-0"
    >
      {/* Left: Current Page Title & Active Source Selector */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
          <span>{tabTitles[currentTab] || '影视中心'}</span>
        </h1>

        {/* Source Switcher Pill */}
        <div ref={sourceDropdownRef} className="relative" data-no-drag>
          <button
            onClick={() => setShowSourceDropdown((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/80 hover:bg-secondary border border-border text-xs text-foreground font-medium transition-colors cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="max-w-[100px] truncate">{activeSource?.name || '选择源'}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>

          {showSourceDropdown && (
            <div className="absolute top-full left-0 mt-2 w-56 bg-card border border-border rounded-xl shadow-2xl p-1 z-50 animate-fade-in">
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                切换采集源站点 ({sources.length})
              </div>
              <div className="max-h-56 overflow-y-auto scrollbar-thin space-y-0.5">
                {sources.map((src) => {
                  const isSelected = src.id === activeSource?.id;
                  return (
                    <button
                      key={src.id}
                      onClick={() => {
                        onSelectActiveSource(src.id);
                        setShowSourceDropdown(false);
                      }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between transition-colors cursor-pointer',
                        isSelected
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <span className="truncate">{src.name}</span>
                      {isSelected && <Radio className="w-3 h-3 fill-current" />}
                    </button>
                  );
                })}
              </div>
              <div className="p-1 pt-1.5 border-t border-border mt-1">
                <button
                  onClick={() => {
                    setShowSourceDropdown(false);
                    onOpenSourceManager();
                  }}
                  className="w-full py-1.5 px-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md text-xs text-left flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>管理全部采集源...</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Quick Search, Theme Palette, Window Controls */}
      <div className="flex items-center gap-2.5">
        {/* Compact Quick Search */}
        <form onSubmit={handleSearchSubmit} className="relative hidden md:block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索全网影视 / 演员..."
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            className="w-48 lg:w-64 h-8 pl-8 pr-3 bg-secondary/60 hover:bg-secondary focus:bg-card border border-border rounded-full text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all"
          />
        </form>

        {/* Theme Palette & Mode Dropdown */}
        <div ref={themeDropdownRef} className="relative" data-no-drag>
          <button
            onClick={() => setShowThemeDropdown(!showThemeDropdown)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60 transition-colors cursor-pointer"
            title="主题色与明暗切换"
          >
            {theme.mode === 'light' ? (
              <Sun className="w-3.5 h-3.5 text-amber-500" />
            ) : theme.mode === 'dark' ? (
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
            ) : (
              <Laptop className="w-3.5 h-3.5" />
            )}
          </button>

          {showThemeDropdown && (
            <div className="absolute top-full right-0 mt-2 w-56 bg-card border border-border rounded-xl shadow-2xl p-2.5 space-y-3 z-50 animate-fade-in">
              {/* Mode Select */}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  外观模式
                </div>
                <div className="grid grid-cols-3 gap-1 bg-muted/60 p-1 rounded-lg">
                  <button
                    onClick={() => handleCycleThemeMode('light')}
                    className={cn(
                      'flex flex-col items-center gap-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer',
                      theme.mode === 'light'
                        ? 'bg-card text-foreground shadow-sm font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-500" /> 浅色
                  </button>
                  <button
                    onClick={() => handleCycleThemeMode('dark')}
                    className={cn(
                      'flex flex-col items-center gap-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer',
                      theme.mode === 'dark'
                        ? 'bg-card text-foreground shadow-sm font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Moon className="w-3.5 h-3.5 text-indigo-400" /> 深色
                  </button>
                  <button
                    onClick={() => handleCycleThemeMode('system')}
                    className={cn(
                      'flex flex-col items-center gap-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer',
                      theme.mode === 'system'
                        ? 'bg-card text-foreground shadow-sm font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Laptop className="w-3.5 h-3.5" /> 跟随系统
                  </button>
                </div>
              </div>

              {/* Accent Color Palette */}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>强调色系</span>
                  <Palette className="w-3 h-3 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {ACCENT_COLORS.map((col) => {
                    const isSelected = theme.accent === col.id;
                    return (
                      <button
                        key={col.id}
                        onClick={() => handleSelectAccent(col.id)}
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer border',
                          col.bgClass,
                          isSelected
                            ? 'ring-2 ring-primary ring-offset-2 ring-offset-card border-white'
                            : 'border-transparent opacity-80 hover:opacity-100 hover:scale-105'
                        )}
                        title={col.name}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Frameless Window Controls */}
        {isRunningInTauri() && (
          <div className="flex items-center ml-1 border-l border-border pl-2 gap-0.5">
            <button
              onClick={() => api.minimizeWindow()}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="最小化"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title={isMaximized ? '向下还原' : '最大化'}
            >
              {isMaximized ? (
                <Copy className="w-3 h-3 rotate-90" />
              ) : (
                <Square className="w-3 h-3" />
              )}
            </button>
            <button
              onClick={() => api.closeWindow()}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-destructive text-muted-foreground hover:text-destructive-foreground transition-colors cursor-pointer"
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
