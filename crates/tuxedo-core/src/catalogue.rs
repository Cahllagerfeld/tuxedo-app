//! Read-only decoding of the Electron app's version-1 Workspace catalogue
//! (`workspaces.json`, see `packages/contracts/src/contract.ts`). Never written here.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::date::TodoDate;
use crate::CoreError;

/// A Workspace's distinguishing color, as persisted in the catalogue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceColor {
    Blue,
    Green,
    Amber,
    Red,
    Violet,
    Pink,
    Cyan,
    Orange,
}

impl WorkspaceColor {
    pub const ALL: [Self; 8] = [
        Self::Blue,
        Self::Green,
        Self::Amber,
        Self::Red,
        Self::Violet,
        Self::Pink,
        Self::Cyan,
        Self::Orange,
    ];

    /// The persisted name, e.g. `"blue"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blue => "blue",
            Self::Green => "green",
            Self::Amber => "amber",
            Self::Red => "red",
            Self::Violet => "violet",
            Self::Pink => "pink",
            Self::Cyan => "cyan",
            Self::Orange => "orange",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// The persisted `todo_path`.
    pub todo_file: PathBuf,
    pub color: WorkspaceColor,
    pub created_at: String,
    pub sort_order: Option<TodoSortOrder>,
    pub show_deferred: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TodoSortOrder {
    File,
    Due,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Catalogue {
    pub workspaces: Vec<Workspace>,
    pub active_workspace_id: Option<String>,
}

impl Catalogue {
    pub fn workspace(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }

    pub fn active_workspace(&self) -> Option<&Workspace> {
        self.active_workspace_id
            .as_deref()
            .and_then(|id| self.workspace(id))
    }
}

#[derive(Deserialize)]
struct RawCatalogue {
    version: serde_json::Value,
    active_workspace_id: Option<String>,
    workspaces: Vec<RawWorkspace>,
}

#[derive(Deserialize)]
struct RawWorkspace {
    id: String,
    name: String,
    color: WorkspaceColor,
    todo_path: String,
    created_at: String,
    #[serde(default)]
    sort_order: Option<TodoSortOrder>,
    #[serde(default)]
    show_deferred: Option<bool>,
}

/// Loads the catalogue at `path`. An absent file is an empty catalogue, as in the
/// Electron app; any other read, decode, or validation failure is an error.
pub fn load_catalogue(path: &Path) -> Result<Catalogue, CoreError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Catalogue::default()),
        Err(source) => {
            return Err(CoreError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    };
    let text = String::from_utf8(bytes).map_err(|_| CoreError::InvalidUtf8 {
        path: path.to_path_buf(),
    })?;
    parse_catalogue(path, &text)
}

pub(crate) fn parse_catalogue(path: &Path, text: &str) -> Result<Catalogue, CoreError> {
    let raw: RawCatalogue = serde_json::from_str(text).map_err(|source| {
        // Well-formed JSON with the wrong shape is a validation failure, not a syntax error.
        if source.classify() == serde_json::error::Category::Data {
            CoreError::InvalidCatalogue {
                path: path.to_path_buf(),
                issues: vec![source.to_string()],
            }
        } else {
            CoreError::Json {
                path: path.to_path_buf(),
                source,
            }
        }
    })?;
    if raw.version != serde_json::json!(1) {
        return Err(CoreError::UnsupportedVersion {
            path: path.to_path_buf(),
            version: raw.version,
        });
    }
    let mut issues = Vec::new();
    for w in &raw.workspaces {
        let label = &w.id;
        if !is_uuid(&w.id) {
            issues.push(format!("Workspace id {label} is not a UUID"));
        }
        if w.name.is_empty() || w.name.trim() != w.name {
            issues.push(format!(
                "Workspace {label} name must be non-empty and trimmed"
            ));
        }
        if w.todo_path.trim().is_empty() {
            issues.push(format!("Workspace {label} has an empty todo_path"));
        }
        if !is_iso_datetime(&w.created_at) {
            issues.push(format!(
                "Workspace {label} created_at is not an ISO datetime"
            ));
        }
    }
    let duplicates = |key: fn(&RawWorkspace) -> String| {
        let mut seen = HashSet::new();
        !raw.workspaces.iter().all(|w| seen.insert(key(w)))
    };
    if duplicates(|w| w.id.clone()) {
        issues.push("Duplicate Workspace id".into());
    }
    // JS `toLowerCase` vs Rust `to_lowercase` differ only in rare special casings.
    if duplicates(|w| w.name.to_lowercase()) {
        issues.push("Duplicate Workspace name".into());
    }
    if duplicates(|w| w.todo_path.clone()) {
        issues.push("Duplicate Workspace todo_path".into());
    }
    if let Some(active) = &raw.active_workspace_id {
        if !is_uuid(active) {
            issues.push("Active workspace id is not a UUID".into());
        }
        if !raw.workspaces.iter().any(|w| &w.id == active) {
            issues.push("Active workspace is missing".into());
        }
    }
    if !issues.is_empty() {
        return Err(CoreError::InvalidCatalogue {
            path: path.to_path_buf(),
            issues,
        });
    }
    Ok(Catalogue {
        active_workspace_id: raw.active_workspace_id,
        workspaces: raw
            .workspaces
            .into_iter()
            .map(|w| Workspace {
                id: w.id,
                name: w.name,
                todo_file: PathBuf::from(w.todo_path),
                color: w.color,
                created_at: w.created_at,
                sort_order: w.sort_order,
                show_deferred: w.show_deferred,
            })
            .collect(),
    })
}

/// Effect's `isUUID`: 8-4-4-4-12 hex digits, any version, either case.
fn is_uuid(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// `YYYY-MM-DDTHH:MM:SS(.fff)?(Z|±HH:MM)` with a valid calendar date.
fn is_iso_datetime(value: &str) -> bool {
    // Every accepted character is ASCII; checking first keeps the byte slicing below safe.
    if !value.is_ascii() {
        return false;
    }
    let (Some(date), Some(rest)) = (value.get(..10), value.get(10..)) else {
        return false;
    };
    if TodoDate::parse(date).is_none() {
        return false;
    }
    let Some(rest) = rest.strip_prefix('T') else {
        return false;
    };
    let two = |s: &str, max: u32| {
        s.len() == 2 && s.bytes().all(|c| c.is_ascii_digit()) && s.parse::<u32>().unwrap() <= max
    };
    let time = |s: &str| {
        s.len() == 8
            && two(&s[0..2], 23)
            && &s[2..3] == ":"
            && two(&s[3..5], 59)
            && &s[5..6] == ":"
            && two(&s[6..8], 59)
    };
    if rest.len() < 8 || !time(&rest[..8]) {
        return false;
    }
    let mut rest = &rest[8..];
    if let Some(frac) = rest.strip_prefix('.') {
        let digits = frac.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return false;
        }
        rest = &frac[digits..];
    }
    rest == "Z"
        || (rest.len() == 6
            && matches!(&rest[..1], "+" | "-")
            && two(&rest[1..3], 23)
            && &rest[3..4] == ":"
            && two(&rest[4..6], 59))
}
