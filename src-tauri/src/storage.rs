use crate::maccms::{get_default_sources, Source};
use crate::subscription::{SubscriptionEngine, SubscriptionItem};
use crate::taxonomy::UserTaxonomyConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayHistoryItem {
    pub vod_id: String,
    pub source_id: String,
    pub source_name: String,
    pub vod_name: String,
    pub vod_pic: Option<String>,
    pub line_index: usize,
    pub episode_index: usize,
    pub episode_name: String,
    pub play_url: String,
    pub progress_seconds: f64,
    pub duration_seconds: f64,
    pub updated_at: u64, // Unix timestamp in seconds
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteItem {
    pub vod_id: String,
    pub source_id: String,
    pub source_name: String,
    pub vod_name: String,
    pub vod_pic: Option<String>,
    pub vod_remarks: Option<String>,
    pub type_name: Option<String>,
    pub vod_year: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub default_source_id: Option<String>,
    #[serde(default = "default_true")]
    pub auto_play_next: bool,
    #[serde(default = "default_rate")]
    pub playback_rate: f64,
    #[serde(default = "default_true")]
    pub hardware_acceleration: bool,
    pub download_dir: Option<String>,
    #[serde(default = "default_concurrent")]
    pub concurrent_downloads: u32,
    #[serde(default = "default_true")]
    pub ad_block_enabled: bool,
    #[serde(default = "default_keywords")]
    pub ad_block_keywords: Vec<String>,
    #[serde(default)]
    pub skip_intro_seconds: u32,
    #[serde(default)]
    pub skip_outro_seconds: u32,
    pub alias_subscription_url: Option<String>,
    #[serde(default)]
    pub custom_aliases: HashMap<String, String>,
    #[serde(default)]
    pub adult_mode_enabled: bool,
    #[serde(default = "default_blocked_categories")]
    pub blocked_categories: Vec<String>,
    #[serde(default = "default_long_press_action")]
    pub long_press_action: String,
    #[serde(default = "default_true")]
    pub auto_update_enabled: bool,
}

fn default_true() -> bool {
    true
}

fn default_rate() -> f64 {
    1.0
}

fn default_concurrent() -> u32 {
    3
}

fn default_keywords() -> Vec<String> {
    vec![
        "澳门".to_string(),
        "威尼斯人".to_string(),
        "荷官".to_string(),
        "发牌".to_string(),
        "菠菜".to_string(),
        "赌博".to_string(),
        "微信".to_string(),
        "公众号".to_string(),
        "防走失".to_string(),
        "TG@".to_string(),
        "APP下载".to_string(),
    ]
}

fn default_blocked_categories() -> Vec<String> {
    vec!["预告片".to_string(), "体育赛事".to_string(), "其他赛事".to_string()]
}

fn default_long_press_action() -> String {
    "speed_up".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_source_id: Some("bfzy".to_string()),
            auto_play_next: true,
            playback_rate: 1.0,
            hardware_acceleration: true,
            download_dir: None,
            concurrent_downloads: 3,
            ad_block_enabled: true,
            ad_block_keywords: default_keywords(),
            skip_intro_seconds: 0,
            skip_outro_seconds: 0,
            alias_subscription_url: None,
            custom_aliases: HashMap::new(),
            adult_mode_enabled: false,
            blocked_categories: default_blocked_categories(),
            long_press_action: default_long_press_action(),
            auto_update_enabled: true,
        }
    }
}

pub struct StorageManager {
    data_dir: PathBuf,
}

impl StorageManager {
    pub fn new() -> Self {
        let base_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("uumovies_player");

        let _ = fs::create_dir_all(&base_dir);
        Self { data_dir: base_dir }
    }

    fn file_path(&self, filename: &str) -> PathBuf {
        self.data_dir.join(filename)
    }

    pub fn load_sources(&self) -> Vec<Source> {
        let path = self.file_path("sources.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(sources) = serde_json::from_str::<Vec<Source>>(&content) {
                if !sources.is_empty() {
                    return sources;
                }
            }
        }
        let defaults = get_default_sources();
        let _ = self.save_sources(&defaults);
        defaults
    }

    pub fn save_sources(&self, sources: &[Source]) -> Result<(), String> {
        let path = self.file_path("sources.json");
        let json = serde_json::to_string_pretty(sources).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn load_history(&self) -> Vec<PlayHistoryItem> {
        let path = self.file_path("history.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(history) = serde_json::from_str::<Vec<PlayHistoryItem>>(&content) {
                return history;
            }
        }
        Vec::new()
    }

    pub fn save_history(&self, history: &[PlayHistoryItem]) -> Result<(), String> {
        let path = self.file_path("history.json");
        let json = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn load_favorites(&self) -> Vec<FavoriteItem> {
        let path = self.file_path("favorites.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(favorites) = serde_json::from_str::<Vec<FavoriteItem>>(&content) {
                return favorites;
            }
        }
        Vec::new()
    }

    pub fn save_favorites(&self, favorites: &[FavoriteItem]) -> Result<(), String> {
        let path = self.file_path("favorites.json");
        let json = serde_json::to_string_pretty(favorites).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn load_settings(&self) -> AppSettings {
        let path = self.file_path("settings.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
        let defaults = AppSettings::default();
        let _ = self.save_settings(&defaults);
        defaults
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let path = self.file_path("settings.json");
        let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn reset_default_settings(&self) -> Result<AppSettings, String> {
        let defaults = AppSettings::default();
        self.save_settings(&defaults)?;
        Ok(defaults)
    }

    pub fn load_alias_cache(&self) -> HashMap<String, Vec<String>> {
        let path = self.file_path("alias_cache.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cache) = serde_json::from_str::<HashMap<String, Vec<String>>>(&content) {
                return cache;
            }
        }
        HashMap::new()
    }

    pub fn save_alias_cache(&self, cache: &HashMap<String, Vec<String>>) -> Result<(), String> {
        let path = self.file_path("alias_cache.json");
        let json = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn record_alias_mapping(&self, query: &str, candidates: &[String]) {
        let mut cache = self.load_alias_cache();
        let clean_key = query.trim().to_string();
        if !clean_key.is_empty() && !candidates.is_empty() {
            cache.insert(clean_key, candidates.to_vec());
            // Keep cache bounded to 2000 entries
            if cache.len() > 2000 {
                if let Some(first_key) = cache.keys().next().cloned() {
                    cache.remove(&first_key);
                }
            }
            let _ = self.save_alias_cache(&cache);
        }
    }
    pub fn load_taxonomy(&self) -> UserTaxonomyConfig {
        let path = self.file_path("taxonomy.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<UserTaxonomyConfig>(&content) {
                return config;
            }
        }
        let default_config = UserTaxonomyConfig::default();
        let _ = self.save_taxonomy(&default_config);
        default_config
    }

    pub fn save_taxonomy(&self, config: &UserTaxonomyConfig) -> Result<(), String> {
        let path = self.file_path("taxonomy.json");
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn reset_default_taxonomy(&self) -> Result<UserTaxonomyConfig, String> {
        let defaults = UserTaxonomyConfig::default();
        self.save_taxonomy(&defaults)?;
        Ok(defaults)
    }

    pub fn load_subscriptions(&self) -> Vec<SubscriptionItem> {
        let path = self.file_path("subscriptions.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(subs) = serde_json::from_str::<Vec<SubscriptionItem>>(&content) {
                return subs;
            }
        }
        Vec::new()
    }

    pub fn save_subscriptions(&self, subs: &[SubscriptionItem]) -> Result<(), String> {
        let path = self.file_path("subscriptions.json");
        let json = serde_json::to_string_pretty(subs).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn load_all_sources(&self) -> Vec<Source> {
        let mut all = self.load_sources();
        let engine = SubscriptionEngine::new(&self.data_dir);
        let subs = self.load_subscriptions();
        for sub in subs {
            if sub.enabled {
                if let Some(bundle) = engine.read_cached_bundle(&sub.id) {
                    let mut sub_sources = SubscriptionEngine::bundle_to_sources(&bundle, &sub.id);
                    all.append(&mut sub_sources);
                }
            }
        }
        all
    }
}
