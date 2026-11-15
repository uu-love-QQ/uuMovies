import { invoke, isTauri, Channel } from '@tauri-apps/api/core';
import type {
  Source,
  VodResponse,
  VodItem,
  Category,
  TestResult,
  PlayHistoryItem,
  FavoriteItem,
  AppSettings,
  DownloadTask,
  DoubanMetadata,
  CrossStationPlayLine,
  SearchStreamEvent,
  UserTaxonomyConfig,
  SubscriptionItem,
  SubscriptionSyncResult,
  DlnaDevice,
  UpdateInfo,
  UpdateEvent,
} from '../types';

export const isRunningInTauri = (): boolean => {
  try {
    return isTauri();
  } catch {
    return false;
  }
};

export const api = {
  getSources(): Promise<Source[]> {
    return invoke<Source[]>('get_sources');
  },

  saveSources(sources: Source[]): Promise<void> {
    return invoke('save_sources', { sources });
  },

  resetDefaultSources(): Promise<Source[]> {
    return invoke<Source[]>('reset_default_sources');
  },

  fetchVodList(params: {
    sourceId: string;
    typeId?: string;
    page?: number;
    keyword?: string;
    hours?: number;
  }): Promise<VodResponse> {
    return invoke<VodResponse>('fetch_vod_list', {
      sourceId: params.sourceId,
      typeId: params.typeId,
      page: params.page,
      keyword: params.keyword,
      hours: params.hours,
    });
  },

  fetchVodDetail(sourceId: string, vodId: string): Promise<VodItem> {
    return invoke<VodItem>('fetch_vod_detail', { sourceId, vodId });
  },

  aggregateSearch(keyword: string, sourceIds?: string[]): Promise<VodItem[]> {
    return invoke<VodItem[]>('aggregate_search', {
      keyword,
      sourceIds: sourceIds && sourceIds.length > 0 ? sourceIds : null,
    });
  },

  searchStream(
    keyword: string,
    sourceIds: string[] | undefined,
    onMessage: (event: SearchStreamEvent) => void
  ): Promise<void> {
    const channel = new Channel<SearchStreamEvent>();
    channel.onmessage = onMessage;
    return invoke('search_stream', {
      keyword,
      sourceIds: sourceIds && sourceIds.length > 0 ? sourceIds : null,
      onEvent: channel,
    });
  },

  testSingleSource(source: Source): Promise<TestResult> {
    return invoke<TestResult>('test_single_source', { source });
  },

  testAllSources(): Promise<TestResult[]> {
    return invoke<TestResult[]>('test_all_sources');
  },

  getHistory(): Promise<PlayHistoryItem[]> {
    return invoke<PlayHistoryItem[]>('get_history');
  },

  saveHistoryItem(item: PlayHistoryItem): Promise<void> {
    return invoke('save_history_item', { item });
  },

  removeHistoryItem(vodId: string, sourceId: string): Promise<void> {
    return invoke('remove_history_item', { vodId, sourceId });
  },

  clearHistory(): Promise<void> {
    return invoke('clear_history');
  },

  getFavorites(): Promise<FavoriteItem[]> {
    return invoke<FavoriteItem[]>('get_favorites');
  },

  toggleFavorite(item: FavoriteItem): Promise<boolean> {
    return invoke<boolean>('toggle_favorite', { item });
  },

  getSettings(): Promise<AppSettings> {
    return invoke<AppSettings>('get_settings');
  },

  saveSettings(settings: AppSettings): Promise<void> {
    return invoke('save_settings', { settings });
  },

  resetDefaultSettings(): Promise<AppSettings> {
    return invoke<AppSettings>('reset_default_settings');
  },

  addDownloadTask(params: {
    vodId: string;
    vodName: string;
    vodPic?: string;
    lineTitle: string;
    episodeName: string;
    url: string;
  }): Promise<DownloadTask> {
    return invoke<DownloadTask>('add_download_task', {
      vodId: params.vodId,
      vodName: params.vodName,
      vodPic: params.vodPic,
      lineTitle: params.lineTitle,
      episodeName: params.episodeName,
      url: params.url,
    });
  },

  startDownloadTask(taskId: string): Promise<void> {
    return invoke('start_download_task', { taskId });
  },

  pauseDownloadTask(taskId: string): Promise<void> {
    return invoke('pause_download_task', { taskId });
  },

  deleteDownloadTask(taskId: string, deleteFile: boolean = false): Promise<void> {
    return invoke('delete_download_task', { taskId, deleteFile });
  },

  getDownloadTasks(): Promise<DownloadTask[]> {
    return invoke<DownloadTask[]>('get_download_tasks');
  },

  getDefaultDownloadDir(): Promise<string> {
    return invoke<string>('get_default_download_dir');
  },

  openDownloadDir(filePath: string): Promise<void> {
    return invoke('open_download_dir', { filePath });
  },

  pickDownloadDir(): Promise<string | null> {
    return invoke<string | null>('pick_download_dir');
  },

  getDoubanMetadata(title: string): Promise<DoubanMetadata> {
    return invoke<DoubanMetadata>('get_douban_metadata', { title });
  },

  aggregateCrossStationLines(
    vodName: string,
    currentSourceId?: string
  ): Promise<CrossStationPlayLine[]> {
    return invoke<CrossStationPlayLine[]>('aggregate_cross_station_lines', {
      vodName,
      currentSourceId,
    });
  },

  expandSearchKeywords(keyword: string): Promise<string[]> {
    return invoke<string[]>('expand_search_keywords', { keyword });
  },

  syncAliasSubscription(url?: string): Promise<number> {
    return invoke<number>('sync_alias_subscription', { url });
  },

  getCustomAliases(): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('get_custom_aliases');
  },

  saveCustomAliases(aliases: Record<string, string>): Promise<void> {
    return invoke('save_custom_aliases', { aliases });
  },

  getTaxonomy(): Promise<UserTaxonomyConfig> {
    return invoke<UserTaxonomyConfig>('get_taxonomy');
  },

  saveTaxonomy(config: UserTaxonomyConfig): Promise<void> {
    return invoke('save_taxonomy', { config });
  },

  resetDefaultTaxonomy(): Promise<UserTaxonomyConfig> {
    return invoke<UserTaxonomyConfig>('reset_default_taxonomy');
  },

  getSubscriptions(): Promise<SubscriptionItem[]> {
    return invoke<SubscriptionItem[]>('get_subscriptions');
  },

  saveSubscriptions(subscriptions: SubscriptionItem[]): Promise<void> {
    return invoke('save_subscriptions', { subscriptions });
  },

  syncSubscription(subscriptionId: string): Promise<SubscriptionSyncResult> {
    return invoke<SubscriptionSyncResult>('sync_subscription', { subscriptionId });
  },

  syncAllSubscriptions(): Promise<SubscriptionSyncResult[]> {
    return invoke<SubscriptionSyncResult[]>('sync_all_subscriptions');
  },

  deleteSubscription(subscriptionId: string): Promise<void> {
    return invoke('delete_subscription', { subscriptionId });
  },

  dragWindow(): Promise<void> {
    return invoke('drag_window');
  },

  minimizeWindow(): Promise<void> {
    return invoke('minimize_window');
  },

  toggleMaximizeWindow(): Promise<void> {
    return invoke('toggle_maximize_window');
  },

  closeWindow(): Promise<void> {
    return invoke('close_window');
  },

  isWindowMaximized(): Promise<boolean> {
    return invoke<boolean>('is_window_maximized');
  },

  getSourceClasses(sourceId: string): Promise<Category[]> {
    return invoke<Category[]>('get_source_classes', { sourceId });
  },

  discoverDlnaDevices(): Promise<DlnaDevice[]> {
    return invoke<DlnaDevice[]>('discover_dlna_devices');
  },

  castToDlnaDevice(device: DlnaDevice, videoTitle: string, streamUrl: string): Promise<string> {
    return invoke<string>('cast_to_dlna_device', { device, videoTitle, streamUrl });
  },

  stopDlnaCast(controlUrl: string): Promise<void> {
    return invoke('stop_dlna_cast', { controlUrl });
  },

  checkAppUpdate(): Promise<UpdateInfo> {
    return invoke<UpdateInfo>('check_app_update');
  },

  getAppVersion(): Promise<string> {
    return invoke<string>('get_app_version');
  },

  openExternalUrl(url: string): Promise<void> {
    return invoke('open_external_url', { url });
  },

  installAppUpdate(
    downloadUrl: string,
    sha256: string | null,
    version: string,
    onEvent: (event: UpdateEvent) => void
  ): Promise<void> {
    const channel = new Channel<UpdateEvent>();
    channel.onmessage = onEvent;
    return invoke('install_app_update', {
      downloadUrl,
      sha256,
      version,
      onEvent: channel,
    });
  },
};
