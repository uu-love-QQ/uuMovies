export interface Source {
  id: string;
  name: string;
  api_url: string;
  api_type: 'json' | 'xml' | 'auto';
  enabled: boolean;
  group?: string;
  adult_type_ids?: string[];
  category_mapping?: Record<string, string[]>;
  subscription_id?: string;
}

export interface LocalCategory {
  id: string;
  name: string;
  bind_tags: string[];
}

export interface UserTaxonomyConfig {
  adult_mode: boolean;
  categories: LocalCategory[];
  blocked_tags: string[];
  blocked_type_ids: string[];
}

export interface SubscriptionItem {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  auto_update: boolean;
  update_interval_hours: number;
  last_updated: number;
  etag?: string;
  source_count: number;
  error_msg?: string;
}

export interface SubscriptionSyncResult {
  subscription_id: string;
  success: boolean;
  updated: boolean;
  source_count: number;
  message: string;
}

export interface Category {
  type_id: string;
  type_name: string;
  type_pid?: string;
}

export interface Episode {
  name: string;
  url: string;
}

export interface PlayLine {
  from: string;
  title: string;
  episodes: Episode[];
}

export interface VodItem {
  vod_id: string;
  vod_name: string;
  type_id: string;
  type_name: string;
  vod_en?: string;
  vod_time?: string;
  vod_remarks?: string;
  vod_play_from?: string;
  vod_play_url?: string;
  vod_pic?: string;
  vod_actor?: string;
  vod_director?: string;
  vod_content?: string;
  vod_year?: string;
  vod_area?: string;
  vod_lang?: string;
  vod_score?: string;
  play_lines: PlayLine[];
  source_id?: string;
  source_name?: string;
  source_stations?: string[];
}

export interface VodResponse {
  page: number;
  pagecount: number;
  limit: number;
  total: number;
  classes: Category[];
  list: VodItem[];
}

export interface TestResult {
  source_id: string;
  name: string;
  ok: boolean;
  latency_ms: number;
  categories_count: number;
  sample_item_name?: string;
  error?: string;
}

export interface PlayHistoryItem {
  vod_id: string;
  source_id: string;
  source_name: string;
  vod_name: string;
  vod_pic?: string;
  line_index: number;
  episode_index: number;
  episode_name: string;
  play_url: string;
  progress_seconds: number;
  duration_seconds: number;
  updated_at: number;
}

export interface FavoriteItem {
  vod_id: string;
  source_id: string;
  source_name: string;
  vod_name: string;
  vod_pic?: string;
  vod_remarks?: string;
  type_name?: string;
  vod_year?: string;
  created_at: number;
}

export interface DownloadTask {
  id: string;
  vod_id: string;
  vod_name: string;
  vod_pic?: string;
  line_title: string;
  episode_name: string;
  url: string;
  file_path: string;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error';
  progress: number;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bytes_per_sec: number;
  error_msg?: string;
  created_at: number;
}

export interface AppSettings {
  default_source_id?: string;
  auto_play_next: boolean;
  playback_rate: number;
  hardware_acceleration: boolean;
  download_dir?: string;
  concurrent_downloads: number;
  ad_block_enabled: boolean;
  ad_block_keywords: string[];
  skip_intro_seconds: number;
  skip_outro_seconds: number;
  alias_subscription_url?: string;
  custom_aliases?: Record<string, string>;
  adult_mode_enabled: boolean;
  blocked_categories: string[];
  long_press_action?: 'speed_up' | 'continuous_seek';
  auto_update_enabled?: boolean;
}

export interface DoubanMetadata {
  id: string;
  canonical_title: string;
  original_title?: string;
  rate?: string;
  poster?: string;
  year?: string;
  episodes_count?: string;
  directors: string[];
  actors: string[];
  is_tv: boolean;
}

export interface CrossStationPlayLine {
  source_id: string;
  source_name: string;
  line_title: string;
  full_title: string;
  episodes: Episode[];
}


export interface DlnaDevice {
  name: string;
  location: string;
  control_url: string;
}
export type SearchStreamEvent =
  | { type: 'items'; data: VodItem[] }
  | { type: 'aliases'; data: string[] }
  | { type: 'progress'; data: { completed: number; total: number; source_name: string } }
  | { type: 'done'; data?: undefined };

export interface UpdateInfo {
  available: boolean;
  current_version: string;
  latest_version: string;
  tag: string;
  name: string;
  notes: string;
  published_at: string;
  html_url: string;
  download_url: string | null;
  download_name: string | null;
  download_size: number;
  sha256: string | null;
  install_supported: boolean;
}

export type UpdateEvent =
  | { type: 'progress'; data: { downloaded: number; total: number } }
  | { type: 'verifying'; data?: undefined }
  | { type: 'installing'; data?: undefined }
  | { type: 'done'; data?: undefined };
