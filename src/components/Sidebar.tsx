import React, { useState, useEffect } from 'react';
import {
  Film,
  Compass,
  Search,
  ArrowDownToLine,
  Clock,
  Heart,
  Settings,
  Layers,
  ChevronsLeft,
  ChevronsRight,
  Sparkles,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../services/api';
import type { TabType } from './Navbar';

interface SidebarProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  onOpenSourceManager: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  onOpenSourceManager,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('movies_sidebar_collapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('movies_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  const navPrimary = [
    { id: 'home' as TabType, label: '精选影院', icon: Film, shortcut: 'H' },
    { id: 'categories' as TabType, label: '影视分类', icon: Compass, shortcut: 'C' },
    { id: 'search' as TabType, label: '聚合搜索', icon: Search, shortcut: 'S' },
  ];

  const navLibrary = [
    { id: 'downloads' as TabType, label: '离线下载', icon: ArrowDownToLine },
    { id: 'history' as TabType, label: '播放历史', icon: Clock },
    { id: 'favorites' as TabType, label: '我的收藏', icon: Heart },
  ];

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
    <aside
      className={cn(
        'relative flex flex-col h-screen flex-shrink-0 transition-all duration-300 ease-in-out select-none z-20',
        'bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)]',
        isCollapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Top Brand Header */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className={cn(
          'h-14 flex items-center px-3 border-b border-[var(--sidebar-border)]',
          isCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        <div
          onClick={() => onTabChange('home')}
          className="flex items-center gap-2.5 cursor-pointer min-w-0"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary flex-shrink-0 shadow-sm">
            <Sparkles className="w-4 h-4 fill-current opacity-90" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm tracking-tight text-foreground truncate">
                uuMovies
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                v{__APP_VERSION__} · 影视助手
              </span>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--sidebar-hover)] transition-colors cursor-pointer"
            title="收起侧边栏"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto scrollbar-none py-3 px-2 space-y-4">
        {/* Group 1: 发现与探索 */}
        <div className="space-y-1">
          {!isCollapsed && (
            <div className="px-2.5 pb-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
              浏览大厅
            </div>
          )}
          {navPrimary.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer',
                  isCollapsed ? 'justify-center px-0' : '',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'text-foreground/80 hover:text-foreground hover:bg-[var(--sidebar-hover)]'
                )}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </div>

        {/* Group 2: 个人媒体库 */}
        <div className="space-y-1 pt-1 border-t border-[var(--sidebar-border)]/60">
          {!isCollapsed && (
            <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
              媒体库
            </div>
          )}
          {navLibrary.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer',
                  isCollapsed ? 'justify-center px-0' : '',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'text-foreground/80 hover:text-foreground hover:bg-[var(--sidebar-hover)]'
                )}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Fixed Area: 采集源 & 设置 */}
      <div className="p-2 border-t border-[var(--sidebar-border)] space-y-1">
        <button
          onClick={onOpenSourceManager}
          className={cn(
            'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-[var(--sidebar-hover)] transition-all cursor-pointer',
            isCollapsed ? 'justify-center px-0' : ''
          )}
          title="采集源管理"
        >
          <Layers className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {!isCollapsed && <span className="truncate">采集源管理</span>}
        </button>

        <button
          onClick={() => onTabChange('settings')}
          className={cn(
            'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer',
            isCollapsed ? 'justify-center px-0' : '',
            currentTab === 'settings'
              ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
              : 'text-foreground/80 hover:text-foreground hover:bg-[var(--sidebar-hover)]'
          )}
          title="系统与偏好设置"
        >
          <Settings className={cn('w-4 h-4 flex-shrink-0', currentTab === 'settings' ? 'text-primary-foreground' : 'text-muted-foreground')} />
          {!isCollapsed && <span className="truncate">设置与偏好</span>}
        </button>

        {isCollapsed && (
          <button
            onClick={() => setIsCollapsed(false)}
            className="w-full flex items-center justify-center py-2 text-muted-foreground hover:text-foreground hover:bg-[var(--sidebar-hover)] rounded-lg transition-colors cursor-pointer"
            title="展开侧边栏"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
};
