use reqwest::header::{ETAG, IF_NONE_MATCH};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use crate::maccms::Source;

fn default_true() -> bool {
    true
}

fn default_update_interval() -> u32 {
    24
}

fn default_api_type() -> String {
    "auto".to_string()
}

/// A Clash-style Subscription Item registered by the user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionItem {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default = "default_update_interval")]
    pub update_interval_hours: u32,
    #[serde(default)]
    pub last_updated: u64, // Unix timestamp in seconds
    pub etag: Option<String>,
    #[serde(default)]
    pub source_count: usize,
    pub error_msg: Option<String>,
}

/// A shared source definition inside a subscription bundle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedSourceDefinition {
    pub id: String,
    pub name: String,
    pub api: String,
    #[serde(default = "default_api_type")]
    pub api_type: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub adult_type_ids: Vec<String>,
    #[serde(default)]
    pub category_mapping: HashMap<String, Vec<String>>,
}

/// A complete subscription package exported/hosted online
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedSourceBundle {
    pub name: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub sources: Vec<SharedSourceDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionSyncResult {
    pub subscription_id: String,
    pub success: bool,
    pub updated: bool,
    pub source_count: usize,
    pub message: String,
}

pub struct SubscriptionEngine {
    client: Client,
    cache_dir: PathBuf,
}

impl SubscriptionEngine {
    pub fn new(base_dir: &Path) -> Self {
        let cache_dir = base_dir.join("subscriptions");
        let _ = fs::create_dir_all(&cache_dir);
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("uuMovies/0.1.0 (Windows NT 10.0; Win64; x64) AppleCMS-SubscriptionEngine")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, cache_dir }
    }

    fn cache_path(&self, sub_id: &str) -> PathBuf {
        self.cache_dir.join(format!("cache_{}.json", sub_id))
    }

    /// Read cached bundle from local disk
    pub fn read_cached_bundle(&self, sub_id: &str) -> Option<SharedSourceBundle> {
        let path = self.cache_path(sub_id);
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(bundle) = serde_json::from_str::<SharedSourceBundle>(&content) {
                    return Some(bundle);
                }
            }
        }
        None
    }

    /// Delete cached bundle when subscription is removed
    pub fn remove_cached_bundle(&self, sub_id: &str) {
        let path = self.cache_path(sub_id);
        let _ = fs::remove_file(path);
    }

    /// Convert SharedSourceDefinition items to MacCMS Source objects
    pub fn bundle_to_sources(bundle: &SharedSourceBundle, sub_id: &str) -> Vec<Source> {
        bundle
            .sources
            .iter()
            .map(|s| Source {
                id: format!("sub_{}_{}", sub_id, s.id),
                name: s.name.clone(),
                api_url: s.api.clone(),
                api_type: s.api_type.clone(),
                enabled: true,
                group: s.group.clone().or_else(|| bundle.name.clone()),
                adult_type_ids: s.adult_type_ids.clone(),
                category_mapping: s.category_mapping.clone(),
                subscription_id: Some(sub_id.to_string()),
            })
            .collect()
    }

    /// Fetch and update a subscription from remote URL using ETag conditional request
    pub async fn sync_subscription(
        &self,
        sub: &mut SubscriptionItem,
    ) -> Result<SubscriptionSyncResult, String> {
        let mut req = self.client.get(&sub.url);
        if let Some(etag) = &sub.etag {
            req = req.header(IF_NONE_MATCH, etag);
        }

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let err = format!("网络请求失败: {e}");
                sub.error_msg = Some(err.clone());
                return Err(err);
            }
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        sub.last_updated = now;

        if resp.status() == StatusCode::NOT_MODIFIED {
            // 304: Content not modified, load from cache
            let cached = self.read_cached_bundle(&sub.id);
            let count = cached.map(|b| b.sources.len()).unwrap_or(0);
            sub.source_count = count;
            sub.error_msg = None;
            return Ok(SubscriptionSyncResult {
                subscription_id: sub.id.clone(),
                success: true,
                updated: false,
                source_count: count,
                message: "订阅内容未变更 (304 Not Modified)".to_string(),
            });
        }

        if !resp.status().is_success() {
            let err = format!("远程服务器返回错误状态: {}", resp.status());
            sub.error_msg = Some(err.clone());
            return Err(err);
        }

        // 200 OK: Extract ETag if present
        let new_etag = resp
            .headers()
            .get(ETAG)
            .and_then(|h| h.to_str().ok())
            .map(|s| s.to_string());
        if new_etag.is_some() {
            sub.etag = new_etag;
        }

        let body = match resp.text().await {
            Ok(b) => b,
            Err(e) => {
                let err = format!("读取响应内容失败: {e}");
                sub.error_msg = Some(err.clone());
                return Err(err);
            }
        };

        let bundle: SharedSourceBundle = match serde_json::from_str(&body) {
            Ok(b) => b,
            Err(e) => {
                let err = format!("订阅 JSON 结构解析失败: {e}");
                sub.error_msg = Some(err.clone());
                return Err(err);
            }
        };

        // Cache bundle to disk
        let cache_file = self.cache_path(&sub.id);
        let _ = fs::write(cache_file, &body);

        let count = bundle.sources.len();
        sub.source_count = count;
        sub.error_msg = None;

        Ok(SubscriptionSyncResult {
            subscription_id: sub.id.clone(),
            success: true,
            updated: true,
            source_count: count,
            message: format!("订阅同步成功，已载入 {} 个采集源", count),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_shared_bundle_and_convert_sources() {
        let json_data = r##"{
            "name": "社区优质高速源汇总",
            "version": "1.0.0",
            "author": "Tester",
            "sources": [
                {
                    "id": "bfzy",
                    "name": "暴风资源",
                    "api": "https://bfzyapi.com/api.php/provide/vod",
                    "api_type": "json",
                    "adult_type_ids": ["22", "44"],
                    "category_mapping": {
                        "#movie": ["1", "6", "7", "8"],
                        "#tv": ["2", "14", "15"]
                    }
                }
            ]
        }"##;

        let bundle: SharedSourceBundle = serde_json::from_str(json_data).unwrap();
        assert_eq!(bundle.name, Some("社区优质高速源汇总".to_string()));
        assert_eq!(bundle.sources.len(), 1);

        let sources = SubscriptionEngine::bundle_to_sources(&bundle, "sub_1");
        assert_eq!(sources.len(), 1);
        let s = &sources[0];
        assert_eq!(s.id, "sub_sub_1_bfzy");
        assert_eq!(s.name, "暴风资源");
        assert_eq!(s.adult_type_ids, vec!["22", "44"]);
        assert!(s.category_mapping.contains_key("#movie"));
    }
}
