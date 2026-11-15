use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoubanMetadata {
    pub id: String,
    pub canonical_title: String,
    pub original_title: Option<String>,
    pub rate: Option<String>,
    pub poster: Option<String>,
    pub year: Option<String>,
    pub episodes_count: Option<String>,
    pub directors: Vec<String>,
    pub actors: Vec<String>,
    pub is_tv: bool,
}

#[derive(Clone)]
pub struct DoubanClient {
    client: Client,
    cache: Arc<Mutex<HashMap<String, DoubanMetadata>>>,
}

impl DoubanClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        Self {
            client,
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Clean movie/TV title from noisy AppleCMS prefixes, tags, and resolutions
    pub fn normalize_title(raw: &str) -> String {
        let mut s = raw.trim().to_string();

        // 1. Remove bracketed noise: 【...】, [...], (...), （...）
        let bracket_pairs = [('【', '】'), ('[', ']'), ('(', ')'), ('（', '）')];
        for (open, close) in bracket_pairs {
            let open_len = open.len_utf8();
            let close_len = close.len_utf8();
            while let Some(start) = s.find(open) {
                let after_open = start + open_len;
                if let Some(close_offset) = s[after_open..].find(close) {
                    let inside = &s[after_open..after_open + close_offset];
                    let noise_tags = [
                        "4k", "1080p", "720p", "hd", "bd", "tc", "ts", "国语", "粤语",
                        "双字", "中字", "中英", "更新", "全集", "完结", "抢先", "未删减",
                        "无弹窗", "热播", "重温", "独播", "修复", "官方",
                    ];
                    let is_noise = noise_tags.iter().any(|&tag| inside.to_lowercase().contains(tag));
                    if is_noise || inside.len() > 15 {
                        let full_end = after_open + close_offset + close_len;
                        s.replace_range(start..full_end, "");
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        }

        // 2. Remove common trailing noise words
        let trailing_noise = [
            "4K", "1080P", "720P", "HD", "BD", "TC版", "抢先版", "抢先看",
            "国语版", "粤语版", "中字版", "高清版", "未删减版", "加长版",
        ];
        for noise in trailing_noise {
            if s.ends_with(noise) {
                s.truncate(s.len() - noise.len());
            }
        }

        // 3. Normalize season naming: "第1季" -> "第一季", "S1" -> "第一季"
        let season_replacements = [
            (" 第1季", " 第一季"),
            (" 第2季", " 第二季"),
            (" 第3季", " 第三季"),
            (" 第4季", " 第四季"),
            (" 第5季", " 第五季"),
            (" S1", " 第一季"),
            (" S2", " 第二季"),
            (" S3", " 第三季"),
            (" S4", " 第四季"),
            (" S5", " 第五季"),
            ("第1季", " 第一季"),
            ("第2季", " 第二季"),
            ("第3季", " 第三季"),
            ("第4季", " 第四季"),
            ("第5季", " 第五季"),
        ];

        for (from, to) in season_replacements {
            if s.contains(from) {
                s = s.replace(from, to);
            }
        }

        s.trim().to_string()
    }

    /// Query Douban for authoritative metadata and canonical naming
    pub async fn query_metadata(&self, raw_title: &str) -> Result<DoubanMetadata, String> {
        let clean_query = Self::normalize_title(raw_title);
        if clean_query.is_empty() {
            return Err("标题为空".to_string());
        }

        // Check cache first
        {
            let cache = self.cache.lock().map_err(|e| e.to_string())?;
            if let Some(cached) = cache.get(&clean_query) {
                return Ok(cached.clone());
            }
        }

        // 1. Query Douban subject_suggest
        let encoded_q = urlencoding_simple(&clean_query);
        let suggest_url = format!("https://movie.douban.com/j/subject_suggest?q={}", encoded_q);

        let resp = self
            .client
            .get(&suggest_url)
            .send()
            .await
            .map_err(|e| format!("请求豆瓣接口失败: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("豆瓣返回状态码: {}", resp.status()));
        }

        let json_arr: Vec<Value> = resp
            .json()
            .await
            .map_err(|e| format!("解析豆瓣数据失败: {e}"))?;

        if json_arr.is_empty() {
            return Err("未找到对应的豆瓣词条".to_string());
        }

        // Find the best match
        let best_item = &json_arr[0];
        let subject_id = best_item
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少豆瓣条目ID".to_string())?
            .to_string();

        let canonical_title = best_item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(&clean_query)
            .to_string();

        let poster = best_item
            .get("img")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let year = best_item
            .get("year")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // 2. Fetch subject_abstract for score, cast, episodes
        let abstract_url = format!(
            "https://movie.douban.com/j/subject_abstract?subject_id={}",
            subject_id
        );

        let mut rate = None;
        let mut episodes_count = None;
        let mut directors = Vec::new();
        let mut actors = Vec::new();
        let mut is_tv = false;

        if let Ok(abs_resp) = self.client.get(&abstract_url).send().await {
            if let Ok(abs_json) = abs_resp.json::<Value>().await {
                if let Some(sub) = abs_json.get("subject") {
                    rate = sub
                        .get("rate")
                        .and_then(|v| v.as_str())
                        .filter(|r| !r.is_empty())
                        .map(|s| s.to_string());

                    episodes_count = sub
                        .get("episodes_count")
                        .and_then(|v| v.as_str())
                        .filter(|e| !e.is_empty())
                        .map(|s| s.to_string());

                    is_tv = sub.get("is_tv").and_then(|v| v.as_bool()).unwrap_or(false);

                    if let Some(Value::Array(d_arr)) = sub.get("directors") {
                        for d in d_arr {
                            if let Some(name) = d.as_str() {
                                directors.push(name.to_string());
                            }
                        }
                    }

                    if let Some(Value::Array(a_arr)) = sub.get("actors") {
                        for a in a_arr {
                            if let Some(name) = a.as_str() {
                                actors.push(name.to_string());
                            }
                        }
                    }
                }
            }
        }

        let meta = DoubanMetadata {
            id: subject_id,
            canonical_title,
            original_title: Some(clean_query.clone()),
            rate,
            poster,
            year,
            episodes_count,
            directors,
            actors,
            is_tv,
        };

        // Cache result
        {
            let mut cache = self.cache.lock().map_err(|e| e.to_string())?;
            cache.insert(clean_query, meta.clone());
        }

        Ok(meta)
    }

const FAMOUS_ALIASES: &[(&str, &str)] = &[
    ("刺激1995", "肖申克的救赎"),
    ("肖申克的救赎", "刺激1995"),
    ("神隐少女", "千与千寻"),
    ("千与千寻", "神隐少女"),
    ("这个杀手不太冷", "终极追杀令"),
    ("终极追杀令", "这个杀手不太冷"),
    ("星际穿越", "星际效应"),
    ("星际效应", "星际穿越"),
    ("盗梦空间", "全面启动"),
    ("全面启动", "盗梦空间"),
    ("三个傻瓜", "三傻大闹宝莱坞"),
    ("三傻大闹宝莱坞", "三个傻瓜"),
    ("泰坦尼克号", "铁达尼号"),
    ("铁达尼号", "泰坦尼克号"),
    ("疯狂动物城", "优兽大都会"),
    ("优兽大都会", "疯狂动物城"),
    ("动物方城市", "疯狂动物城"),
    ("权游", "权力的游戏"),
    ("权力的游戏", "权游"),
    ("魔戒", "指环王"),
    ("指环王", "魔戒"),
];

    /// Expand search query into alias candidates and standard titles dynamically via Douban inverted search
    pub async fn expand_keywords(&self, raw_query: &str) -> Vec<String> {
        let clean = Self::normalize_title(raw_query);
        if clean.is_empty() {
            return Vec::new();
        }

        let mut results = Vec::new();
        results.push(clean.clone());
        for (from, to) in Self::FAMOUS_ALIASES {
            if clean == *from || clean.contains(from) {
                let target = to.to_string();
                if !results.contains(&target) {
                    results.push(target);
                }
            }
        }


        let encoded = urlencoding_simple(&clean);

        // 1. Dynamic Douban Web Search (Strictly target TOP MATCH of Result 1 ONLY)
        // Never take Result 2, 3, 4 as they are completely different movies!
        let search_url = format!("https://www.douban.com/search?cat=1002&q={}", encoded);
        if let Ok(resp) = self.client.get(&search_url).send().await {
            if let Ok(html) = resp.text().await {
                let re_first_block = regex::Regex::new(r#"<div class="result">([\s\S]*?)(?:<div class="result"|<!-- end result -->|</div>\s*</div>\s*</div>)"#).unwrap();
                if let Some(first_block) = re_first_block.captures(&html) {
                    let block_html = first_block.get(1).map(|m| m.as_str()).unwrap_or("");

                    // A. Extract Canonical Title of Result 1 ONLY
                    if let Ok(re) = regex::Regex::new(r#"<div class="title">[\s\S]*?<h3>[\s\S]*?<a[^>]*>(.*?)</a>"#) {
                        if let Some(cap) = re.captures(block_html) {
                            if let Some(m) = cap.get(1) {
                                let tag_clean = regex::Regex::new(r"<[^>]*>").unwrap();
                                let extracted = tag_clean.replace_all(m.as_str(), "").trim().to_string();
                                let unescaped = decode_html_entities(&extracted);
                                let norm_ext = Self::normalize_title(&unescaped);
                                if !norm_ext.is_empty() && !results.contains(&norm_ext) {
                                    results.push(norm_ext.clone());
                                }
                                if let Ok(season_re) = regex::Regex::new(r"第[一二三四五六七八九十0-9]+季") {
                                    let base = season_re.replace_all(&norm_ext, "").trim().to_string();
                                    if !base.is_empty() && !results.contains(&base) {
                                        results.push(base);
                                    }
                                }
                            }
                        }
                    }

                    // B. Extract original titles / foreign names from Result 1 ONLY
                    if let Ok(re_orig) = regex::Regex::new(r#"<span class="subject-cast">原名:(.*?)(?:\s*/|\s*<)"#) {
                        if let Some(cap) = re_orig.captures(block_html) {
                            if let Some(m) = cap.get(1) {
                                let orig_clean = decode_html_entities(m.as_str().trim());
                                if !orig_clean.is_empty() && !results.contains(&orig_clean) {
                                    results.push(orig_clean);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Query Douban subject_suggest for instant Chinese autocomplete (take top match only)
        let suggest_url = format!("https://movie.douban.com/j/subject_suggest?q={}", encoded);
        if let Ok(resp) = self.client.get(&suggest_url).send().await {
            if let Ok(json_arr) = resp.json::<Vec<Value>>().await {
                if let Some(item) = json_arr.first() {
                    if let Some(title) = item.get("title").and_then(|v| v.as_str()) {
                        let norm = Self::normalize_title(title);
                        if !norm.is_empty() && !results.contains(&norm) {
                            results.push(norm.clone());
                        }
                    }
                    if let Some(sub_title) = item.get("sub_title").and_then(|v| v.as_str()) {
                        let sub_norm = Self::normalize_title(sub_title);
                        if !sub_norm.is_empty() && !results.contains(&sub_norm) {
                            results.push(sub_norm);
                        }
                    }
                }
            }
        }
        results.truncate(5);
        results
    }
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_title_normalization() {
        assert_eq!(
            DoubanClient::normalize_title("【4K60帧】庆余年2 HD1080P"),
            "庆余年2"
        );
        assert_eq!(
            DoubanClient::normalize_title("庆余年第2季（全36集完结）"),
            "庆余年 第二季"
        );
        assert_eq!(
            DoubanClient::normalize_title("繁花[国语粤语双字]"),
            "繁花"
        );
        assert_eq!(
            DoubanClient::normalize_title("流浪地球2 抢先版"),
            "流浪地球2"
        );
    }

    #[tokio::test]
    async fn test_alias_expansion() {
        let client = DoubanClient::new();
        let aliases_shawshank = client.expand_keywords("刺激1995").await;
        assert!(aliases_shawshank.iter().any(|s| s.contains("肖申克的救赎")));

        let aliases_got = client.expand_keywords("权游").await;
        assert!(aliases_got.iter().any(|s| s.contains("权力的游戏")));

        let aliases_lotr = client.expand_keywords("魔戒").await;
        assert!(aliases_lotr.iter().any(|s| s.contains("指环王")));
    }
}
