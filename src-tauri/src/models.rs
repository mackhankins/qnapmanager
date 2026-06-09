use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Sonarr,
    Radarr,
}

/// Normalized item the frontend consumes. `added` is the raw ISO string from the
/// *arr API; age is computed in the UI, not here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LibraryItem {
    pub id: i64,
    pub title: String,
    pub service: Service,
    pub size_on_disk: i64,
    pub added: Option<String>,
    pub tags: Vec<i64>,
    pub tag_labels: Vec<String>,
}

/// Raw Sonarr series / Radarr movie share the fields we need.
#[derive(Debug, Deserialize)]
pub struct RawItem {
    pub id: i64,
    pub title: String,
    #[serde(default, rename = "sizeOnDisk")]
    pub size_on_disk: i64,
    #[serde(default)]
    pub added: Option<String>,
    #[serde(default)]
    pub tags: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct RawTag {
    pub id: i64,
    pub label: String,
}

pub const TEMPORARY_LABEL: &str = "temporary";

/// Resolve tag ids to labels using the service's tag list.
pub fn normalize(raw: RawItem, service: Service, tags: &[RawTag]) -> LibraryItem {
    let tag_labels = raw
        .tags
        .iter()
        .filter_map(|id| tags.iter().find(|t| t.id == *id).map(|t| t.label.clone()))
        .collect();
    LibraryItem {
        id: raw.id,
        title: raw.title,
        service,
        size_on_disk: raw.size_on_disk,
        added: raw.added,
        tags: raw.tags,
        tag_labels,
    }
}

/// True if any of the item's tag labels equals "temporary" (case-insensitive).
pub fn has_temporary(item: &LibraryItem) -> bool {
    item.tag_labels.iter().any(|l| l.eq_ignore_ascii_case(TEMPORARY_LABEL))
}

/// Compute the new tag-id set when toggling a tag on/off. Pure.
pub fn toggle_tag(current: &[i64], tag_id: i64) -> Vec<i64> {
    if current.contains(&tag_id) {
        current.iter().copied().filter(|id| *id != tag_id).collect()
    } else {
        let mut v = current.to_vec();
        v.push(tag_id);
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags() -> Vec<RawTag> {
        vec![
            RawTag { id: 1, label: "temporary".into() },
            RawTag { id: 2, label: "kids".into() },
        ]
    }

    #[test]
    fn normalize_resolves_labels_and_preserves_added() {
        let raw: RawItem = serde_json::from_str(
            r#"{"id":7,"title":"The Big Show","sizeOnDisk":88130000000,
                "added":"2025-01-02T00:00:00Z","tags":[1]}"#,
        )
        .unwrap();
        let item = normalize(raw, Service::Sonarr, &tags());
        assert_eq!(item.id, 7);
        assert_eq!(item.size_on_disk, 88130000000);
        assert_eq!(item.added.as_deref(), Some("2025-01-02T00:00:00Z"));
        assert_eq!(item.tag_labels, vec!["temporary".to_string()]);
        assert!(has_temporary(&item));
    }

    #[test]
    fn missing_size_defaults_to_zero() {
        let raw: RawItem = serde_json::from_str(r#"{"id":1,"title":"X","tags":[]}"#).unwrap();
        let item = normalize(raw, Service::Radarr, &tags());
        assert_eq!(item.size_on_disk, 0);
        assert!(!has_temporary(&item));
    }

    #[test]
    fn has_temporary_is_case_insensitive() {
        let item = LibraryItem {
            id: 1, title: "X".into(), service: Service::Radarr, size_on_disk: 0,
            added: None, tags: vec![9], tag_labels: vec!["Temporary".into()],
        };
        assert!(has_temporary(&item));
    }

    #[test]
    fn toggle_tag_adds_then_removes() {
        let on = toggle_tag(&[2], 1);
        assert_eq!(on, vec![2, 1]);
        let off = toggle_tag(&on, 1);
        assert_eq!(off, vec![2]);
    }
}
