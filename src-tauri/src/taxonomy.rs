use std::collections::{HashMap, HashSet, VecDeque};
use serde::{Deserialize, Serialize};
use crate::maccms::Category;

/// Standard Semantic Tag identifiers
pub const TAG_MOVIE: &str = "#movie";
pub const TAG_TV: &str = "#tv";
pub const TAG_VARIETY: &str = "#variety";
pub const TAG_ANIME: &str = "#anime";
pub const TAG_SHORT_DRAMA: &str = "#short_drama";
pub const TAG_DOCUMENTARY: &str = "#documentary";
pub const TAG_SPORTS: &str = "#sports";
pub const TAG_TRAILER: &str = "#trailer";
pub const TAG_18_PLUS: &str = "#18plus";

/// Local user category display configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCategory {
    pub id: String,
    pub name: String,
    pub bind_tags: Vec<String>,
}

/// Local user taxonomy and content safety configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTaxonomyConfig {
    #[serde(default)]
    pub adult_mode: bool,
    pub categories: Vec<LocalCategory>,
    #[serde(default)]
    pub blocked_tags: Vec<String>,
    #[serde(default)]
    pub blocked_type_ids: Vec<String>,
}

impl Default for UserTaxonomyConfig {
    fn default() -> Self {
        Self {
            adult_mode: false,
            categories: vec![
                LocalCategory {
                    id: "movie".to_string(),
                    name: "电影".to_string(),
                    bind_tags: vec![TAG_MOVIE.to_string()],
                },
                LocalCategory {
                    id: "tv".to_string(),
                    name: "电视剧".to_string(),
                    bind_tags: vec![TAG_TV.to_string()],
                },
                LocalCategory {
                    id: "anime".to_string(),
                    name: "动漫".to_string(),
                    bind_tags: vec![TAG_ANIME.to_string()],
                },
                LocalCategory {
                    id: "variety".to_string(),
                    name: "综艺".to_string(),
                    bind_tags: vec![TAG_VARIETY.to_string()],
                },
                LocalCategory {
                    id: "short_drama".to_string(),
                    name: "短剧".to_string(),
                    bind_tags: vec![TAG_SHORT_DRAMA.to_string()],
                },
                LocalCategory {
                    id: "commentary".to_string(),
                    name: "解说".to_string(),
                    bind_tags: vec!["#commentary".to_string()],
                },
                LocalCategory {
                    id: "trailer".to_string(),
                    name: "预告".to_string(),
                    bind_tags: vec![TAG_TRAILER.to_string()],
                },
                LocalCategory {
                    id: "sports".to_string(),
                    name: "体育赛事".to_string(),
                    bind_tags: vec![TAG_SPORTS.to_string()],
                },
                LocalCategory {
                    id: "others".to_string(),
                    name: "杂项".to_string(),
                    bind_tags: vec!["#others".to_string()],
                },
                LocalCategory {
                    id: "18plus".to_string(),
                    name: "18+".to_string(),
                    bind_tags: vec![TAG_18_PLUS.to_string()],
                },
            ],
            blocked_tags: vec![TAG_SPORTS.to_string(), TAG_TRAILER.to_string()],
            blocked_type_ids: Vec::new(),
        }
    }
}

/// Category Tree Graph representation
#[derive(Debug, Clone)]
pub struct CategoryTree {
    pub categories: HashMap<String, Category>,
    pub children_map: HashMap<String, Vec<String>>,
    pub parent_map: HashMap<String, String>,
}

impl CategoryTree {
    pub fn from_categories(cats: &[Category]) -> Self {
        let mut categories = HashMap::new();
        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
        let mut parent_map = HashMap::new();

        for cat in cats {
            categories.insert(cat.type_id.clone(), cat.clone());
            if let Some(pid) = &cat.type_pid {
                let p_trimmed = pid.trim();
                if !p_trimmed.is_empty() && p_trimmed != "0" && p_trimmed != &cat.type_id {
                    children_map
                        .entry(p_trimmed.to_string())
                        .or_default()
                        .push(cat.type_id.clone());
                    parent_map.insert(cat.type_id.clone(), p_trimmed.to_string());
                }
            }
        }

        Self {
            categories,
            children_map,
            parent_map,
        }
    }

    /// Resolve all descendant type_ids (including root IDs themselves) recursively
    /// Safe against cyclic loops
    pub fn resolve_cascade_descendants(&self, roots: &[String]) -> HashSet<String> {
        let mut result = HashSet::new();
        let mut queue = VecDeque::new();

        for root in roots {
            let r_trimmed = root.trim().to_string();
            if !r_trimmed.is_empty() && result.insert(r_trimmed.clone()) {
                queue.push_back(r_trimmed);
            }
        }

        while let Some(current_id) = queue.pop_front() {
            if let Some(children) = self.children_map.get(&current_id) {
                for child_id in children {
                    if result.insert(child_id.clone()) {
                        queue.push_back(child_id.clone());
                    }
                }
            }
        }

        result
    }

    /// Resolve ancestors chain from child up to root
    /// Safe against cyclic loops
    pub fn resolve_ancestors(&self, leaf_id: &str) -> Vec<String> {
        let mut ancestors = Vec::new();
        let mut current = leaf_id.to_string();
        let mut visited = HashSet::new();
        visited.insert(current.clone());

        while let Some(parent_id) = self.parent_map.get(&current) {
            if !visited.insert(parent_id.clone()) {
                // Cycle detected, stop traversal
                break;
            }
            ancestors.push(parent_id.clone());
            current = parent_id.clone();
        }

        ancestors
    }

    /// Resolve semantic tag with recursive tree inheritance:
    /// Check type_id -> parent_id -> grand_parent_id...
    pub fn resolve_semantic_tag(
        &self,
        type_id: &str,
        mapping: &HashMap<String, Vec<String>>,
    ) -> Option<String> {
        // 1. Direct match
        for (tag, ids) in mapping {
            if ids.iter().any(|id| id == type_id) {
                return Some(tag.clone());
            }
        }

        // 2. Inherit from ancestors
        let ancestors = self.resolve_ancestors(type_id);
        for anc in ancestors {
            for (tag, ids) in mapping {
                if ids.iter().any(|id| id == &anc) {
                    return Some(tag.clone());
                }
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tree_cascade_descendants_multilevel() {
        let cats = vec![
            Category {
                type_id: "22".to_string(),
                type_name: "伦理片".to_string(),
                type_pid: Some("0".to_string()),
            },
            Category {
                type_id: "100".to_string(),
                type_name: "韩国伦理".to_string(),
                type_pid: Some("22".to_string()),
            },
            Category {
                type_id: "101".to_string(),
                type_name: "高清韩伦".to_string(),
                type_pid: Some("100".to_string()),
            },
            Category {
                type_id: "1".to_string(),
                type_name: "电影".to_string(),
                type_pid: Some("0".to_string()),
            },
        ];

        let tree = CategoryTree::from_categories(&cats);
        let cascaded = tree.resolve_cascade_descendants(&["22".to_string()]);

        assert!(cascaded.contains("22"));
        assert!(cascaded.contains("100"));
        assert!(cascaded.contains("101"));
        assert!(!cascaded.contains("1"));
    }

    #[test]
    fn test_tree_cycle_protection() {
        // A -> B -> A cycle in malformed MacCMS data
        let cats = vec![
            Category {
                type_id: "A".to_string(),
                type_name: "Loop A".to_string(),
                type_pid: Some("B".to_string()),
            },
            Category {
                type_id: "B".to_string(),
                type_name: "Loop B".to_string(),
                type_pid: Some("A".to_string()),
            },
        ];

        let tree = CategoryTree::from_categories(&cats);
        let cascaded = tree.resolve_cascade_descendants(&["A".to_string()]);
        assert_eq!(cascaded.len(), 2);
        assert!(cascaded.contains("A"));
        assert!(cascaded.contains("B"));

        let ancestors = tree.resolve_ancestors("A");
        assert_eq!(ancestors, vec!["B".to_string()]);
    }

    #[test]
    fn test_semantic_tag_inheritance() {
        let cats = vec![
            Category {
                type_id: "1".to_string(),
                type_name: "电影".to_string(),
                type_pid: Some("0".to_string()),
            },
            Category {
                type_id: "6".to_string(),
                type_name: "动作片".to_string(),
                type_pid: Some("1".to_string()),
            },
            Category {
                type_id: "601".to_string(),
                type_name: "华语动作".to_string(),
                type_pid: Some("6".to_string()),
            },
        ];

        let tree = CategoryTree::from_categories(&cats);

        let mut mapping = HashMap::new();
        // Only root 1 is mapped to #movie
        mapping.insert("#movie".to_string(), vec!["1".to_string()]);

        // Direct root match
        assert_eq!(
            tree.resolve_semantic_tag("1", &mapping),
            Some("#movie".to_string())
        );
        // Child 6 inherits from parent 1
        assert_eq!(
            tree.resolve_semantic_tag("6", &mapping),
            Some("#movie".to_string())
        );
        // Grandchild 601 inherits from grandparent 1
        assert_eq!(
            tree.resolve_semantic_tag("601", &mapping),
            Some("#movie".to_string())
        );
    }
}
