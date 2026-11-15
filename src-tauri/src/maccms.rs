use quick_xml::events::Event;
use quick_xml::reader::Reader;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub name: String,
    pub api_url: String,
    #[serde(default = "default_api_type")]
    pub api_type: String, // "json", "xml", "auto"
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub group: Option<String>,
    #[serde(default)]
    pub adult_type_ids: Vec<String>,
    #[serde(default)]
    pub category_mapping: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub subscription_id: Option<String>,
}
impl Source {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        api_url: impl Into<String>,
        api_type: impl Into<String>,
        enabled: bool,
        group: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            api_url: api_url.into(),
            api_type: api_type.into(),
            enabled,
            group,
            adult_type_ids: Vec::new(),
            category_mapping: std::collections::HashMap::new(),
            subscription_id: None,
        }
    }
}

fn default_api_type() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub type_id: String,
    pub type_name: String,
    pub type_pid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayLine {
    pub from: String,
    pub title: String,
    pub episodes: Vec<Episode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VodItem {
    pub vod_id: String,
    pub vod_name: String,
    pub type_id: String,
    pub type_name: String,
    pub vod_en: Option<String>,
    pub vod_time: Option<String>,
    pub vod_remarks: Option<String>,
    pub vod_play_from: Option<String>,
    pub vod_play_url: Option<String>,
    pub vod_pic: Option<String>,
    pub vod_actor: Option<String>,
    pub vod_director: Option<String>,
    pub vod_content: Option<String>,
    pub vod_year: Option<String>,
    pub vod_area: Option<String>,
    pub vod_lang: Option<String>,
    pub vod_score: Option<String>,
    pub play_lines: Vec<PlayLine>,
    pub source_id: Option<String>,
    pub source_name: Option<String>,
    #[serde(default)]
    pub source_stations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodResponse {
    pub page: i64,
    pub pagecount: i64,
    pub limit: i64,
    pub total: i64,
    pub classes: Vec<Category>,
    pub list: Vec<VodItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub source_id: String,
    pub name: String,
    pub ok: bool,
    pub latency_ms: u64,
    pub categories_count: usize,
    pub sample_item_name: Option<String>,
    pub error: Option<String>,
}

pub fn get_default_sources() -> Vec<Source> {
    const DEFAULT_SOURCES_JSON: &str = include_str!("../default_sources.json");
    serde_json::from_str(DEFAULT_SOURCES_JSON).unwrap_or_default()
}

/// Helper function to convert raw value to String
fn val_to_str(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

/// Helper to convert raw value to i64
fn val_to_i64(v: Option<&Value>, def: i64) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(def),
        Some(Value::String(s)) => s.parse::<i64>().unwrap_or(def),
        _ => def,
    }
}

/// Map technical player line identifiers to readable Chinese names
fn friendly_line_name(from: &str) -> String {
    let lower = from.to_lowercase();
    if lower.contains("lz") || lower.contains("liangzi") {
        "量子线路".to_string()
    } else if lower.contains("ff") || lower.contains("feifan") {
        "非凡线路".to_string()
    } else if lower.contains("bf") || lower.contains("baofeng") {
        "暴风线路".to_string()
    } else if lower.contains("hn") || lower.contains("hongniu") {
        "红牛线路".to_string()
    } else if lower.contains("sn") || lower.contains("suoni") {
        "索尼线路".to_string()
    } else if lower.contains("tk") || lower.contains("tiankong") {
        "天空线路".to_string()
    } else if lower.contains("xl") || lower.contains("xinlang") {
        "新浪线路".to_string()
    } else if lower.contains("m3u8") {
        "极速专线".to_string()
    } else {
        format!("播放线路 ({})", from)
    }
}

pub const DEFAULT_AD_KEYWORDS: &[&str] = &[
    "澳门", "威尼斯人", "荷官", "发牌", "菠菜", "赌博", "彩票", "买球", "押注",
    "微信", "公众号", "TG@", "Telegram", "关注公众号", "防走失", "永久域名",
    "首发地址", "无弹窗", "全网首发", "广告合作", "招商", "招代理", "APP下载", "app下载",
    "加群", "QQ群", "福利", "看全集", "高清无删减", "破解", "注册送", "充值送",
];

/// Clean promotional ad watermarks and bracketed spam from episode names
pub fn clean_episode_name(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return "正片".to_string();
    }

    // If the name is essentially just an advertisement, flag it
    for kw in DEFAULT_AD_KEYWORDS {
        if s.contains(kw) && s.len() > 10 {
            let pairs = [('[', ']'), ('(', ')'), ('（', '）'), ('【', '】')];
            for (open, close) in pairs {
                let open_len = open.len_utf8();
                let close_len = close.len_utf8();
                if let Some(start) = s.find(open) {
                    let after_open = start + open_len;
                    if let Some(close_offset) = s[after_open..].find(close) {
                        let inside = &s[after_open..after_open + close_offset];
                        if inside.contains(kw) || inside.contains('.') {
                            let full_end = after_open + close_offset + close_len;
                            s.replace_range(start..full_end, "");
                        }
                    }
                }
            }
        }
    }

    let trimmed = s.trim().to_string();
    if trimmed.is_empty() {
        "正片".to_string()
    } else {
        trimmed
    }
}

/// Detect if an episode entry is pure advertisement spam and should be skipped
pub fn is_ad_episode(name: &str, url: &str) -> bool {
    let lower_url = url.to_lowercase();
    if !lower_url.starts_with("http://") && !lower_url.starts_with("https://") {
        return true;
    }
    // If name contains extreme spam keywords like "福利", "注册送", "招商", "关注微信"
    let spam_markers = ["福利", "注册送", "招商", "关注", "防走失", "域名", "TG频道", "客服"];
    for marker in spam_markers {
        if name.contains(marker) {
            return true;
        }
    }
    false
}

/// Clean HTML and promotional spam from synopsis / descriptions
pub fn clean_ad_content(text: &str) -> String {
    let mut cleaned = text.to_string();
    // Remove HTML tags
    while let Some(start) = cleaned.find('<') {
        if let Some(end) = cleaned[start..].find('>') {
            cleaned.replace_range(start..=start + end, "");
        } else {
            break;
        }
    }

    // Filter out ad lines
    let lines: Vec<&str> = cleaned
        .lines()
        .map(|l| l.trim())
        .filter(|l| {
            if l.is_empty() {
                return false;
            }
            for kw in DEFAULT_AD_KEYWORDS {
                if l.contains(kw) && (l.len() < 50 || l.contains("http://") || l.contains("https://")) {
                    return false;
                }
            }
            true
        })
        .collect();

    lines.join("\n")
}

/// Parse AppleCMS `vod_play_from` and `vod_play_url` into PlayLines
pub fn parse_play_lines(play_from: &str, play_url: &str) -> Vec<PlayLine> {
    let mut lines = Vec::new();
    let from_list: Vec<&str> = play_from.split("$$$").map(|s| s.trim()).collect();
    let url_list: Vec<&str> = play_url.split("$$$").map(|s| s.trim()).collect();

    for (idx, line_urls) in url_list.into_iter().enumerate() {
        if line_urls.is_empty() {
            continue;
        }

        let from_raw = from_list.get(idx).copied().unwrap_or("默认");
        let title = friendly_line_name(from_raw);

        // Episodes are split by '#' or newlines
        let episode_tokens: Vec<&str> = line_urls
            .split(['#', '\n', '\r'])
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        let mut episodes = Vec::new();
        for (ep_idx, token) in episode_tokens.into_iter().enumerate() {
            if let Some(pos) = token.find('$') {
                let raw_name = token[..pos].trim();
                let url = token[pos + 1..].trim();
                let clean_name = clean_episode_name(raw_name);
                if !url.is_empty() && !is_ad_episode(&clean_name, url) {
                    episodes.push(Episode {
                        name: if clean_name.is_empty() {
                            format!("第{:02}集", ep_idx + 1)
                        } else {
                            clean_name
                        },
                        url: url.to_string(),
                    });
                }
            } else if token.starts_with("http://") || token.starts_with("https://") {
                let name = format!("第{:02}集", ep_idx + 1);
                if !is_ad_episode(&name, token) {
                    episodes.push(Episode {
                        name,
                        url: token.to_string(),
                    });
                }
            }
        }

        if !episodes.is_empty() {
            lines.push(PlayLine {
                from: from_raw.to_string(),
                title,
                episodes,
            });
        }
    }

    lines
}

#[derive(Clone)]
pub struct MacCmsClient {
    client: Client,
    classes_cache: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, Vec<Category>>>>,
}

impl MacCmsClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(10))
            .gzip(true)
            .deflate(true)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();
        Self {
            client,
            classes_cache: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        }
    }

    pub async fn fetch_classes(&self, source: &Source) -> Vec<Category> {
        if let Ok(cache) = self.classes_cache.lock() {
            if let Some(cats) = cache.get(&source.id) {
                if !cats.is_empty() {
                    return cats.clone();
                }
            }
        }

        let url = Self::build_url(&source.api_url, &[("ac", "list")]);
        if let Ok(resp) = self.client.get(&url).send().await {
            if let Ok(raw) = resp.text().await {
                let trimmed = raw.trim();
                let parsed = if source.api_type == "xml"
                    || (source.api_type == "auto"
                        && (trimmed.starts_with("<?xml") || trimmed.starts_with("<rss")))
                {
                    parse_xml_response(trimmed, source).ok()
                } else {
                    parse_json_response(trimmed, source).ok()
                };
                if let Some(data) = parsed {
                    if !data.classes.is_empty() {
                        if let Ok(mut cache) = self.classes_cache.lock() {
                            cache.insert(source.id.clone(), data.classes.clone());
                        }
                        return data.classes;
                    }
                }
            }
        }

        Vec::new()
    }

    /// Build query URL properly handling existing query params
    pub fn build_url(base_url: &str, params: &[(&str, &str)]) -> String {
        let mut url = base_url.trim().to_string();
        let has_query = url.contains('?');
        let mut first = !has_query;

        for (k, v) in params {
            if v.is_empty() {
                continue;
            }
            if first {
                url.push('?');
                first = false;
            } else {
                url.push('&');
            }
            url.push_str(k);
            url.push('=');
            url.push_str(&urlencoding_simple(v));
        }

        url
    }

    /// Fetch video list or detail
    pub async fn fetch_vod(
        &self,
        source: &Source,
        type_id: Option<&str>,
        page: Option<i64>,
        keyword: Option<&str>,
        ids: Option<&str>,
        hours: Option<i64>,
    ) -> Result<VodResponse, String> {
        let mut params = Vec::new();
        // Use 'videolist' or 'detail' to get comprehensive episode/play URLs
        params.push(("ac", "videolist"));

        let page_str = page.map(|p| p.to_string());
        if let Some(p) = &page_str {
            params.push(("pg", p.as_str()));
        }

        if let Some(t) = type_id {
            if !t.is_empty() && t != "0" {
                params.push(("t", t));
            }
        }

        if let Some(kw) = keyword {
            if !kw.trim().is_empty() {
                params.push(("wd", kw.trim()));
            }
        }

        if let Some(id_list) = ids {
            if !id_list.trim().is_empty() {
                params.push(("ids", id_list.trim()));
            }
        }

        let hours_str = hours.map(|h| h.to_string());
        if let Some(h) = &hours_str {
            params.push(("h", h.as_str()));
        }

        let final_url = Self::build_url(&source.api_url, &params);
        let resp = self
            .client
            .get(&final_url)
            .send()
            .await
            .map_err(|e| format!("请求采集接口失败: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("接口返回非200状态码: {}", resp.status()));
        }

        let text = resp
            .text()
            .await
            .map_err(|e| format!("读取接口响应内容失败: {e}"))?;

        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err("接口返回内容为空".to_string());
        }

        // Detect whether it is XML or JSON
        let is_xml = source.api_type == "xml"
            || (source.api_type == "auto"
                && (trimmed.starts_with("<?xml") || trimmed.starts_with("<rss")));

        let mut vod_resp = if is_xml {
            parse_xml_response(trimmed, source)?
        } else {
            match parse_json_response(trimmed, source) {
                Ok(res) => res,
                Err(e) => {
                    if trimmed.contains("<rss") || trimmed.contains("<?xml") {
                        parse_xml_response(trimmed, source)?
                    } else {
                        return Err(e);
                    }
                }
            }
        };

        if vod_resp.classes.is_empty() {
            let cats = self.fetch_classes(source).await;
            if !cats.is_empty() {
                vod_resp.classes = cats;
            }
        }

        Ok(vod_resp)
    }

    /// Test a source: measure ping latency, verify category list and at least one item
    pub async fn test_source(&self, source: &Source) -> TestResult {
        let start = Instant::now();
        let fast_client = Client::builder()
            .timeout(Duration::from_secs(4))
            .connect_timeout(Duration::from_secs(3))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_else(|_| self.client.clone());

        // Request lightweight brief list to ping fast without heavy DB joins
        let params = vec![("ac", "list"), ("pg", "1")];
        let url = Self::build_url(&source.api_url, &params);

        let resp_result = fast_client.get(&url).send().await;
        let latency_ms = start.elapsed().as_millis() as u64;
        match resp_result {
            Ok(resp) => {
                if !resp.status().is_success() {
                    return TestResult {
                        source_id: source.id.clone(),
                        name: source.name.clone(),
                        ok: false,
                        latency_ms,
                        categories_count: 0,
                        sample_item_name: None,
                        error: Some(format!("HTTP {}", resp.status())),
                    };
                }

                match resp.text().await {
                    Ok(text) => {
                        let trimmed = text.trim();
                        let is_xml = source.api_type == "xml"
                            || (source.api_type == "auto"
                                && (trimmed.starts_with("<?xml") || trimmed.starts_with("<rss")));

                        let parsed = if is_xml {
                            parse_xml_response(trimmed, source)
                        } else {
                            parse_json_response(trimmed, source)
                        };

                        match parsed {
                            Ok(data) => TestResult {
                                source_id: source.id.clone(),
                                name: source.name.clone(),
                                ok: true,
                                latency_ms,
                                categories_count: data.classes.len(),
                                sample_item_name: data.list.first().map(|v| v.vod_name.clone()),
                                error: None,
                            },
                            Err(e) => TestResult {
                                source_id: source.id.clone(),
                                name: source.name.clone(),
                                ok: false,
                                latency_ms,
                                categories_count: 0,
                                sample_item_name: None,
                                error: Some(format!("解析数据失败: {e}")),
                            },
                        }
                    }
                    Err(e) => TestResult {
                        source_id: source.id.clone(),
                        name: source.name.clone(),
                        ok: false,
                        latency_ms,
                        categories_count: 0,
                        sample_item_name: None,
                        error: Some(format!("读取响应失败: {e}")),
                    },
                }
            }
            Err(e) => TestResult {
                source_id: source.id.clone(),
                name: source.name.clone(),
                ok: false,
                latency_ms,
                categories_count: 0,
                sample_item_name: None,
                error: Some(format!("连接失败: {e}")),
            },
        }
    }
}

/// Simple URL encode for query params
fn urlencoding_simple(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// Parse AppleCMS standard MacCMS v10 JSON format
pub fn parse_json_response(json_str: &str, source: &Source) -> Result<VodResponse, String> {
    let root: Value =
        serde_json::from_str(json_str).map_err(|e| format!("JSON解析语法错误: {e}"))?;

    let page = val_to_i64(root.get("page"), 1);
    let pagecount = val_to_i64(root.get("pagecount"), 1);
    let limit = val_to_i64(root.get("limit"), 20);
    let total = val_to_i64(root.get("total"), 0);

    let mut classes = Vec::new();
    if let Some(Value::Array(arr)) = root.get("class") {
        for c in arr {
            let type_id = val_to_str(c.get("type_id"));
            let type_name = val_to_str(c.get("type_name"));
            let type_pid = c.get("type_pid").map(|p| val_to_str(Some(p)));
            if !type_id.is_empty() && !type_name.is_empty() {
                classes.push(Category {
                    type_id,
                    type_name,
                    type_pid,
                });
            }
        }
    }

    let mut list = Vec::new();
    if let Some(Value::Array(arr)) = root.get("list") {
        for item in arr {
            let vod_id = val_to_str(item.get("vod_id"));
            let vod_name = val_to_str(item.get("vod_name"));
            if vod_id.is_empty() || vod_name.is_empty() {
                continue;
            }

            let type_id = val_to_str(item.get("type_id"));
            let type_name = val_to_str(item.get("type_name"));
            let vod_en = Some(val_to_str(item.get("vod_en"))).filter(|s| !s.is_empty());
            let vod_time = Some(val_to_str(item.get("vod_time"))).filter(|s| !s.is_empty());
            let vod_remarks = Some(val_to_str(item.get("vod_remarks"))).filter(|s| !s.is_empty());
            let vod_play_from = Some(val_to_str(item.get("vod_play_from")));
            let vod_play_url = Some(val_to_str(item.get("vod_play_url")));
            let vod_pic = Some(val_to_str(item.get("vod_pic"))).filter(|s| !s.is_empty());
            let vod_actor = Some(val_to_str(item.get("vod_actor"))).filter(|s| !s.is_empty());
            let vod_director =
                Some(val_to_str(item.get("vod_director"))).filter(|s| !s.is_empty());
            let vod_content = Some(val_to_str(item.get("vod_content")))
                .filter(|s| !s.is_empty())
                .map(|s| clean_ad_content(&s));
            let vod_year = Some(val_to_str(item.get("vod_year"))).filter(|s| !s.is_empty());
            let vod_area = Some(val_to_str(item.get("vod_area"))).filter(|s| !s.is_empty());
            let vod_lang = Some(val_to_str(item.get("vod_lang"))).filter(|s| !s.is_empty());
            let vod_score = Some(val_to_str(item.get("vod_score"))).filter(|s| !s.is_empty());

            let play_lines = parse_play_lines(
                vod_play_from.as_deref().unwrap_or(""),
                vod_play_url.as_deref().unwrap_or(""),
            );

            list.push(VodItem {
                vod_id,
                vod_name,
                type_id,
                type_name,
                vod_en,
                vod_time,
                vod_remarks,
                vod_play_from,
                vod_play_url,
                vod_pic,
                vod_actor,
                vod_director,
                vod_content,
                vod_year,
                vod_area,
                vod_lang,
                vod_score,
                play_lines,
                source_id: Some(source.id.clone()),
                source_name: Some(source.name.clone()),
                source_stations: vec![source.name.clone()],
            });
        }
    }

    Ok(VodResponse {
        page,
        pagecount,
        limit,
        total,
        classes,
        list,
    })
}

/// Parse AppleCMS XML format (<rss version="5.1">...)
pub fn parse_xml_response(xml_str: &str, source: &Source) -> Result<VodResponse, String> {
    let mut reader = Reader::from_str(xml_str);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut classes = Vec::new();
    let mut list = Vec::new();

    let mut page = 1;
    let mut pagecount = 1;
    let mut limit = 20;
    let mut total = 0;

    let mut current_tag = String::new();
    let mut in_class = false;
    let mut in_video = false;
    let mut current_video = VodItem::default();
    let mut current_dd_flag = String::new();
    let mut dd_flags = Vec::new();
    let mut dd_urls = Vec::new();
    let mut current_ty_id = String::new();

    loop {
        match &reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                current_tag = name.clone();

                match name.as_str() {
                    "class" => in_class = true,
                    "video" => {
                        in_video = true;
                        current_video = VodItem::default();
                        dd_flags.clear();
                        dd_urls.clear();
                    }
                    "ty" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"id" {
                                current_ty_id =
                                    String::from_utf8_lossy(&attr.value).trim().to_string();
                            }
                        }
                    }
                    "dd" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"flag" {
                                current_dd_flag =
                                    String::from_utf8_lossy(&attr.value).trim().to_string();
                            }
                        }
                    }
                    "list" => {
                        for attr in e.attributes().flatten() {
                            let k = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                            let v = String::from_utf8_lossy(&attr.value).trim().to_string();
                            match k.as_str() {
                                "page" => page = v.parse().unwrap_or(1),
                                "pagecount" => pagecount = v.parse().unwrap_or(1),
                                "pagesize" => limit = v.parse().unwrap_or(20),
                                "recordcount" => total = v.parse().unwrap_or(0),
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "class" => in_class = false,
                    "video" => {
                        in_video = false;
                        if !current_video.vod_id.is_empty() && !current_video.vod_name.is_empty() {
                            let play_from = dd_flags.join("$$$");
                            let play_url = dd_urls.join("$$$");
                            current_video.vod_play_from = Some(play_from.clone());
                            current_video.vod_play_url = Some(play_url.clone());
                            current_video.play_lines = parse_play_lines(&play_from, &play_url);
                            current_video.source_id = Some(source.id.clone());
                            current_video.source_name = Some(source.name.clone());
                            current_video.source_stations = vec![source.name.clone()];
                            list.push(current_video.clone());
                        }
                    }
                    _ => {}
                }
                current_tag.clear();
            }
            Ok(Event::CData(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).trim().to_string();
                if in_video {
                    apply_video_field(&current_tag, &text, &mut current_video, &mut dd_urls, &mut dd_flags, &current_dd_flag);
                }
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).trim().to_string();
                if in_class && current_tag == "ty" && !current_ty_id.is_empty() {
                    classes.push(Category {
                        type_id: current_ty_id.clone(),
                        type_name: text.clone(),
                        type_pid: None,
                    });
                } else if in_video {
                    apply_video_field(&current_tag, &text, &mut current_video, &mut dd_urls, &mut dd_flags, &current_dd_flag);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML解析错误: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(VodResponse {
        page,
        pagecount,
        limit,
        total,
        classes,
        list,
    })
}

fn apply_video_field(
    tag: &str,
    text: &str,
    item: &mut VodItem,
    dd_urls: &mut Vec<String>,
    dd_flags: &mut Vec<String>,
    current_dd_flag: &str,
) {
    match tag {
        "id" => item.vod_id = text.to_string(),
        "name" => item.vod_name = text.to_string(),
        "tid" => item.type_id = text.to_string(),
        "type" => item.type_name = text.to_string(),
        "pic" => item.vod_pic = Some(text.to_string()),
        "lang" => item.vod_lang = Some(text.to_string()),
        "area" => item.vod_area = Some(text.to_string()),
        "year" => item.vod_year = Some(text.to_string()),
        "state" | "note" => item.vod_remarks = Some(text.to_string()),
        "actor" => item.vod_actor = Some(text.to_string()),
        "director" => item.vod_director = Some(text.to_string()),
        "des" => item.vod_content = Some(clean_ad_content(text)),
        "last" => item.vod_time = Some(text.to_string()),
        "dd" => {
            dd_flags.push(if current_dd_flag.is_empty() {
                "默认".to_string()
            } else {
                current_dd_flag.to_string()
            });
            dd_urls.push(text.to_string());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_default_sources_loads_6_active_sources() {
        let sources = get_default_sources();
        assert_eq!(sources.len(), 6);
        for s in &sources {
            assert!(!s.category_mapping.is_empty(), "category_mapping should not be empty for {}", s.name);
            assert!(s.category_mapping.contains_key("#movie"), "should map #movie for {}", s.name);
            assert!(s.category_mapping.contains_key("#tv"), "should map #tv for {}", s.name);
        }
    }

    #[test]
    fn test_parse_play_lines_standard() {
        let play_from = "lzm3u8$$$ffm3u8";
        let play_url = "第01集$https://cdn.example.com/lz/1.m3u8#第02集$https://cdn.example.com/lz/2.m3u8$$$正片$https://cdn.example.com/ff/movie.mp4";
        let lines = parse_play_lines(play_from, play_url);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].from, "lzm3u8");
        assert_eq!(lines[0].title, "量子线路");
        assert_eq!(lines[0].episodes.len(), 2);
        assert_eq!(lines[0].episodes[0].name, "第01集");
        assert_eq!(lines[0].episodes[0].url, "https://cdn.example.com/lz/1.m3u8");

        assert_eq!(lines[1].from, "ffm3u8");
        assert_eq!(lines[1].title, "非凡线路");
        assert_eq!(lines[1].episodes.len(), 1);
        assert_eq!(lines[1].episodes[0].name, "正片");
        assert_eq!(lines[1].episodes[0].url, "https://cdn.example.com/ff/movie.mp4");
    }

    #[test]
    fn test_parse_play_lines_without_dollar() {
        let play_from = "default";
        let play_url = "https://cdn.example.com/stream.m3u8";
        let lines = parse_play_lines(play_from, play_url);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].episodes.len(), 1);
        assert_eq!(lines[0].episodes[0].name, "第01集");
        assert_eq!(lines[0].episodes[0].url, "https://cdn.example.com/stream.m3u8");
    }

    #[test]
    fn test_parse_maccms_json() {
        let json = r#"{
            "code": 1,
            "msg": "数据列表",
            "page": 1,
            "pagecount": 5,
            "limit": 20,
            "total": 100,
            "class": [
                { "type_id": 1, "type_name": "电影" },
                { "type_id": 2, "type_name": "电视剧" }
            ],
            "list": [
                {
                    "vod_id": 1001,
                    "vod_name": "测试电影",
                    "type_id": 1,
                    "type_name": "动作片",
                    "vod_remarks": "HD中字",
                    "vod_year": "2024",
                    "vod_play_from": "lzm3u8",
                    "vod_play_url": "HD$https://test.com/1.m3u8"
                }
            ]
        }"#;
        let dummy_src = Source::new("test", "测试源", "https://test.com/api", "json", true, None);
        let resp = parse_json_response(json, &dummy_src).unwrap();
        assert_eq!(resp.page, 1);
        assert_eq!(resp.total, 100);
        assert_eq!(resp.classes.len(), 2);
        assert_eq!(resp.list.len(), 1);
        assert_eq!(resp.list[0].vod_name, "测试电影");
        assert_eq!(resp.list[0].play_lines.len(), 1);
    }

    #[test]
    fn test_parse_maccms_xml() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <rss version="5.1">
            <class>
                <ty id="1">电影</ty>
                <ty id="2">连续剧</ty>
            </class>
            <list page="1" pagecount="10" pagesize="20" recordcount="200">
                <video>
                    <last>2024-05-01 10:00:00</last>
                    <id>999</id>
                    <tid>2</tid>
                    <name><![CDATA[庆余年第二季]]></name>
                    <type>国产剧</type>
                    <dl>
                        <dd flag="lzm3u8"><![CDATA[第01集$https://test.com/1.m3u8#第02集$https://test.com/2.m3u8]]></dd>
                    </dl>
                </video>
            </list>
        </rss>"#;
        let dummy_src = Source::new("test", "测试源", "https://test.com/api", "xml", true, None);
        let resp = parse_xml_response(xml, &dummy_src).unwrap();
        assert_eq!(resp.page, 1);
        assert_eq!(resp.total, 200);
        assert_eq!(resp.classes.len(), 2);
        assert_eq!(resp.list.len(), 1);
        assert_eq!(resp.list[0].vod_name, "庆余年第二季");
        assert_eq!(resp.list[0].play_lines.len(), 1);
        assert_eq!(resp.list[0].play_lines[0].episodes.len(), 2);
    }

    #[tokio::test]
    async fn test_live_source_fetch() {
        let client = MacCmsClient::new();
        let src = Source::new("bfzy", "暴风资源", "https://bfzyapi.com/api.php/provide/vod/", "auto", true, None);
        let res = client.fetch_vod(&src, None, Some(1), None, None, None).await;
        if let Ok(data) = res {
            assert!(!data.list.is_empty(), "list should not be empty");
            println!("Live fetch successfully fetched {} items, total: {}", data.list.len(), data.total);
        } else {
            println!("Live source fetch skipped due to network");
        }
    }
}
