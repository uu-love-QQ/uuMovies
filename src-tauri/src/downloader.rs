use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::{watch, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub vod_id: String,
    pub vod_name: String,
    pub vod_pic: Option<String>,
    pub line_title: String,
    pub episode_name: String,
    pub url: String,
    pub file_path: String,
    pub status: String, // "pending" | "downloading" | "paused" | "completed" | "error"
    pub progress: f64,  // 0.0 ~ 100.0
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub error_msg: Option<String>,
    pub created_at: u64,
}

pub struct DownloadManager {
    pub tasks: Arc<Mutex<Vec<DownloadTask>>>,
    cancel_senders: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    client: Client,
    data_dir: PathBuf,
}

impl DownloadManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        let tasks_file = data_dir.join("downloads.json");
        let initial_tasks = if let Ok(content) = std::fs::read_to_string(&tasks_file) {
            serde_json::from_str::<Vec<DownloadTask>>(&content).unwrap_or_default()
        } else {
            Vec::new()
        };

        Self {
            tasks: Arc::new(Mutex::new(initial_tasks)),
            cancel_senders: Arc::new(Mutex::new(HashMap::new())),
            client,
            data_dir,
        }
    }

    pub fn default_download_dir(&self) -> PathBuf {
        dirs::download_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
            .join("uuMovies")
    }

    pub async fn save_tasks(&self) {
        let tasks = self.tasks.lock().await;
        let tasks_file = self.data_dir.join("downloads.json");
        if let Ok(json) = serde_json::to_string_pretty(&*tasks) {
            let _ = tokio::fs::write(tasks_file, json).await;
        }
    }

    pub async fn get_all_tasks(&self) -> Vec<DownloadTask> {
        let tasks = self.tasks.lock().await;
        tasks.clone()
    }

    pub async fn add_task(
        &self,
        vod_id: String,
        vod_name: String,
        vod_pic: Option<String>,
        line_title: String,
        episode_name: String,
        url: String,
        custom_save_dir: Option<String>,
    ) -> Result<DownloadTask, String> {
        let task_id = format!("{}_{}", vod_id, episode_name.replace(['/', '\\', ' '], "_"));

        let mut tasks = self.tasks.lock().await;
        if let Some(existing) = tasks.iter().find(|t| t.id == task_id) {
            return Ok(existing.clone());
        }

        let base_dir = custom_save_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_download_dir());
        let _ = fs::create_dir_all(&base_dir).await;

        let safe_vod_name = vod_name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        let safe_ep_name = episode_name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        let ext = if url.contains(".mp4") { "mp4" } else { "ts" };
        let file_name = format!("{}_{}.{}", safe_vod_name, safe_ep_name, ext);
        let file_path = base_dir.join(file_name).to_string_lossy().to_string();

        let task = DownloadTask {
            id: task_id,
            vod_id,
            vod_name,
            vod_pic,
            line_title,
            episode_name,
            url,
            file_path,
            status: "pending".to_string(),
            progress: 0.0,
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0,
            error_msg: None,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };

        tasks.insert(0, task.clone());
        drop(tasks);
        self.save_tasks().await;

        Ok(task)
    }

    pub async fn start_download(self: &Arc<Self>, task_id: String) -> Result<(), String> {
        let (task, client) = {
            let mut tasks = self.tasks.lock().await;
            let task = tasks
                .iter_mut()
                .find(|t| t.id == task_id)
                .ok_or_else(|| "下载任务不存在".to_string())?;

            if task.status == "downloading" {
                return Ok(());
            }

            task.status = "downloading".to_string();
            task.error_msg = None;
            (task.clone(), self.client.clone())
        };
        self.save_tasks().await;

        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut senders = self.cancel_senders.lock().await;
            senders.insert(task_id.clone(), cancel_tx);
        }

        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let is_m3u8 = task.url.contains(".m3u8") || !task.url.contains(".mp4");
            let result = if is_m3u8 {
                download_m3u8(task.clone(), client, cancel_rx, Arc::clone(&manager)).await
            } else {
                download_direct(task.clone(), client, cancel_rx, Arc::clone(&manager)).await
            };

            let mut tasks = manager.tasks.lock().await;
            if let Some(t) = tasks.iter_mut().find(|item| item.id == task.id) {
                t.speed_bytes_per_sec = 0;
                match result {
                    Ok(()) => {
                        t.status = "completed".to_string();
                        t.progress = 100.0;
                    }
                    Err(e) if e == "CANCELLED" => {
                        t.status = "paused".to_string();
                    }
                    Err(e) => {
                        t.status = "error".to_string();
                        t.error_msg = Some(e);
                    }
                }
            }
            drop(tasks);
            manager.save_tasks().await;

            let mut senders = manager.cancel_senders.lock().await;
            senders.remove(&task.id);
        });

        Ok(())
    }

    pub async fn pause_download(&self, task_id: &str) -> Result<(), String> {
        let senders = self.cancel_senders.lock().await;
        if let Some(tx) = senders.get(task_id) {
            let _ = tx.send(true);
        }

        let mut tasks = self.tasks.lock().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.status = "paused".to_string();
            task.speed_bytes_per_sec = 0;
        }
        drop(tasks);
        self.save_tasks().await;
        Ok(())
    }

    pub async fn delete_task(&self, task_id: &str, delete_file: bool) -> Result<(), String> {
        let _ = self.pause_download(task_id).await;

        let mut tasks = self.tasks.lock().await;
        let mut file_to_remove = None;
        if let Some(pos) = tasks.iter().position(|t| t.id == task_id) {
            let removed = tasks.remove(pos);
            if delete_file {
                file_to_remove = Some(removed.file_path);
            }
        }
        drop(tasks);
        self.save_tasks().await;

        if let Some(p) = file_to_remove {
            let _ = fs::remove_file(p).await;
        }

        Ok(())
    }
}

/// Helper to download direct media files (MP4, etc.)
async fn download_direct(
    task: DownloadTask,
    client: Client,
    cancel_rx: watch::Receiver<bool>,
    manager: Arc<DownloadManager>,
) -> Result<(), String> {
    let resp = client
        .get(&task.url)
        .send()
        .await
        .map_err(|e| format!("无法连接视频地址: {e}"))?;

    let total_bytes = resp.content_length().unwrap_or(0);
    let path = Path::new(&task.file_path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }

    let mut file = File::create(path)
        .await
        .map_err(|e| format!("创建文件失败: {e}"))?;

    let mut resp = resp;
    let mut downloaded = 0u64;
    let mut last_instant = Instant::now();
    let mut bytes_since_last = 0u64;

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("读取视频流数据失败: {e}"))? {
        if *cancel_rx.borrow() {
            return Err("CANCELLED".to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;

        downloaded += chunk.len() as u64;
        bytes_since_last += chunk.len() as u64;

        if last_instant.elapsed() >= Duration::from_millis(500) {
            let elapsed_sec = last_instant.elapsed().as_secs_f64();
            let speed = (bytes_since_last as f64 / elapsed_sec) as u64;

            let mut tasks = manager.tasks.lock().await;
            if let Some(t) = tasks.iter_mut().find(|item| item.id == task.id) {
                t.downloaded_bytes = downloaded;
                t.total_bytes = total_bytes;
                t.speed_bytes_per_sec = speed;
                if total_bytes > 0 {
                    t.progress = (downloaded as f64 / total_bytes as f64) * 100.0;
                }
            }
            drop(tasks);

            last_instant = Instant::now();
            bytes_since_last = 0;
        }
    }

    Ok(())
}

/// Helper to download M3U8 streaming files and concatenate TS segments
async fn download_m3u8(
    task: DownloadTask,
    client: Client,
    cancel_rx: watch::Receiver<bool>,
    manager: Arc<DownloadManager>,
) -> Result<(), String> {
    // 1. Fetch M3U8 content
    let resp = client
        .get(&task.url)
        .send()
        .await
        .map_err(|e| format!("请求 M3U8 地址失败: {e}"))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 M3U8 内容失败: {e}"))?;

    // Check if it is a Master playlist (contains #EXT-X-STREAM-INF)
    let final_m3u8_url = if text.contains("#EXT-X-STREAM-INF") {
        resolve_m3u8_sub_stream(&task.url, &text)
    } else {
        task.url.clone()
    };

    let playlist_text = if final_m3u8_url != task.url {
        client
            .get(&final_m3u8_url)
            .send()
            .await
            .map_err(|e| format!("获取主播放列表失败: {e}"))?
            .text()
            .await
            .map_err(|e| format!("读取子列表失败: {e}"))?
    } else {
        text
    };

    // 2. Parse TS segment URLs
    let segment_urls = parse_m3u8_segments(&final_m3u8_url, &playlist_text);
    if segment_urls.is_empty() {
        return Err("M3U8 未找到任何有效的视频分片".to_string());
    }

    let total_segments = segment_urls.len();
    let path = Path::new(&task.file_path);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .await
        .map_err(|e| format!("无法创建本地保存文件: {e}"))?;

    let mut downloaded_bytes = 0u64;
    let mut completed_segments = 0usize;
    let mut last_instant = Instant::now();
    let mut bytes_since_last = 0u64;

    for seg_url in segment_urls {
        if *cancel_rx.borrow() {
            return Err("CANCELLED".to_string());
        }

        // Retry up to 3 times per segment
        let mut seg_data = None;
        for _ in 0..3 {
            if let Ok(r) = client.get(&seg_url).send().await {
                if let Ok(b) = r.bytes().await {
                    seg_data = Some(b);
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        let bytes = seg_data.ok_or_else(|| format!("分片下载失败: {seg_url}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("写入分片失败: {e}"))?;

        downloaded_bytes += bytes.len() as u64;
        bytes_since_last += bytes.len() as u64;
        completed_segments += 1;

        if last_instant.elapsed() >= Duration::from_millis(400) {
            let elapsed_sec = last_instant.elapsed().as_secs_f64();
            let speed = (bytes_since_last as f64 / elapsed_sec) as u64;

            let mut tasks = manager.tasks.lock().await;
            if let Some(t) = tasks.iter_mut().find(|item| item.id == task.id) {
                t.downloaded_bytes = downloaded_bytes;
                t.progress = (completed_segments as f64 / total_segments as f64) * 100.0;
                t.speed_bytes_per_sec = speed;
            }
            drop(tasks);

            last_instant = Instant::now();
            bytes_since_last = 0;
        }
    }

    Ok(())
}

/// Resolve sub-stream URL from master playlist
fn resolve_m3u8_sub_stream(base_url: &str, content: &str) -> String {
    let mut lines = content.lines();
    while let Some(line) = lines.next() {
        if line.starts_with("#EXT-X-STREAM-INF") {
            if let Some(next_line) = lines.next() {
                let sub_uri = next_line.trim();
                if !sub_uri.is_empty() && !sub_uri.starts_with('#') {
                    return resolve_relative_url(base_url, sub_uri);
                }
            }
        }
    }
    base_url.to_string()
}

/// Parse trailing sequence number from segment URL (e.g. 68f0dd7fa94000073.ts -> 73)
fn extract_trailing_seq(uri: &str) -> Option<u64> {
    if let Some(pos) = uri.rfind(".ts") {
        let prefix = &uri[..pos];
        let mut digits = String::new();
        for c in prefix.chars().rev() {
            if c.is_ascii_digit() {
                digits.push(c);
            } else {
                break;
            }
        }
        if !digits.is_empty() {
            let rev: String = digits.chars().rev().collect();
            let slice = if rev.len() > 4 { &rev[rev.len() - 4..] } else { &rev };
            return slice.parse::<u64>().ok();
        }
    }
    None
}

/// Check if URI contains explicit blacklisted ad patterns
fn is_ad_uri(uri: &str) -> bool {
    let lower = uri.to_lowercase();
    let ad_patterns = [
        "/adjump/", "/ad/", "/ads/", "guanggao", "advert", "/ad_", "googleads",
        "doubleclick", "appad", "union",
    ];
    ad_patterns.iter().any(|&p| lower.contains(p))
}

/// Parse TS segment URLs from an M3U8 playlist with intelligent ad excision
pub fn parse_m3u8_segments(base_url: &str, content: &str) -> Vec<String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut blocks: Vec<Vec<String>> = Vec::new();
    let mut current_block: Vec<String> = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if line.is_empty() {
            i += 1;
            continue;
        }

        if line.starts_with("#EXT-X-DISCONTINUITY") {
            if !current_block.is_empty() {
                blocks.push(current_block);
                current_block = Vec::new();
            }
            i += 1;
            continue;
        }

        if line.starts_with("#EXTINF") {
            i += 1;
            while i < lines.len() && lines[i].trim().starts_with('#') && !lines[i].trim().starts_with("#EXTINF") {
                i += 1;
            }
            if i < lines.len() {
                let uri = lines[i].trim();
                if !uri.is_empty() && !uri.starts_with('#') {
                    current_block.push(uri.to_string());
                }
            }
            i += 1;
            continue;
        }

        i += 1;
    }

    if !current_block.is_empty() {
        blocks.push(current_block);
    }

    let mut keep_blocks = vec![true; blocks.len()];

    // 1. Blacklist check per block
    for (idx, b) in blocks.iter().enumerate() {
        if b.iter().any(|u| is_ad_uri(u)) {
            keep_blocks[idx] = false;
        }
    }

    // 2. Discontinuity Sandwich Anomaly Detection (e.g. 量子资源 casino ads)
    // If block k is sandwiched, and seq(k-1 end) + 1 == seq(k+1 start), block k is an ad insertion
    for k in 1..blocks.len().saturating_sub(1) {
        if !keep_blocks[k] {
            continue;
        }
        let prev_b = &blocks[k - 1];
        let next_b = &blocks[k + 1];
        if !prev_b.is_empty() && !next_b.is_empty() {
            let prev_seq = extract_trailing_seq(prev_b.last().unwrap());
            let next_seq = extract_trailing_seq(next_b.first().unwrap());
            if let (Some(p_seq), Some(n_seq)) = (prev_seq, next_seq) {
                if n_seq == p_seq + 1 || n_seq == p_seq {
                    // Block k is an injected ad sandwich!
                    keep_blocks[k] = false;
                }
            }
        }
    }

    let mut segments = Vec::new();
    for (idx, b) in blocks.into_iter().enumerate() {
        if keep_blocks[idx] {
            for uri in b {
                segments.push(resolve_relative_url(base_url, &uri));
            }
        }
    }

    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_m3u8_ads_user_snippet() {
        let m3u8_data = r#"#EXTINF:6.160,
68f0dd7fa94000048.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.600,
68f0dd7fa94000049.ts
#EXTINF:4.000,
68f0dd7fa94000073.ts
#EXT-X-DISCONTINUITY
#EXTINF:4.000,
68f0dd7fa940043699.ts
#EXTINF:4.000,
68f0dd7fa9400436100.ts
#EXTINF:1.760,
68f0dd7fa9400436105.ts
#EXT-X-DISCONTINUITY
#EXTINF:4.400,
68f0dd7fa94000074.ts"#;

        let segs = parse_m3u8_segments("https://cdn.com/mixed.m3u8", m3u8_data);
        assert!(!segs.iter().any(|s| s.contains("68f0dd7fa940043699")));
        assert!(!segs.iter().any(|s| s.contains("68f0dd7fa9400436105")));
        assert!(segs.iter().any(|s| s.contains("68f0dd7fa94000073")));
        assert!(segs.iter().any(|s| s.contains("68f0dd7fa94000074")));
    }
}
/// Resolve relative URI against base URL
fn resolve_relative_url(base_url: &str, uri: &str) -> String {
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return uri.to_string();
    }
    if let Ok(base) = reqwest::Url::parse(base_url) {
        if let Ok(joined) = base.join(uri) {
            return joined.to_string();
        }
    }
    if let Some(pos) = base_url.rfind('/') {
        return format!("{}/{}", &base_url[..pos], uri);
    }
    uri.to_string()
}
