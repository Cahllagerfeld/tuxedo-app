//! The one-time import of the Electron app's data into the native app's own data folder.
//!
//! On a first launch, when the native folder has no `workspaces.json` and the Electron folder
//! has one, the Electron catalogue is copied after the same strict validation every catalogue
//! read applies, and the Electron saved views (version 1, structured filters) are converted into
//! version-2 Queries. Both files are written atomically into the native folder; the Electron
//! folder is only read. An invalid Electron catalogue writes nothing. Electron saved views that
//! are absent, cannot be decoded or converted, or meet an existing native saved-views file are
//! skipped (with a warning) and never block the import.
//!
//! The native catalogue is written last and marks the import as done. Any I/O failure before it
//! (reading the Electron saved views, writing the native ones) stops the import without writing
//! the catalogue, so the next launch retries; a saved-views file this attempt did write is then
//! kept. A replacement whose directory sync fails is reread: it counts as written only when
//! the file holds exactly the bytes written.

use std::path::Path;

use serde::Deserialize;

use crate::atomic_file::atomic_replace;
use crate::catalogue::{is_uuid, js_trim, literal, parse_catalogue};
use crate::saved_views::{saved_query, serialize_saved_views, validate_views};
use crate::todo::DueCategory;
use crate::todo_query::{is_js_whitespace, CompletionView};
use crate::{CoreError, SavedView, TodoFilters, QUERY_GRAMMAR_VERSION, SAVED_VIEWS_FILE};

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
    /// No catalogue was written, so the native app starts without one and the next launch
    /// tries again.
    Refused(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportReport {
    pub workspaces: usize,
    pub saved_views: usize,
    /// Why the Electron saved views were not imported, when they were deliberately skipped.
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
    let (saved_views, saved_views_warning) = match import_saved_views(native_dir, electron_dir) {
        Ok(imported) => imported,
        Err(error) => return retry_later(native_dir, error),
    };
    if let Err(error) = write_confirmed(&native_catalogue, text.as_bytes()) {
        return retry_later(native_dir, error);
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

fn retry_later(native_dir: &Path, error: CoreError) -> ElectronImport {
    ElectronImport::Refused(format!(
        "The Electron app's data could not be imported into {}: {error}. Tuxedo will try again \
         on the next launch.",
        native_dir.display()
    ))
}

/// Atomically writes `contents`; an unconfirmed replacement is reread and counts as written
/// only when the file holds exactly `contents`.
fn write_confirmed(path: &Path, contents: &[u8]) -> Result<(), CoreError> {
    match atomic_replace(path, contents, MODE) {
        Err(CoreError::WriteUnconfirmed { .. })
            if std::fs::read(path).is_ok_and(|on_disk| on_disk == contents) =>
        {
            Ok(())
        }
        result => result,
    }
}

/// Converts and writes the Electron saved views: how many were imported and why they were
/// deliberately skipped, or the I/O failure that must stop the import.
fn import_saved_views(
    native_dir: &Path,
    electron_dir: &Path,
) -> Result<(usize, Option<String>), CoreError> {
    let source = electron_dir.join(SAVED_VIEWS_FILE);
    let target = native_dir.join(SAVED_VIEWS_FILE);
    let skipped = |detail: String| {
        Ok((
            0,
            Some(format!(
                "The Electron app's saved views at {} were not imported: {detail}.",
                source.display()
            )),
        ))
    };
    let text = match std::fs::read(&source) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((0, None)),
        Err(source_error) => {
            return Err(CoreError::Io {
                path: source.clone(),
                source: source_error,
            })
        }
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => return skipped("it is not valid UTF-8".into()),
        },
    };
    let views = match convert_saved_views(&text) {
        Ok(views) => views,
        Err(detail) => return skipped(detail),
    };
    match std::fs::symlink_metadata(&target) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(CoreError::Io {
                path: target,
                source: error,
            })
        }
        Ok(_) => return skipped(format!("{} already exists and was kept", target.display())),
    }
    write_confirmed(&target, serialize_saved_views(&views).as_bytes())?;
    Ok((views.len(), None))
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
    #[serde(deserialize_with = "status")]
    pub status: V1Status,
    pub search: String,
    #[serde(deserialize_with = "required_nullable")]
    pub project: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub context: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub priority: Option<String>,
    #[serde(deserialize_with = "due")]
    pub due: Option<V1Due>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum V1Status {
    All,
    Open,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

/// `status` as a string literal (Effect `Literals`), never serde's tagged `{"open": null}` form.
fn status<'de, D: serde::Deserializer<'de>>(d: D) -> Result<V1Status, D::Error> {
    literal(d, |s| match s {
        "all" => Some(V1Status::All),
        "open" => Some(V1Status::Open),
        "completed" => Some(V1Status::Completed),
        _ => None,
    })
}

/// `due`: required, `null` or a string literal.
fn due<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<V1Due>, D::Error> {
    let Some(value) = Option::<String>::deserialize(d)? else {
        return Ok(None);
    };
    let due = match value.as_str() {
        "overdue" => V1Due::Overdue,
        "today" => V1Due::Today,
        "upcoming" => V1Due::Upcoming,
        "none" => V1Due::None,
        "invalid" => V1Due::Invalid,
        _ => {
            return Err(serde::de::Error::custom(format!(
                "unsupported value {value:?}"
            )))
        }
    };
    Ok(Some(due))
}

/// Decodes a version-1 saved-views file and converts every view, or says why it cannot.
pub(crate) fn convert_saved_views(text: &str) -> Result<Vec<SavedView>, String> {
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

/// The canonical saved Query for a version-1 view's filters (see [`saved_query`]): filters that
/// select everything become `is:all`, the stored text for a match-all view.
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
    saved_query(&TodoFilters {
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
    })
    .map_err(|e| e.to_string())
}
