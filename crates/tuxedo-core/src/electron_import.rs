//! The one-time import of the Electron app's data into the native app's own data folder.
//!
//! On a first launch, when the native folder has no `workspaces.json` and the Electron folder
//! has one, the Electron catalogue is copied after the same strict validation every catalogue
//! read applies, and the Electron saved views (version 1, structured filters) are converted into
//! version-2 Queries. Both files are written atomically into the native folder; the Electron
//! folder is only read. An invalid Electron catalogue writes nothing; Electron saved views that
//! cannot be decoded or converted are skipped with a warning and never block the import.

use std::path::Path;

use serde::Deserialize;

use crate::atomic_file::atomic_replace;
use crate::catalogue::{is_uuid, js_trim, parse_catalogue};
use crate::saved_views::{serialize_saved_views, validate_views};
use crate::todo::DueCategory;
use crate::todo_query::{is_js_whitespace, CompletionView};
use crate::{SavedView, TodoFilters, QUERY_GRAMMAR_VERSION, SAVED_VIEWS_FILE};

/// The catalogue file name, in both apps' data folders.
pub const CATALOGUE_FILE: &str = "workspaces.json";
/// Both files' permission bits, as the Electron app's `atomicWrite` default.
const MODE: u32 = 0o600;

/// What [`import_electron_data`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ElectronImport {
    /// The native folder already has a catalogue (or its presence cannot be ruled out), or the
    /// Electron folder has none: nothing was read or written.
    NotNeeded,
    /// The catalogue was copied into the native folder.
    Imported(ImportReport),
    /// Nothing usable was written; the native app starts without a catalogue.
    Refused(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportReport {
    pub workspaces: usize,
    pub saved_views: usize,
    /// Why the Electron saved views were not imported, when they were not.
    pub saved_views_warning: Option<String>,
}

/// Imports the Electron app's catalogue and saved views from `electron_dir` into `native_dir`
/// once (see the module docs). Blocking.
pub fn import_electron_data(native_dir: &Path, electron_dir: &Path) -> ElectronImport {
    let native_catalogue = native_dir.join(CATALOGUE_FILE);
    match std::fs::symlink_metadata(&native_catalogue) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        // Present, or unknown: restoration reads and reports it; never import over it.
        _ => return ElectronImport::NotNeeded,
    }
    let electron_catalogue = electron_dir.join(CATALOGUE_FILE);
    let text = match std::fs::read(&electron_catalogue) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return ElectronImport::NotNeeded,
        Err(e) => return refused(&electron_catalogue, e),
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => return refused(&electron_catalogue, "it is not valid UTF-8"),
        },
    };
    let catalogue = match parse_catalogue(&electron_catalogue, &text) {
        Ok(catalogue) => catalogue,
        Err(error) => return refused(&electron_catalogue, error),
    };

    // Saved views first: the catalogue marks the import as done, so a failure in between is
    // retried on the next launch, which then keeps the saved views written here.
    let (saved_views, saved_views_warning) = import_saved_views(native_dir, electron_dir);
    if let Err(error) = atomic_replace(&native_catalogue, text.as_bytes(), MODE) {
        return ElectronImport::Refused(format!(
            "Could not copy the Electron app's Workspaces into {}: {error}",
            native_dir.display()
        ));
    }
    ElectronImport::Imported(ImportReport {
        workspaces: catalogue.workspaces.len(),
        saved_views,
        saved_views_warning,
    })
}

fn refused(path: &Path, detail: impl std::fmt::Display) -> ElectronImport {
    ElectronImport::Refused(format!(
        "The Electron app's Workspaces at {} were not imported: {detail}. Nothing was changed.",
        path.display()
    ))
}

/// Converts and writes the Electron saved views; returns how many were imported and why they
/// were not, when they were not.
fn import_saved_views(native_dir: &Path, electron_dir: &Path) -> (usize, Option<String>) {
    let source = electron_dir.join(SAVED_VIEWS_FILE);
    let target = native_dir.join(SAVED_VIEWS_FILE);
    let skipped = |detail: String| {
        Some(format!(
            "The Electron app's saved views at {} were not imported: {detail}.",
            source.display()
        ))
    };
    let text = match std::fs::read(&source) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (0, None),
        Err(e) => return (0, skipped(e.to_string())),
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => return (0, skipped("it is not valid UTF-8".into())),
        },
    };
    let views = match convert_saved_views(&text) {
        Ok(views) => views,
        Err(detail) => return (0, skipped(detail)),
    };
    match std::fs::symlink_metadata(&target) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        _ => {
            return (
                0,
                skipped(format!("{} already exists and was kept", target.display())),
            )
        }
    }
    match atomic_replace(&target, serialize_saved_views(&views).as_bytes(), MODE) {
        Ok(()) => (views.len(), None),
        Err(error) => (0, skipped(error.to_string())),
    }
}

// The Electron app's `savedViewsFileSchema` (version 1), decoded as strictly.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct V1File {
    version: serde_json::Value,
    views: Vec<V1View>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct V1View {
    id: String,
    workspace_id: String,
    name: String,
    filters: V1Filters,
}

/// The Electron app's `SavedViewFilters`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct V1Filters {
    pub status: V1Status,
    pub search: String,
    #[serde(deserialize_with = "required_nullable")]
    pub project: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub context: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub priority: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub due: Option<V1Due>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum V1Status {
    All,
    Open,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum V1Due {
    Overdue,
    Today,
    Upcoming,
    None,
    Invalid,
}

/// A key that must be present but may be `null` (Effect `NullOr`).
fn required_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}

/// Decodes a version-1 saved-views file and converts every view, or says why it cannot.
fn convert_saved_views(text: &str) -> Result<Vec<SavedView>, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("not valid JSON ({e})"))?;
    // serde would also decode structs from arrays; Effect `Struct` requires objects.
    let objects = value
        .as_object()
        .is_some_and(|root| match root.get("views") {
            Some(serde_json::Value::Array(views)) => views
                .iter()
                .all(|v| v.is_object() && v.get("filters").is_none_or(|f| f.is_object())),
            _ => true,
        });
    if !objects {
        return Err("the file and each saved view must be JSON objects".into());
    }
    let file = V1File::deserialize(value).map_err(|e| e.to_string())?;
    if file.version.as_f64() != Some(1.0) {
        return Err(format!("unsupported version {}", file.version));
    }
    let views = file
        .views
        .into_iter()
        .map(|view| {
            if !is_uuid(&view.id) || !is_uuid(&view.workspace_id) {
                return Err(format!(
                    "saved view {} has an id that is not a UUID",
                    view.id
                ));
            }
            let query = v1_query(&view.filters)
                .map_err(|e| format!("saved view {} has invalid filters ({e})", view.id))?;
            Ok(SavedView {
                id: view.id,
                workspace_id: view.workspace_id,
                name: view.name,
                query,
                grammar_version: QUERY_GRAMMAR_VERSION,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    validate_views(&views)?;
    Ok(views)
}

/// The canonical Query for a version-1 view's filters. Filters that select everything become
/// `is:all`, since a saved view's Query cannot be empty.
pub(crate) fn v1_query(filters: &V1Filters) -> Result<String, String> {
    let tag = |sigil: char, value: &Option<String>| match value {
        Some(v) if v.is_empty() || js_trim(v) != v || v.chars().any(is_js_whitespace) => {
            Err(format!("{sigil}{v} is not a valid name"))
        }
        _ => Ok(value.clone().into_iter().collect::<Vec<_>>()),
    };
    let priority = match filters.priority.as_deref() {
        None => None,
        Some(p) => match p.as_bytes() {
            [letter] if letter.is_ascii_uppercase() => Some(*letter as char),
            _ => return Err(format!("priority {p:?} is not a letter A-Z")),
        },
    };
    let completion = match filters.status {
        V1Status::All => CompletionView::All,
        V1Status::Open => CompletionView::Open,
        V1Status::Completed => CompletionView::Completed,
    };
    let due = filters.due.map(|due| match due {
        V1Due::Overdue => DueCategory::Overdue,
        V1Due::Today => DueCategory::Today,
        V1Due::Upcoming => DueCategory::Upcoming,
        V1Due::None => DueCategory::None,
        V1Due::Invalid => DueCategory::Invalid,
    });
    let query = TodoFilters {
        completion,
        // The Electron app matched each whitespace-separated search term.
        search: filters
            .search
            .split(is_js_whitespace)
            .filter(|word| !word.is_empty())
            .map(str::to_owned)
            .collect(),
        projects: tag('+', &filters.project)?,
        contexts: tag('@', &filters.context)?,
        priority,
        due,
    }
    .to_query()
    .map_err(|e| e.to_string())?;
    Ok(if query.is_empty() {
        "is:all".to_owned()
    } else {
        query
    })
}
