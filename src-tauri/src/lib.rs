pub mod douban;
pub mod downloader;
pub mod entity_resolution;
pub mod maccms;
pub mod storage;
pub mod taxonomy;
pub mod subscription;
pub mod cast;
pub mod updater;

use douban::{DoubanClient, DoubanMetadata};
use downloader::{DownloadManager, DownloadTask};
use maccms::{MacCmsClient, Source, TestResult, VodItem, VodResponse};
use serde::{Deserialize, Serialize};
use storage::{AppSettings, FavoriteItem, PlayHistoryItem, StorageManager};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, State};

pub struct AppState {
    pub client: MacCmsClient,
    pub douban: DoubanClient,
    pub storage: Mutex<StorageManager>,
    pub downloader: Arc<DownloadManager>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossStationPlayLine {
    pub source_id: String,
    pub source_name: String,
    pub line_title: String,
    pub full_title: String,
    pub episodes: Vec<maccms::Episode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum SearchStreamEvent {
    #[serde(rename = "items")]
    Items(Vec<VodItem>),
    #[serde(rename = "aliases")]
    Aliases(Vec<String>),
    #[serde(rename = "progress")]
    Progress {
        completed: usize,
        total: usize,
        source_name: String,
    },
    #[serde(rename = "done")]
    Done,
}
#[tauri::command]
async fn get_sources(state: State<'_, AppState>) -> Result<Vec<Source>, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    Ok(storage.load_all_sources())
}

#[tauri::command]
async fn save_sources(sources: Vec<Source>, state: State<'_, AppState>) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.save_sources(&sources)
}

#[tauri::command]
async fn reset_default_sources(state: State<'_, AppState>) -> Result<Vec<Source>, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let defaults = maccms::get_default_sources();
    storage.save_sources(&defaults)?;
    Ok(defaults)
}

#[tauri::command]
async fn fetch_vod_list(
    source_id: String,
    type_id: Option<String>,
    page: Option<i64>,
    keyword: Option<String>,
    hours: Option<i64>,
    state: State<'_, AppState>,
) -> Result<VodResponse, String> {
    let (source, taxonomy) = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        let src = storage
            .load_all_sources()
            .into_iter()
            .find(|s| s.id == source_id)
            .ok_or_else(|| format!("采集源未找到: {source_id}"))?;
        let tax = storage.load_taxonomy();
        (src, tax)
    };

    let multiple_ids: Vec<String> = match &type_id {
        Some(s) if s.contains(',') => s
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect(),
        _ => Vec::new(),
    };

    let mut res = if multiple_ids.len() > 1 {
        let tasks: Vec<_> = multiple_ids
            .into_iter()
            .map(|tid| {
                let client = state.client.clone();
                let src = source.clone();
                let kw = keyword.clone();
                async move {
                    client
                        .fetch_vod(&src, Some(&tid), page, kw.as_deref(), None, hours)
                        .await
                }
            })
            .collect();

        let results = futures_util::future::join_all(tasks).await;

        let mut combined_classes = Vec::new();
        let mut seen_class_ids = std::collections::HashSet::new();
        let mut combined_list = Vec::new();
        let mut seen_vod_ids = std::collections::HashSet::new();
        let mut total_sum: i64 = 0;

        for r in results.into_iter().flatten() {
            total_sum += r.total;
            for c in r.classes {
                if seen_class_ids.insert(c.type_id.clone()) {
                    combined_classes.push(c);
                 }
             }
            for v in r.list {
                if seen_vod_ids.insert(v.vod_id.clone()) {
                    combined_list.push(v);
                }
            }
        }

        // Sort combined videos by update time descending
        combined_list.sort_by(|a, b| b.vod_time.cmp(&a.vod_time));
        combined_list.truncate(20);

        let page_num = page.unwrap_or(1);
        let page_count = if total_sum > 0 { (total_sum + 19) / 20 } else { 1 };

        VodResponse {
            page: page_num,
            pagecount: page_count,
            limit: 20,
            total: total_sum,
            list: combined_list,
            classes: combined_classes,
        }
    } else {
        state
            .client
            .fetch_vod(
                &source,
                type_id.as_deref(),
                page,
                keyword.as_deref(),
                None,
                hours,
            )
            .await?
    };

    // Category Tree & PID Cascade Filtering
    let tree = crate::taxonomy::CategoryTree::from_categories(&res.classes);

    // 1. Resolve cascaded adult IDs
    let mut adult_roots = source.adult_type_ids.clone();
    if let Some(mapped_adults) = source.category_mapping.get(crate::taxonomy::TAG_18_PLUS) {
        adult_roots.extend(mapped_adults.clone());
    }
    for cat in &res.classes {
        let name_lower = cat.type_name.to_lowercase();
        if name_lower.contains("伦理")
            || name_lower.contains("成人")
            || name_lower.contains("福利")
            || name_lower.contains("情色")
            || name_lower.contains("三级")
            || name_lower.contains("擦边")
        {
            adult_roots.push(cat.type_id.clone());
        }
    }
    let effective_adult_ids = tree.resolve_cascade_descendants(&adult_roots);

    // 2. Resolve cascaded blocked IDs
    let mut blocked_roots = taxonomy.blocked_type_ids.clone();
    for cat in &res.classes {
        if let Some(tag) = tree.resolve_semantic_tag(&cat.type_id, &source.category_mapping) {
            if taxonomy.blocked_tags.contains(&tag) {
                blocked_roots.push(cat.type_id.clone());
            }
        }
    }
    let effective_blocked_ids = tree.resolve_cascade_descendants(&blocked_roots);

    // Filter classes and video list
    res.classes.retain(|c| {
        if effective_blocked_ids.contains(&c.type_id) {
            return false;
        }
        if !taxonomy.adult_mode && effective_adult_ids.contains(&c.type_id) {
            return false;
        }
        true
    });

    res.list.retain(|item| {
        if effective_blocked_ids.contains(&item.type_id) {
            return false;
        }
        if !taxonomy.adult_mode && effective_adult_ids.contains(&item.type_id) {
            return false;
        }
        true
    });

    Ok(res)
}

#[tauri::command]
async fn fetch_vod_detail(
    source_id: String,
    vod_id: String,
    state: State<'_, AppState>,
) -> Result<VodItem, String> {
    let sources = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.load_all_sources()
    };

    let source = sources
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("采集源未找到: {source_id}"))?;

    let res = state
        .client
        .fetch_vod(
            &source,
            None,
            Some(1),
            None,
            Some(&vod_id),
            None,
        )
        .await?;

    res.list
        .into_iter()
        .next()
        .ok_or_else(|| "未找到该影视详情".to_string())
}

#[tauri::command]
async fn aggregate_search(
    keyword: String,
    source_ids: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<Vec<VodItem>, String> {
    let trimmed_kw = keyword.trim();
    if trimmed_kw.is_empty() {
        return Ok(Vec::new());
    }

    // Expand keyword with aliases & canonical names
    let expanded_keywords = state.douban.expand_keywords(trimmed_kw).await;

    let sources = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.load_sources()
    };

    // Filter enabled sources or requested source_ids
    let active_sources: Vec<Source> = sources
        .into_iter()
        .filter(|s| {
            if let Some(ids) = &source_ids {
                ids.contains(&s.id) && s.enabled
            } else {
                s.enabled
            }
        })
        .collect();

    let mut tasks = Vec::new();
    for src in active_sources {
        for kw in &expanded_keywords {
            let client_ref = &state.client;
            let src_clone = src.clone();
            let query_kw = kw.clone();
            tasks.push(async move {
                match client_ref
                    .fetch_vod(&src_clone, None, Some(1), Some(&query_kw), None, None)
                    .await
                {
                    Ok(resp) => resp.list,
                    Err(_) => Vec::new(),
                }
            });
        }
    }

    let results = futures_util::future::join_all(tasks).await;
    let mut raw_items: Vec<VodItem> = Vec::new();
    for list in results {
        for item in list {
            if !raw_items.iter().any(|existing| existing.source_id == item.source_id && existing.vod_id == item.vod_id) {
                raw_items.push(item);
            }
        }
    }

    // Multi-factor entity resolution & deduplication across sources
    let merged_items = entity_resolution::deduplicate_and_merge_vods(raw_items);
    Ok(merged_items)
}

fn extract_text_core(s: &str) -> String {
    let re_year = match regex::Regex::new(r"19\d{2}|20\d{2}") {
        Ok(r) => r,
        Err(_) => return s.to_string(),
    };
    let re_season = match regex::Regex::new(r"第[一二三四五六七八九十0-9]+[季部篇]|s\d+") {
        Ok(r) => r,
        Err(_) => return s.to_string(),
    };
    let re_noise = match regex::Regex::new(r"4k|1080p|720p|hd|bd|tc|ts|国语|粤语|中字|抢先版|电影解说") {
        Ok(r) => r,
        Err(_) => return s.to_string(),
    };

    let clean = re_year.replace_all(s, "");
    let clean = re_season.replace_all(&clean, "");
    let clean = re_noise.replace_all(&clean, "");
    clean.trim().to_string()
}

fn is_search_result_relevant(item_name: &str, query: &str) -> bool {
    let clean_item = item_name
        .to_lowercase()
        .replace(&[' ', '-', '_', ':', '：', '·', '/', '【', '】', '[', ']', '(', ')', '（', '）'][..], "");
    let clean_query = query
        .to_lowercase()
        .replace(&[' ', '-', '_', ':', '：', '·', '/', '【', '】', '[', ']', '(', ')', '（', '）'][..], "");

    if clean_query.is_empty() || clean_item.is_empty() {
        return false;
    }

    let query_has_alpha = clean_query.chars().any(|c| c.is_alphabetic());
    let item_has_alpha = clean_item.chars().any(|c| c.is_alphabetic());

    // Pure digits cannot match textual queries
    if query_has_alpha && !item_has_alpha {
        return false;
    }

    if clean_item.contains(&clean_query) || clean_query.contains(&clean_item) {
        return true;
    }

    let text_query = extract_text_core(&clean_query);
    let text_item = extract_text_core(&clean_item);

    if !text_query.is_empty() {
        if text_item.contains(&text_query) || text_query.contains(&text_item) {
            return true;
        }

        let query_chars: std::collections::HashSet<char> = text_query.chars().filter(|c| c.is_alphabetic()).collect();
        let item_chars: std::collections::HashSet<char> = text_item.chars().filter(|c| c.is_alphabetic()).collect();
        let intersection = query_chars.intersection(&item_chars).count();

        if query_chars.len() >= 3 {
            if intersection >= 3 || intersection * 2 >= query_chars.len() {
                return true;
            }
        } else if !query_chars.is_empty() {
            if intersection == query_chars.len() {
                return true;
            }
        }
    } else {
        return clean_item.contains(&clean_query);
    }

    false
}

#[tauri::command]
async fn search_stream(
    keyword: String,
    source_ids: Option<Vec<String>>,
    on_event: Channel<SearchStreamEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let trimmed_kw = keyword.trim().to_string();
    if trimmed_kw.is_empty() {
        let _ = on_event.send(SearchStreamEvent::Done);
        return Ok(());
    }

    let sources = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.load_sources()
    };

    let active_sources: Vec<Source> = sources
        .into_iter()
        .filter(|s| {
            if let Some(ids) = &source_ids {
                ids.contains(&s.id) && s.enabled
            } else {
                s.enabled
            }
        })
        .collect();

    let total_sources = active_sources.len();
    if total_sources == 0 {
        let _ = on_event.send(SearchStreamEvent::Done);
        return Ok(());
    }

    // Fast-timeout client for search requests (5s timeout per station)
    let fast_search_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .connect_timeout(std::time::Duration::from_secs(3))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    // Step 1: Launch Douban alias expansion in parallel (does NOT block primary search!)
    let douban_client = state.douban.clone();
    let kw_for_douban = trimmed_kw.clone();
    let on_event_for_douban = on_event.clone();
    let (alias_tx, mut alias_rx) = tokio::sync::mpsc::channel::<Vec<String>>(1);

    tokio::spawn(async move {
        let aliases = douban_client.expand_keywords(&kw_for_douban).await;
        if aliases.len() > 1 {
            let _ = on_event_for_douban.send(SearchStreamEvent::Aliases(aliases.clone()));
        }
        let _ = alias_tx.send(aliases).await;
    });

    // Step 2: Concurrently query all active sources with the PRIMARY keyword
    // As each source returns, IMMEDIATELY stream results via on_event!
    let mut tasks = Vec::new();
    let completed_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for src in active_sources.clone() {
        let client = fast_search_client.clone();
        let query_kw = trimmed_kw.clone();
        let on_event_clone = on_event.clone();
        let completed_clone = Arc::clone(&completed_counter);
        let src_name = src.name.clone();

        tasks.push(tokio::spawn(async move {
            let params = vec![("ac", "videolist"), ("pg", "1"), ("wd", &query_kw)];
            let url = maccms::MacCmsClient::build_url(&src.api_url, &params);

            let mut fetched_items = Vec::new();
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    if let Ok(text) = resp.text().await {
                        let trimmed = text.trim();
                        let parsed = if src.api_type == "xml" || (src.api_type == "auto" && trimmed.starts_with('<')) {
                            maccms::parse_xml_response(trimmed, &src)
                        } else {
                            maccms::parse_json_response(trimmed, &src)
                        };
                        if let Ok(data) = parsed {
                            fetched_items = data.list;
                        }
                    }
                }
            }

            let completed = completed_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            let relevant_items: Vec<maccms::VodItem> = fetched_items
                .into_iter()
                .filter(|it| is_search_result_relevant(&it.vod_name, &query_kw))
                .collect();

            if !relevant_items.is_empty() {
                let _ = on_event_clone.send(SearchStreamEvent::Items(relevant_items.clone()));
            }

            let _ = on_event_clone.send(SearchStreamEvent::Progress {
                completed,
                total: total_sources,
                source_name: src_name,
            });

            (src, relevant_items.len())

        }));
    }

    let source_results = futures_util::future::join_all(tasks).await;

    // Step 3: If Douban returned any aliases, query sources that had 0 results
    if let Ok(Some(aliases)) = tokio::time::timeout(std::time::Duration::from_millis(2000), alias_rx.recv()).await {
        let alternative_kws: Vec<String> = aliases
            .into_iter()
            .filter(|a| a != &trimmed_kw)
            .take(2)
            .collect();

        if !alternative_kws.is_empty() {
            let mut secondary_tasks = Vec::new();
            for res in source_results.into_iter().flatten() {
                let (src, hit_count) = res;
                if hit_count == 0 {
                    for alt_kw in &alternative_kws {
                        let client = fast_search_client.clone();
                        let src_ref = src.clone();
                        let clean_query_kw = alt_kw.replace(' ', "");
                        let target_query = if clean_query_kw.is_empty() { alt_kw.clone() } else { clean_query_kw };
                        let orig_query = trimmed_kw.clone();
                        let on_event_clone = on_event.clone();

                        secondary_tasks.push(tokio::spawn(async move {
                            let params = vec![("ac", "videolist"), ("pg", "1"), ("wd", &target_query)];
                            let url = maccms::MacCmsClient::build_url(&src_ref.api_url, &params);
                            if let Ok(resp) = client.get(&url).send().await {
                                if resp.status().is_success() {
                                    if let Ok(text) = resp.text().await {
                                        let trimmed = text.trim();
                                        let parsed = if src_ref.api_type == "xml" || (src_ref.api_type == "auto" && trimmed.starts_with('<')) {
                                            maccms::parse_xml_response(trimmed, &src_ref)
                                        } else {
                                            maccms::parse_json_response(trimmed, &src_ref)
                                        };
                                        if let Ok(data) = parsed {
                                            let relevant: Vec<maccms::VodItem> = data.list
                                                .into_iter()
                                                .filter(|it| {
                                                    is_search_result_relevant(&it.vod_name, &target_query)
                                                        || is_search_result_relevant(&it.vod_name, &orig_query)
                                                })
                                                .collect();
                                            if !relevant.is_empty() {
                                                let _ = on_event_clone.send(SearchStreamEvent::Items(relevant));
                                            }
                                        }
                                    }
                                }
                            }
                        }));
                    }
                }
            }
            let _ = futures_util::future::join_all(secondary_tasks).await;
        }
    }

    let _ = on_event.send(SearchStreamEvent::Done);
    Ok(())
}

#[tauri::command]
async fn expand_search_keywords(
    keyword: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let clean = keyword.trim().to_string();
    if clean.is_empty() {
        return Ok(Vec::new());
    }

    // 1. Check custom aliases from settings
    let (custom_match, cached_match) = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        let settings = storage.load_settings();
        let custom = settings.custom_aliases.get(&clean).cloned();
        let cache = storage.load_alias_cache();
        let cached = cache.get(&clean).cloned();
        (custom, cached)
    };

    if let Some(target) = custom_match {
        return Ok(vec![clean, target]);
    }

    if let Some(candidates) = cached_match {
        if !candidates.is_empty() {
            return Ok(candidates);
        }
    }

    // 2. Query dynamic Douban search
    let resolved = state.douban.expand_keywords(&clean).await;

    // 3. Record in local self-learning cache
    if !resolved.is_empty() {
        if let Ok(storage) = state.storage.lock() {
            storage.record_alias_mapping(&clean, &resolved);
        }
    }

    Ok(resolved)
}

#[tauri::command]
async fn sync_alias_subscription(
    url: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let target_url = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        url.or_else(|| storage.load_settings().alias_subscription_url)
            .ok_or_else(|| "未配置订阅链接".to_string())?
    };

    let req_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = req_client
        .get(&target_url)
        .send()
        .await
        .map_err(|e| format!("请求订阅失败: {e}"))?;

    let json_val = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析订阅规则JSON失败: {e}"))?;

    let mut imported = 0usize;
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut cache = storage.load_alias_cache();

    if let Some(map) = json_val.as_object() {
        for (k, v) in map {
            let mut list = Vec::new();
            if let Some(arr) = v.as_array() {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        list.push(s.to_string());
                    }
                }
            } else if let Some(s) = v.as_str() {
                list.push(s.to_string());
            }

            if !list.is_empty() {
                cache.insert(k.clone(), list);
                imported += 1;
            }
        }
    }

    storage.save_alias_cache(&cache)?;
    Ok(imported)
}

#[tauri::command]
async fn get_custom_aliases(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    Ok(storage.load_settings().custom_aliases)
}

#[tauri::command]
async fn save_custom_aliases(
    aliases: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut settings = storage.load_settings();
    settings.custom_aliases = aliases;
    storage.save_settings(&settings)
}

#[tauri::command]
async fn test_single_source(
    source: Source,
    state: State<'_, AppState>,
) -> Result<TestResult, String> {
    Ok(state.client.test_source(&source).await)
}

#[tauri::command]
async fn test_all_sources(state: State<'_, AppState>) -> Result<Vec<TestResult>, String> {
    let sources = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.load_sources()
    };

    let mut tasks = Vec::new();
    for src in sources {
        let client_ref = &state.client;
        tasks.push(async move { client_ref.test_source(&src).await });
    }

    let results = futures_util::future::join_all(tasks).await;
    Ok(results)
}

#[tauri::command]
async fn get_history(state: State<'_, AppState>) -> Result<Vec<PlayHistoryItem>, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut history = storage.load_history();
    history.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(history)
}

#[tauri::command]
async fn save_history_item(
    item: PlayHistoryItem,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut history = storage.load_history();

    // Deduplicate: remove older record for the same vod_id + source_id
    history.retain(|h| !(h.vod_id == item.vod_id && h.source_id == item.source_id));
    history.insert(0, item);

    // Keep at most 100 history entries
    if history.len() > 100 {
        history.truncate(100);
    }

    storage.save_history(&history)
}

#[tauri::command]
async fn remove_history_item(
    vod_id: String,
    source_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut history = storage.load_history();
    history.retain(|h| !(h.vod_id == vod_id && h.source_id == source_id));
    storage.save_history(&history)
}

#[tauri::command]
async fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.save_history(&[])
}

#[tauri::command]
async fn get_favorites(state: State<'_, AppState>) -> Result<Vec<FavoriteItem>, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut favs = storage.load_favorites();
    favs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(favs)
}

#[tauri::command]
async fn toggle_favorite(
    item: FavoriteItem,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut favs = storage.load_favorites();

    let exists = favs.iter().any(|f| f.vod_id == item.vod_id && f.source_id == item.source_id);
    if exists {
        favs.retain(|f| !(f.vod_id == item.vod_id && f.source_id == item.source_id));
        storage.save_favorites(&favs)?;
        Ok(false) // Unfavorited
    } else {
        favs.insert(0, item);
        storage.save_favorites(&favs)?;
        Ok(true) // Favorited
    }
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    Ok(storage.load_settings())
}

#[tauri::command]
async fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.save_settings(&settings)
}

#[tauri::command]
async fn reset_default_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.reset_default_settings()
}

#[tauri::command]
async fn add_download_task(
    vod_id: String,
    vod_name: String,
    vod_pic: Option<String>,
    line_title: String,
    episode_name: String,
    url: String,
    state: State<'_, AppState>,
) -> Result<DownloadTask, String> {
    let custom_dir = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.load_settings().download_dir
    };
    let task = state
        .downloader
        .add_task(
            vod_id,
            vod_name,
            vod_pic,
            line_title,
            episode_name,
            url,
            custom_dir,
        )
        .await?;

    // Automatically start task
    let _ = state.downloader.start_download(task.id.clone()).await;
    Ok(task)
}

#[tauri::command]
async fn start_download_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.downloader.start_download(task_id).await
}

#[tauri::command]
async fn pause_download_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.downloader.pause_download(&task_id).await
}

#[tauri::command]
async fn delete_download_task(
    task_id: String,
    delete_file: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.downloader.delete_task(&task_id, delete_file).await
}

#[tauri::command]
async fn get_download_tasks(state: State<'_, AppState>) -> Result<Vec<DownloadTask>, String> {
    Ok(state.downloader.get_all_tasks().await)
}

#[tauri::command]
async fn get_default_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.downloader.default_download_dir().to_string_lossy().to_string())
}

#[tauri::command]
async fn open_download_dir(file_path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&file_path);
    let folder = if path.is_file() {
        path.parent().map(|p| p.to_path_buf()).unwrap_or(path)
    } else {
        path
    };

    let _ = std::fs::create_dir_all(&folder);
    let folder_str = folder.to_string_lossy().to_string();

    if let Err(_) = tauri_plugin_opener::open_path(&folder_str, None::<&str>) {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("explorer").arg(&folder_str).spawn();
        }
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("xdg-open").arg(&folder_str).spawn();
        }
    }

    Ok(())
}

#[tauri::command]
async fn pick_download_dir() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("powershell");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.args(&[
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '选择视频下载保存目录'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
        ]);
        let output = cmd.output();
        if let Ok(out) = output {
            let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !res.is_empty() {
                return Ok(Some(res));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("zenity")
            .args(&["--file-selection", "--directory", "--title=选择视频下载保存目录"])
            .output();
        if let Ok(out) = output {
            let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !res.is_empty() {
                return Ok(Some(res));
            }
        }
        let output_kd = std::process::Command::new("kdialog")
            .args(&["--getexistingdirectory", "--title", "选择视频下载保存目录"])
            .output();
        if let Ok(out) = output_kd {
            let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !res.is_empty() {
                return Ok(Some(res));
            }
        }
    }
    Ok(None)
}
#[tauri::command]
async fn get_douban_metadata(
    title: String,
    state: State<'_, AppState>,
) -> Result<DoubanMetadata, String> {
    state.douban.query_metadata(&title).await
}

#[tauri::command]
async fn aggregate_cross_station_lines(
    vod_name: String,
    current_source_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<CrossStationPlayLine>, String> {
    let clean_title = DoubanClient::normalize_title(&vod_name);
    if clean_title.is_empty() {
        return Ok(Vec::new());
    }

    let sources = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.load_sources()
    };

    let active_sources: Vec<Source> = sources.into_iter().filter(|s| s.enabled).collect();

    let mut tasks = Vec::new();
    for src in active_sources {
        let client_ref = &state.client;
        let query_kw = clean_title.clone();
        tasks.push(async move {
            let res = client_ref
                .fetch_vod(&src, None, Some(1), Some(&query_kw), None, None)
                .await;
            (src, res)
        });
    }

    let results = futures_util::future::join_all(tasks).await;
    let mut all_lines: Vec<CrossStationPlayLine> = Vec::new();

    for (src, res) in results {
        if let Ok(vod_resp) = res {
            let matched_item = vod_resp.list.into_iter().find(|item| {
                let item_norm = DoubanClient::normalize_title(&item.vod_name);
                item_norm == clean_title
                    || item.vod_name.contains(&clean_title)
                    || clean_title.contains(&item.vod_name)
            });

            if let Some(item) = matched_item {
                for line in item.play_lines {
                    if !line.episodes.is_empty() {
                        let full_title = format!("{} · {}", src.name, line.title);
                        all_lines.push(CrossStationPlayLine {
                            source_id: src.id.clone(),
                            source_name: src.name.clone(),
                            line_title: line.title,
                            full_title,
                            episodes: line.episodes,
                        });
                    }
                }
            }
        }
    }

    if let Some(curr_id) = &current_source_id {
        all_lines.sort_by_key(|l| if &l.source_id == curr_id { 0 } else { 1 });
    }

    Ok(all_lines)
}
#[tauri::command]
async fn get_taxonomy(
    state: State<'_, AppState>,
) -> Result<crate::taxonomy::UserTaxonomyConfig, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    Ok(storage.load_taxonomy())
}

#[tauri::command]
async fn save_taxonomy(
    config: crate::taxonomy::UserTaxonomyConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.save_taxonomy(&config)
}

#[tauri::command]
async fn reset_default_taxonomy(
    state: State<'_, AppState>,
) -> Result<crate::taxonomy::UserTaxonomyConfig, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.reset_default_taxonomy()
}

#[tauri::command]
async fn get_subscriptions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::subscription::SubscriptionItem>, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    Ok(storage.load_subscriptions())
}

#[tauri::command]
async fn save_subscriptions(
    subscriptions: Vec<crate::subscription::SubscriptionItem>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.save_subscriptions(&subscriptions)
}

#[tauri::command]
async fn sync_subscription(
    subscription_id: String,
    state: State<'_, AppState>,
) -> Result<crate::subscription::SubscriptionSyncResult, String> {
    let mut sub = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        let subs = storage.load_subscriptions();
        subs.into_iter()
            .find(|s| s.id == subscription_id)
            .ok_or_else(|| format!("未找到订阅: {}", subscription_id))?
    };

    let base_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("uumovies_player");
    let engine = crate::subscription::SubscriptionEngine::new(&base_dir);
    let result = engine.sync_subscription(&mut sub).await?;

    {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        let mut subs = storage.load_subscriptions();
        if let Some(target) = subs.iter_mut().find(|s| s.id == subscription_id) {
            *target = sub;
        }
        storage.save_subscriptions(&subs)?;
    }

    Ok(result)
}

#[tauri::command]
async fn sync_all_subscriptions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::subscription::SubscriptionSyncResult>, String> {
    let base_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("uumovies_player");
    let engine = crate::subscription::SubscriptionEngine::new(&base_dir);

    let mut subs = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.load_subscriptions()
    };

    let mut results = Vec::new();
    for sub in &mut subs {
        if sub.enabled {
            match engine.sync_subscription(sub).await {
                Ok(r) => results.push(r),
                Err(e) => results.push(crate::subscription::SubscriptionSyncResult {
                    subscription_id: sub.id.clone(),
                    success: false,
                    updated: false,
                    source_count: sub.source_count,
                    message: e,
                }),
            }
        }
    }

    {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.save_subscriptions(&subs)?;
    }

    Ok(results)
}

#[tauri::command]
async fn delete_subscription(
    subscription_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let base_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("uumovies_player");
    let engine = crate::subscription::SubscriptionEngine::new(&base_dir);
    engine.remove_cached_bundle(&subscription_id);

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut subs = storage.load_subscriptions();
    subs.retain(|s| s.id != subscription_id);
    storage.save_subscriptions(&subs)
}


#[tauri::command]
async fn drag_window(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_maximize_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}
#[tauri::command]
async fn is_window_maximized(window: tauri::Window) -> Result<bool, String> {
    Ok(window.is_maximized().unwrap_or(false))
}

#[tauri::command]
async fn get_source_classes(
    source_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<maccms::Category>, String> {
    let source = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage
            .load_all_sources()
            .into_iter()
            .find(|s| s.id == source_id)
            .ok_or_else(|| format!("采集源未找到: {source_id}"))?
    };

    Ok(state.client.fetch_classes(&source).await)
}

#[tauri::command]
async fn discover_dlna_devices() -> Result<Vec<cast::DlnaDevice>, String> {
    cast::CastManager::discover_devices(3).await
}

#[tauri::command]
async fn cast_to_dlna_device(
    device: cast::DlnaDevice,
    video_title: String,
    stream_url: String,
) -> Result<String, String> {
    cast::CastManager::cast_to_device(device, video_title, stream_url).await
}

#[tauri::command]
async fn stop_dlna_cast(control_url: String) -> Result<(), String> {
    cast::CastManager::stop_cast(control_url).await
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let storage_mgr = StorageManager::new();
    let _ = storage_mgr.load_sources(); // forces data_dir setup
    let base_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("uumovies_player");

    let app_state = AppState {
        client: MacCmsClient::new(),
        douban: DoubanClient::new(),
        storage: Mutex::new(storage_mgr),
        downloader: Arc::new(DownloadManager::new(base_dir)),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_sources,
            save_sources,
            reset_default_sources,
            fetch_vod_list,
            fetch_vod_detail,
            aggregate_search,
            test_single_source,
            test_all_sources,
            get_history,
            save_history_item,
            remove_history_item,
            clear_history,
            get_favorites,
            toggle_favorite,
            get_settings,
            save_settings,
            reset_default_settings,
            add_download_task,
            start_download_task,
            pause_download_task,
            delete_download_task,
            get_download_tasks,
            get_default_download_dir,
            pick_download_dir,
            open_download_dir,
            get_douban_metadata,
            aggregate_cross_station_lines,
            expand_search_keywords,
            sync_alias_subscription,
            get_custom_aliases,
            save_custom_aliases,
            search_stream,
            get_taxonomy,
            save_taxonomy,
            reset_default_taxonomy,
            get_subscriptions,
            save_subscriptions,
            sync_subscription,
            sync_all_subscriptions,
            delete_subscription,
            minimize_window,
            drag_window,
            toggle_maximize_window,
            close_window,
            is_window_maximized,
            get_source_classes,
            discover_dlna_devices,
            cast_to_dlna_device,
            stop_dlna_cast,
            updater::check_app_update,
            updater::get_app_version,
            updater::open_external_url,
            updater::install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
