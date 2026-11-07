//! The Electron app's version-1 Workspace catalogue (`workspaces.json`, see
//! `packages/contracts/src/contract.ts`): strict decoding and the validation every read and
//! write shares. Writing lives in `catalogue_write`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::de::Error as _;
use serde::{Deserialize, Deserializer};

use crate::date::TodoDate;
use crate::CoreError;

/// A Workspace's distinguishing color, as persisted in the catalogue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

// Decoded exactly as strictly as the Electron app's `catalogueSchema` (Effect Schema with
// excess-property rejection): every key required unless optional, no unknown keys, and optional
// preferences either absent or a valid value (never `null`).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCatalogue {
    version: serde_json::Value,
    #[serde(deserialize_with = "required_nullable")]
    active_workspace_id: Option<String>,
    workspaces: Vec<RawWorkspace>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawWorkspace {
    id: String,
    name: String,
    #[serde(deserialize_with = "color")]
    color: WorkspaceColor,
    todo_path: String,
    created_at: String,
    #[serde(default, deserialize_with = "sort_order")]
    sort_order: Option<TodoSortOrder>,
    #[serde(default, deserialize_with = "present")]
    show_deferred: Option<bool>,
}

/// A key that must be present but may be `null` (Effect `NullOr`). Without `deserialize_with`,
/// serde would read a missing `Option` key as `None`.
fn required_nullable<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::deserialize(d)
}

/// An optional key whose value, when present, must not be `null` (Effect `optional`).
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

/// A string literal (Effect `Literals`): only a JSON string, never serde's externally tagged
/// `{"blue": null}` enum form.
pub(crate) fn literal<'de, D: Deserializer<'de>, T>(
    d: D,
    parse: impl FnOnce(&str) -> Option<T>,
) -> Result<T, D::Error> {
    let value = String::deserialize(d)?;
    parse(&value).ok_or_else(|| D::Error::custom(format!("unsupported value {value:?}")))
}

fn color<'de, D: Deserializer<'de>>(d: D) -> Result<WorkspaceColor, D::Error> {
    literal(d, |s| {
        WorkspaceColor::ALL.into_iter().find(|c| c.as_str() == s)
    })
}

fn sort_order<'de, D: Deserializer<'de>>(d: D) -> Result<Option<TodoSortOrder>, D::Error> {
    literal(d, |s| match s {
        "file" => Some(TodoSortOrder::File),
        "due" => Some(TodoSortOrder::Due),
        _ => None,
    })
    .map(Some)
}

/// Loads the catalogue at `path`. An absent file is an empty catalogue, as in the
/// Electron app; any other read, decode, or validation failure is an error.
pub fn load_catalogue(path: &Path) -> Result<Catalogue, CoreError> {
    Ok(read_catalogue(path)?.unwrap_or_default())
}

/// Reads the catalogue at `path`; `None` when no file exists. Only startup restoration and the
/// first Workspace creation may treat that absence as an empty catalogue.
pub(crate) fn read_catalogue(path: &Path) -> Result<Option<Catalogue>, CoreError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
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
    parse_catalogue(path, &text).map(Some)
}

pub(crate) fn parse_catalogue(path: &Path, text: &str) -> Result<Catalogue, CoreError> {
    // Syntax errors first; anything well-formed but of the wrong shape is a validation failure.
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|source| CoreError::Json {
            path: path.to_path_buf(),
            source,
        })?;
    let invalid = |issue: String| CoreError::InvalidCatalogue {
        path: path.to_path_buf(),
        issues: vec![issue],
    };
    // serde would also decode structs from arrays; Effect `Struct` requires objects.
    let objects = value
        .as_object()
        .is_some_and(|root| match root.get("workspaces") {
            Some(serde_json::Value::Array(workspaces)) => workspaces.iter().all(|w| w.is_object()),
            _ => true,
        });
    if !objects {
        return Err(invalid(
            "the catalogue and each Workspace must be JSON objects".into(),
        ));
    }
    let raw = RawCatalogue::deserialize(value).map_err(|source| invalid(source.to_string()))?;
    // `Schema.Literal(1)` compares JavaScript numbers, so `1.0` is version 1 as well.
    if raw.version.as_f64() != Some(1.0) {
        return Err(CoreError::UnsupportedVersion {
            path: path.to_path_buf(),
            version: raw.version,
        });
    }
    let catalogue = Catalogue {
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
    };
    validate(&catalogue).map_err(|issues| CoreError::InvalidCatalogue {
        path: path.to_path_buf(),
        issues,
    })?;
    Ok(catalogue)
}

/// The Electron app's catalogue rules beyond its shape, checked on every read and before every
/// write: UUID ids, trimmed non-empty names, non-blank Todo paths, ISO `created_at` with a
/// timezone, unique ids, names (case-insensitively), and paths, and an existing Active workspace.
pub(crate) fn validate(catalogue: &Catalogue) -> Result<(), Vec<String>> {
    let mut issues = Vec::new();
    for w in &catalogue.workspaces {
        let label = &w.id;
        if !is_uuid(&w.id) {
            issues.push(format!("Workspace id {label} is not a UUID"));
        }
        if w.name.is_empty() || js_trim(&w.name) != w.name {
            issues.push(format!(
                "Workspace {label} name must be non-empty without surrounding whitespace"
            ));
        }
        match w.todo_file.to_str() {
            Some(path) if !js_trim(path).is_empty() => {}
            Some(_) => issues.push(format!("Workspace {label} has an empty todo_path")),
            None => issues.push(format!("Workspace {label} todo_path is not valid UTF-8")),
        }
        if !is_iso_datetime(&w.created_at) {
            issues.push(format!(
                "Workspace {label} created_at is not an ISO datetime"
            ));
        }
    }
    let duplicates = |key: fn(&Workspace) -> String| {
        let mut seen = HashSet::new();
        !catalogue.workspaces.iter().all(|w| seen.insert(key(w)))
    };
    if duplicates(|w| w.id.clone()) {
        issues.push("Duplicate Workspace id".into());
    }
    // JS `toLowerCase` and Rust `to_lowercase` both apply Unicode's full default case mapping.
    if duplicates(|w| w.name.to_lowercase()) {
        issues.push("Duplicate Workspace name".into());
    }
    if duplicates(|w| w.todo_file.to_string_lossy().into_owned()) {
        issues.push("Duplicate Workspace todo_path".into());
    }
    if let Some(active) = &catalogue.active_workspace_id {
        if !is_uuid(active) {
            issues.push("Active workspace id is not a UUID".into());
        }
        if catalogue.workspace(active).is_none() {
            issues.push("Active workspace is missing".into());
        }
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

/// JavaScript's `String.prototype.trim`. Its whitespace differs from Rust's: it includes
/// U+FEFF and excludes U+0085.
pub fn js_trim(value: &str) -> &str {
    let is_space = |c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}';
    value.trim_matches(is_space)
}

/// Effect's `isUUID()`: 8-4-4-4-12 hex digits in either case with version 1-8 and the RFC
/// variant, or the nil or max UUID.
pub(crate) fn is_uuid(value: &str) -> bool {
    let b = value.as_bytes();
    let shaped = b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        });
    shaped
        && (matches!(b[14], b'1'..=b'8')
            && matches!(b[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B')
            || value == "00000000-0000-0000-0000-000000000000"
            || value.eq_ignore_ascii_case("ffffffff-ffff-ffff-ffff-ffffffffffff"))
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
