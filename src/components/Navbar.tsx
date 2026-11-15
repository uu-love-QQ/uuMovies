import React, { useState } from 'react';
import {
  Film,
  Search,
  Clock,
  Heart,
  Settings,
  ChevronDown,
  Layers,
  Radio,
  Compass,
  ArrowDownToLine,
  SlidersHorizontal,
  Minus,
  Square,
  X,
} from 'lucide-react';
import type { Source } from '../types';
import { cn } from '../lib/utils';
import { api, isRunningInTauri } from '../services/api';

export type TabType = 'home' | 'categories' | 'search' | 'downloads' | 'history' | 'favorites' | 'settings';

interface NavbarProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  sources: Source[];
  activeSourceId: string;
  onSelectActiveSource: (sourceId: string) => void;
  onOpenSourceManager: () => void;
  onQuickSearch: (query: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  sources,
  activeSourceId,
  onSelectActiveSource,
  onOpenSourceManager,
  onQuickSearch,
}) => {
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [searchVal, setSearchVal] = useState('');

  const activeSource = sources.find((s) => s.id === activeSourceId) || sources[0];

  const handleSearchSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchVal.trim()) {
      onQuickSearch(searchVal.trim());
      onTabChange('search');
    }
  };

  const navItems: { id: TabType; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'home', label: '首页', icon: Film },
    { id: 'categories', label: '分类', icon: Compass },
    { id: 'search', label: '搜索', icon: Search },
    { id: 'downloads', label: '下载', icon: ArrowDownToLine },
    { id: 'history', label: '历史', icon: Clock },
    { id: 'favorites', label: '收藏', icon: Heart },
    { id: 'settings', label: '设置', icon: SlidersHorizontal },
  ];

  return (
    <header data-tauri-drag-region className="sticky top-0 z-30 w-full bg-zinc-950/85 backdrop-blur-md border-b border-zinc-800/60 select-none">
      <div data-tauri-drag-region className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div
          onClick={() => onTabChange('home')}
          className="flex items-center gap-2.5 cursor-pointer flex-shrink-0 group"
        >
          <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-950 shadow-sm transition-transform group-hover:scale-105">
            <Film className="w-4 h-4 fill-current" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-base font-semibold tracking-tight text-zinc-100">uuMovies</span>
            <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.2 rounded">
              v0.1
            </span>
          </div>
        </div>

        {/* Navigation Tabs (shadcn style segmented control) */}
        <nav className="hidden md:flex items-center bg-zinc-900/60 border border-zinc-800/80 p-0.5 rounded-lg">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer',
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-zinc-100' : 'text-zinc-400')} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right Search & Source Selector */}
        <div className="flex items-center gap-2.5">
          {/* Quick Search */}
          <form onSubmit={handleSearchSubmit} className="hidden sm:flex items-center relative">
            <input
              type="text"
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder="搜索影视、演员..."
              className="w-44 lg:w-56 pl-7 pr-3 py-1 bg-zinc-900/70 border border-zinc-800/80 rounded-md text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-700 transition-all"
            />
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 pointer-events-none" />
          </form>

          {/* Source Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSourceDropdown(!showSourceDropdown)}
              className="flex items-center gap-2 px-2.5 py-1 bg-zinc-900/70 hover:bg-zinc-800/60 border border-zinc-800/80 rounded-md text-xs text-zinc-200 transition-colors cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="max-w-[80px] sm:max-w-[100px] truncate font-medium">
                {activeSource?.name || '选择源'}
              </span>
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            </button>

            {showSourceDropdown && (
              <div
                onClick={() => setShowSourceDropdown(false)}
                className="fixed inset-0 z-30"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-4 top-14 w-56 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl py-1.5 z-40 animate-fade-in"
                >
                  <div className="px-3 py-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800/60 pb-1.5 mb-1">
                    <span>采集源</span>
                    <span className="text-zinc-400">{sources.length} 个</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto scrollbar-thin py-0.5">
                    {sources
                      .filter((s) => s.enabled)
                      .map((src) => {
                        const isSelected = src.id === activeSourceId;
                        return (
                          <button
                            key={src.id}
                            onClick={() => {
                              onSelectActiveSource(src.id);
                              setShowSourceDropdown(false);
                            }}
                            className={cn(
                              'w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors cursor-pointer',
                              isSelected
                                ? 'bg-zinc-800 text-zinc-100 font-medium'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                            )}
                          >
                            <span className="truncate">{src.name}</span>
                            {isSelected && <Radio className="w-3 h-3 text-zinc-200 fill-current" />}
                          </button>
                        );
                      })}
                  </div>
                  <div className="p-1 pt-1.5 border-t border-zinc-800/60 mt-1">
                    <button
                      onClick={() => {
                        setShowSourceDropdown(false);
                        onOpenSourceManager();
                      }}
                      className="w-full py-1 px-2.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 rounded-md text-xs text-left flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>管理采集源...</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Manage Button */}
          <button
            onClick={onOpenSourceManager}
            className="p-1.5 bg-zinc-900/70 hover:bg-zinc-800/60 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors cursor-pointer"
            title="采集源管理"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {/* Frameless Window Controls */}
          {isRunningInTauri() && (
            <div className="flex items-center ml-1 border-l border-zinc-800/80 pl-2 gap-0.5">
              <button
                onClick={() => api.minimizeWindow()}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                title="最小化"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => api.toggleMaximizeWindow()}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                title="最大化 / 还原"
              >
                <Square className="w-3 h-3" />
              </button>
              <button
                onClick={() => api.closeWindow()}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-rose-600/90 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
