use crate::maccms::VodItem;
use std::collections::HashSet;

/// Normalize title for entity matching
pub fn normalize_for_match(s: &str) -> String {
    let mut clean = s.to_lowercase();
    let re_noise = regex::Regex::new(r#"[【】\[\]\(\)（）\s·\-_:：/]"#).unwrap();
    clean = re_noise.replace_all(&clean, "").to_string();

    let re_tags = regex::Regex::new(
        r"(?i)4k|1080p|720p|hd|bd|tc|ts|国语|粤语|中字|更新至?\d+集?|全\d+集|完结|抢先版?",
    )
    .unwrap();
    clean = re_tags.replace_all(&clean, "").to_string();

    clean = clean
        .replace("第1季", "第一季")
        .replace("第2季", "第二季")
        .replace("第3季", "第三季")
        .replace("第4季", "第四季")
        .replace("s1", "第一季")
        .replace("s2", "第二季")
        .replace("s3", "第三季");

    clean.trim().to_string()
}

/// Calculate Dice bigram similarity between two strings
pub fn dice_similarity(s1: &str, s2: &str) -> f64 {
    if s1 == s2 {
        return 1.0;
    }
    let chars1: Vec<char> = s1.chars().collect();
    let chars2: Vec<char> = s2.chars().collect();
    if chars1.len() < 2 || chars2.len() < 2 {
        return if s1 == s2 { 1.0 } else { 0.0 };
    }

    let mut bigrams1 = HashSet::new();
    for i in 0..chars1.len() - 1 {
        bigrams1.insert((chars1[i], chars1[i + 1]));
    }

    let mut bigrams2 = HashSet::new();
    for i in 0..chars2.len() - 1 {
        bigrams2.insert((chars2[i], chars2[i + 1]));
    }

    let intersection = bigrams1.intersection(&bigrams2).count();
    (2.0 * intersection as f64) / (bigrams1.len() + bigrams2.len()) as f64
}

/// Extract image filename stem for cover comparison
fn extract_image_stem(url: Option<&str>) -> Option<String> {
    url.and_then(|u| {
        let path = u.split('?').next().unwrap_or(u);
        let filename = path.split('/').last().unwrap_or("");
        let stem = filename.split('.').next().unwrap_or("");
        if stem.len() >= 8 {
            Some(stem.to_lowercase())
        } else {
            None
        }
    })
}

/// Multi-factor Entity Resolution: determines whether two items represent the same show
pub fn is_same_entity(a: &VodItem, b: &VodItem) -> bool {
    let norm_a = normalize_for_match(&a.vod_name);
    let norm_b = normalize_for_match(&b.vod_name);

    if norm_a.is_empty() || norm_b.is_empty() {
        return false;
    }

    let mut score = 0.0f64;

    // 1. Title Similarity (0.0 ~ 0.6)
    if norm_a == norm_b {
        score += 0.6;
    } else if norm_a.contains(&norm_b) || norm_b.contains(&norm_a) {
        score += 0.45;
    } else {
        let sim = dice_similarity(&norm_a, &norm_b);
        if sim >= 0.75 {
            score += sim * 0.55;
        }
    }

    // If title has no similarity at all, early return
    if score < 0.3 {
        return false;
    }

    // 2. Cover image filename hash (many sources mirror identical filenames like 'e0bcba17...jpg')
    let stem_a = extract_image_stem(a.vod_pic.as_deref());
    let stem_b = extract_image_stem(b.vod_pic.as_deref());
    if let (Some(sa), Some(sb)) = (stem_a, stem_b) {
        if sa == sb {
            score += 0.35;
        }
    }

    // 3. Year compatibility
    let year_a = a
        .vod_year
        .as_deref()
        .and_then(|y| y.trim().parse::<i32>().ok());
    let year_b = b
        .vod_year
        .as_deref()
        .and_then(|y| y.trim().parse::<i32>().ok());
    if let (Some(ya), Some(yb)) = (year_a, year_b) {
        if ya == yb {
            score += 0.15;
        } else if (ya - yb).abs() >= 2 {
            score -= 0.35; // Different release years by 2+ years is likely a remake or different work
        }
    }

    // 4. Actor overlap
    if let (Some(act_a), Some(act_b)) = (a.vod_actor.as_deref(), b.vod_actor.as_deref()) {
        let clean_act_a: HashSet<&str> = act_a
            .split([',', ' ', '/', '、'])
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        let clean_act_b: HashSet<&str> = act_b
            .split([',', ' ', '/', '、'])
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        let overlap = clean_act_a.intersection(&clean_act_b).count();
        if overlap >= 2 {
            score += 0.25;
        } else if overlap == 1 {
            score += 0.1;
        }
    }

    // 5. Director overlap
    if let (Some(dir_a), Some(dir_b)) = (a.vod_director.as_deref(), b.vod_director.as_deref()) {
        if !dir_a.trim().is_empty() && dir_a.trim() == dir_b.trim() {
            score += 0.15;
        }
    }

    score >= 0.55
}

/// Deduplicate and merge multiple items into unified show cards with combined play lines
pub fn deduplicate_and_merge_vods(items: Vec<VodItem>) -> Vec<VodItem> {
    let mut merged: Vec<VodItem> = Vec::new();

    for mut item in items {
        let src_name = item
            .source_name
            .clone()
            .unwrap_or_else(|| "默认源".to_string());

        // Tag play lines with current station name if not already tagged
        for line in &mut item.play_lines {
            if !line.title.contains(&src_name) {
                line.title = format!("{} · {}", src_name, line.title);
            }
        }

        // Initialize source_stations
        if item.source_stations.is_empty() {
            item.source_stations.push(src_name.clone());
        }

        // Check if item matches any existing item
        let matched_pos = merged
            .iter()
            .position(|existing| is_same_entity(existing, &item));

        if let Some(pos) = matched_pos {
            let existing = &mut merged[pos];

            // 1. Merge play lines
            for line in item.play_lines {
                if !existing.play_lines.iter().any(|l| l.title == line.title) {
                    existing.play_lines.push(line);
                }
            }

            // 2. Add source station
            if !existing.source_stations.contains(&src_name) {
                existing.source_stations.push(src_name);
            }

            // 3. Fallback poster & content
            if (existing.vod_pic.is_none() || existing.vod_pic.as_deref() == Some(""))
                && item.vod_pic.is_some()
            {
                existing.vod_pic = item.vod_pic;
            }
            if (existing.vod_content.is_none() || existing.vod_content.as_deref() == Some(""))
                && item.vod_content.is_some()
            {
                existing.vod_content = item.vod_content;
            }
            if existing.vod_remarks.is_none() && item.vod_remarks.is_some() {
                existing.vod_remarks = item.vod_remarks;
            }
        } else {
            merged.push(item);
        }
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_resolution_matching() {
        let mut item1 = VodItem::default();
        item1.vod_name = "喜剧之王·单口季".to_string();
        item1.vod_year = Some("2024".to_string());
        item1.vod_actor = Some("周星驰, 庞博, 罗永浩".to_string());
        item1.vod_pic = Some("https://pic.com/12345678_thumb.jpg".to_string());

        let mut item2 = VodItem::default();
        item2.vod_name = "喜剧之王单口季".to_string();
        item2.vod_year = Some("2024".to_string());
        item2.vod_actor = Some("庞博, 罗永浩, 蒋龙".to_string());
        item2.vod_pic = Some("https://othercdn.com/12345678_thumb.jpg".to_string());

        assert!(is_same_entity(&item1, &item2));

        let mut item3 = VodItem::default();
        item3.vod_name = "喜剧之王".to_string();
        item3.vod_year = Some("1999".to_string());
        item3.vod_actor = Some("周星驰, 莫文蔚".to_string());

        assert!(!is_same_entity(&item1, &item3));
    }
}
