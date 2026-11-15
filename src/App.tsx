import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import type { TabType } from './components/Navbar';
import { applyTheme, getThemeSettings } from './lib/theme';
import { HomeView } from './components/HomeView';
import { CategoriesView } from './components/CategoriesView';
import { SearchView } from './components/SearchView';
import { DownloadsView } from './components/DownloadsView';
import { HistoryView } from './components/HistoryView';
import { FavoritesView } from './components/FavoritesView';
import { SettingsView } from './components/SettingsView';
import { VodDetailModal } from './components/VodDetailModal';
import { PlayerModal } from './components/PlayerModal';
import { SourceManagerModal } from './components/SourceManagerModal';
import type { Source, VodItem } from './types';
import { api } from './services/api';
import { UpdateBanner } from './components/UpdateBanner';
import { setAutoCheckEnabled, startUpdateWatcher } from './lib/updater';

export const App: React.FC = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string>('');
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [detailVod, setDetailVod] = useState<VodItem | null>(null);
  const [showSourceManager, setShowSourceManager] = useState<boolean>(false);

  // Player state
  const [playerState, setPlayerState] = useState<{
    isOpen: boolean;
    vod: VodItem | null;
    lineIdx: number;
    epIdx: number;
    initialTime: number;
  }>({
    isOpen: false,
    vod: null,
    lineIdx: 0,
    epIdx: 0,
    initialTime: 0,
  });

  // Load sources on startup
  // Load sources and configuration on startup
  const loadSources = async () => {
    try {
      const [list, appSettings] = await Promise.all([
        api.getSources(),
        api.getSettings().catch(() => null),
      ]);
      setSources(list);
      setAutoCheckEnabled(appSettings?.auto_update_enabled !== false);
      if (list.length > 0) {
        setActiveSourceId((prev) => {
          if (prev && list.some((s) => s.id === prev)) return prev;
          if (
            appSettings?.default_source_id &&
            list.some((s) => s.id === appSettings.default_source_id && s.enabled)
          ) {
            return appSettings.default_source_id;
          }
          const firstEnabled = list.find((s) => s.enabled);
          return firstEnabled ? firstEnabled.id : list[0].id;
        });
      }
    } catch (e) {
      console.error('Failed to load sources from configuration:', e);
    }
  };

  useEffect(() => {
    applyTheme(getThemeSettings());
    loadSources();
    startUpdateWatcher();
  }, []);

  // Keep sources & taxonomy in sync when switching tabs
  useEffect(() => {
    loadSources();
  }, [currentTab]);
  const activeSource = sources.find((s) => s.id === activeSourceId);

  // Quick Play handler: ensure full details (play_lines) are present, then launch player
  const handleQuickPlay = async (vod: VodItem) => {
    let targetVod = vod;
    if (vod.source_id && (!vod.play_lines || vod.play_lines.length === 0)) {
      try {
        targetVod = await api.fetchVodDetail(vod.source_id, vod.vod_id);
      } catch (e) {
        console.error('Failed to fetch vod detail for quick play:', e);
      }
    }

    if (targetVod.play_lines && targetVod.play_lines.length > 0) {
      setPlayerState({
        isOpen: true,
        vod: targetVod,
        lineIdx: 0,
        epIdx: 0,
        initialTime: 0,
      });
    } else {
      // If no play lines yet, open details modal instead
      setDetailVod(targetVod);
    }
  };

  const handleLaunchPlayer = (
    vod: VodItem,
    lineIdx: number,
    epIdx: number,
    initialTime: number = 0
  ) => {
    setPlayerState({
      isOpen: true,
      vod,
      lineIdx,
      epIdx,
      initialTime,
    });
  };

  const handleQuickSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentTab('search');
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans select-none">
      {/* Modern Collapsible Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onOpenSourceManager={() => setShowSourceManager(true)}
      />

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        <HeaderBar
          currentTab={currentTab}
          sources={sources}
          activeSourceId={activeSourceId}
          onSelectActiveSource={setActiveSourceId}
          onOpenSourceManager={() => setShowSourceManager(true)}
          onQuickSearch={handleQuickSearch}
        />

        {/* Main View Area with Smooth Scroll */}
        <main className="flex-1 overflow-y-auto scrollbar-thin px-2 sm:px-4 py-4">
        {currentTab === 'home' && (
          <HomeView
            activeSource={activeSource}
            onSelectVod={setDetailVod}
            onQuickPlay={handleQuickPlay}
          />
        )}
        {currentTab === 'categories' && (
          <CategoriesView
            activeSource={activeSource}
            onSelectVod={setDetailVod}
            onQuickPlay={handleQuickPlay}
          />
        )}

        {currentTab === 'search' && (
          <SearchView
            initialQuery={searchQuery}
            sources={sources}
            activeSourceId={activeSourceId}
            onSelectVod={setDetailVod}
            onQuickPlay={handleQuickPlay}
          />
        )}
        {currentTab === 'downloads' && (
          <DownloadsView
            onPlayLocal={(vod) => {
              handleLaunchPlayer(vod, 0, 0, 0);
            }}
          />
        )}

        {currentTab === 'history' && (
          <HistoryView
            onResumePlay={(vod, lineIdx, epIdx, initialTime) =>
              handleLaunchPlayer(vod, lineIdx, epIdx, initialTime)
            }
            onSelectVod={setDetailVod}
          />
        )}

        {currentTab === 'favorites' && (
          <FavoritesView
            onSelectVod={setDetailVod}
            onQuickPlay={handleQuickPlay}
          />
        )}
        {currentTab === 'settings' && (
          <SettingsView
            sources={sources}
            onSourcesUpdated={loadSources}
            onTaxonomyUpdated={loadSources}
            onOpenSourceManager={() => setShowSourceManager(true)}
          />
        )}
        </main>
      </div>
      {/* Video Detail Modal */}
      {detailVod && (
        <VodDetailModal
          vod={detailVod}
          onClose={() => setDetailVod(null)}
          onPlay={(vod, lineIdx, epIdx, initialTime) => {
            setDetailVod(null);
            handleLaunchPlayer(vod, lineIdx, epIdx, initialTime || 0);
          }}
        />
      )}

      {/* Player Modal */}
      {playerState.isOpen && playerState.vod && (
        <PlayerModal
          vod={playerState.vod}
          initialLineIndex={playerState.lineIdx}
          initialEpisodeIndex={playerState.epIdx}
          initialTime={playerState.initialTime}
          onClose={() =>
            setPlayerState({
              isOpen: false,
              vod: null,
              lineIdx: 0,
              epIdx: 0,
              initialTime: 0,
            })
          }
        />
      )}

      {/* Source Manager Modal */}
      {showSourceManager && (
        <SourceManagerModal
          sources={sources}
          activeSourceId={activeSourceId}
          onSelectActiveSource={setActiveSourceId}
          onRefreshSources={loadSources}
          onClose={() => setShowSourceManager(false)}
        />
      )}

      {/* Update availability / progress */}
      <UpdateBanner />
    </div>
  );
};

export default App;
