//! Saved views: named Queries per Workspace, kept in `saved-views.json` next to the Workspace
//! catalogue, where the Electron app keeps its saved views (`packages/backend/src/saved-views.ts`).
//!
//! The native app stores the Query text, not the Electron app's structured filters, so the file
//! has a new version: `{"version": 2, "views": [{id, workspace_id, name, query,
//! grammar_version}]}`. A version-1 (Electron) file is reported as unsupported and, like any
//! file that cannot be read, preserved: every write rereads the file first and refuses to
//! replace one it cannot read. Otherwise the Electron rules hold: UUID ids, trimmed non-empty
//! names unique per Workspace ignoring case, and atomic writes at `0600`.
//!
//! Writes run in the same three steps as Workspace commands: a foreground
//! [`SavedViews::prepare`] without I/O, a background [`SavedViewWriteRequest::execute`] that
//! rereads and atomically replaces the file, and a foreground [`SavedViews::accept`]. The
//! confirmed saved views live in [`SavedViews`], next to the [`WorkspaceSession`] they refer to.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic_file::atomic_replace;
use crate::catalogue::{is_uuid, js_trim};
use crate::{CoreError, TodoFilters, WorkspaceSession, QUERY_GRAMMAR_VERSION};

/// The saved-views file name, next to the catalogue.
pub const SAVED_VIEWS_FILE: &str = "saved-views.json";
/// The file format this app reads and writes.
const VERSION: u64 = 2;
/// The file's permission bits, as the catalogue's.
const MODE: u32 = 0o600;

/// One Saved view: a name and the canonical Query text it applies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedView {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub query: String,
    /// The `QUERY_GRAMMAR_VERSION` the Query was written under.
    pub grammar_version: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFile {
    version: serde_json::Value,
    views: Vec<serde_json::Value>,
}

/// `saved-views.json` next to the catalogue at `catalogue_path`.
pub fn saved_views_path(catalogue_path: &Path) -> PathBuf {
    catalogue_path
        .parent()
        .unwrap_or(Path::new("."))
        .join(SAVED_VIEWS_FILE)
}

fn unreadable(path: &Path, detail: impl std::fmt::Display) -> CoreError {
    CoreError::InvalidCommand {
        message: format!(
            "Cannot read saved views at {}: {detail}. The file has been preserved.",
            path.display()
        ),
    }
}

fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::InvalidCommand {
        message: message.into(),
    }
}

/// Reads the saved views at `path`; an absent file holds none. Any other read failure, a
/// version-1 file, or a file breaking the rules is an error, and the file is left as it is.
pub fn read_saved_views(path: &Path) -> Result<Vec<SavedView>, CoreError> {
    let text = match std::fs::read(path) {
        Ok(bytes) => String::from_utf8(bytes).map_err(|_| CoreError::InvalidUtf8 {
            path: path.to_path_buf(),
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(source) => {
            return Err(CoreError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    };
    parse_saved_views(&text).map_err(|detail| unreadable(path, detail))
}

/// Strictly decodes a saved-views file's contents.
pub(crate) fn parse_saved_views(text: &str) -> Result<Vec<SavedView>, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("not valid JSON ({e})"))?;
    // serde would also decode structs from arrays; only objects are entries.
    if !value.is_object() {
        return Err("the file must be a JSON object".into());
    }
    let raw = RawFile::deserialize(value).map_err(|e| e.to_string())?;
    match raw.version.as_f64() {
        Some(v) if v == VERSION as f64 => {}
        Some(1.0) => {
            return Err(
                "version 1 (the Electron app's saved filters) is not supported; this app saves \
                 Queries in version 2"
                    .into(),
            )
        }
        _ => return Err(format!("unsupported version {}", raw.version)),
    }
    let views = raw
        .views
        .into_iter()
        .map(|view| {
            if !view.is_object() {
                return Err("each saved view must be a JSON object".to_owned());
            }
            SavedView::deserialize(view).map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    validate(&views)?;
    Ok(views)
}

/// The rules every read and write shares.
fn validate(views: &[SavedView]) -> Result<(), String> {
    let mut issues = Vec::new();
    for view in views {
        let label = &view.id;
        if !is_uuid(&view.id) || !is_uuid(&view.workspace_id) {
            issues.push(format!("saved view {label} has an id that is not a UUID"));
        }
        if view.name.is_empty() || js_trim(&view.name) != view.name {
            issues.push(format!(
                "saved view {label} name must be non-empty without surrounding whitespace"
            ));
        }
        if view.grammar_version != QUERY_GRAMMAR_VERSION {
            issues.push(format!(
                "saved view {label} uses Query grammar version {}",
                view.grammar_version
            ));
        } else if js_trim(&view.query).is_empty() {
            issues.push(format!("saved view {label} has an empty Query"));
        } else if let Err(error) = TodoFilters::parse(&view.query) {
            issues.push(format!("saved view {label} has an invalid Query ({error})"));
        }
    }
    let mut ids = HashSet::new();
    if !views.iter().all(|v| ids.insert(&v.id)) {
        issues.push("duplicate saved view id".into());
    }
    let mut names = HashSet::new();
    if !views
        .iter()
        .all(|v| names.insert((&v.workspace_id, v.name.to_lowercase())))
    {
        issues.push("duplicate saved view name in a Workspace".into());
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues.join("; "))
    }
}

/// The file's contents: two-space JSON with a final LF, as the catalogue.
pub(crate) fn serialize_saved_views(views: &[SavedView]) -> String {
    #[derive(Serialize)]
    struct File<'a> {
        version: u64,
        views: &'a [SavedView],
    }
    let mut text = serde_json::to_string_pretty(&File {
        version: VERSION,
        views,
    })
    .expect("saved-views serialization is total");
    text.push('\n');
    text
}

/// A Saved-view command. The app supplies a new view's `id` (a UUID).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SavedViewChange {
    /// Saves `query` (canonicalized) under the trimmed `name` for the Workspace.
    Create {
        id: String,
        workspace_id: String,
        name: String,
        query: String,
    },
    /// Removes the view.
    Delete { id: String },
}

/// The confirmed saved views of every Workspace, or why the file could not be read.
#[derive(Debug, Clone)]
pub struct SavedViews {
    path: PathBuf,
    views: Result<Vec<SavedView>, String>,
    /// Advances whenever accepted contents change; results prepared earlier are refused.
    revision: u64,
}

/// A prepared Saved-view command. Owns everything the background step needs.
#[derive(Debug, Clone)]
pub struct SavedViewWriteRequest {
    path: PathBuf,
    /// The views the command was prepared against; a different file on disk refuses it.
    expected: Vec<SavedView>,
    change: SavedViewChange,
    revision: u64,
}

/// A committed Saved-view command: the file's new contents.
#[derive(Debug, Clone)]
pub struct SavedViewWriteResult {
    views: Vec<SavedView>,
    revision: u64,
}

impl SavedViews {
    /// The saved views read from `path` (see [`read_saved_views`]); a read failure is kept as
    /// the reason, and every write is refused until a reread succeeds.
    pub fn new(path: PathBuf, read: Result<Vec<SavedView>, CoreError>) -> Self {
        Self {
            path,
            views: read.map_err(|e| e.to_string()),
            revision: 0,
        }
    }

    /// Blocking: reads the file at `path`.
    pub fn load(path: PathBuf) -> Self {
        let read = read_saved_views(&path);
        Self::new(path, read)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Why the file could not be read, if it could not.
    pub fn error(&self) -> Option<&str> {
        self.views.as_ref().err().map(String::as_str)
    }

    /// The Workspace's saved views in file order (none while the file is unreadable).
    pub fn for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
    ) -> impl Iterator<Item = &'a SavedView> + 'a {
        self.views
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(move |v| v.workspace_id == workspace_id)
    }

    /// Foreground step: checks the input against the confirmed views and the session's
    /// catalogue, canonicalizes the Query, and captures the expected views. No I/O.
    pub fn prepare(
        &self,
        session: &WorkspaceSession,
        change: SavedViewChange,
    ) -> Result<SavedViewWriteRequest, CoreError> {
        let views = self
            .views
            .as_ref()
            .map_err(|error| invalid(error.clone()))?;
        let change = match change {
            SavedViewChange::Create {
                id,
                workspace_id,
                name,
                query,
            } => {
                if session.catalogue().workspace(&workspace_id).is_none() {
                    return Err(CoreError::UnknownWorkspace { id: workspace_id });
                }
                if !is_uuid(&id) {
                    return Err(invalid("A saved view id must be a UUID."));
                }
                let name = js_trim(&name).to_owned();
                if name.is_empty() {
                    return Err(invalid("Enter a name for the saved view."));
                }
                let lower = name.to_lowercase();
                if views
                    .iter()
                    .any(|v| v.workspace_id == workspace_id && v.name.to_lowercase() == lower)
                {
                    return Err(invalid(
                        "A saved view with this name already exists in this Workspace.",
                    ));
                }
                let query = TodoFilters::parse(&query)
                    .and_then(|filters| filters.to_query())
                    .map_err(|error| invalid(format!("The Query is invalid: {error}.")))?;
                if query.is_empty() {
                    return Err(invalid("Enter a Query before saving a view."));
                }
                SavedViewChange::Create {
                    id,
                    workspace_id,
                    name,
                    query,
                }
            }
            SavedViewChange::Delete { id } => {
                if !views.iter().any(|v| v.id == id) {
                    return Err(invalid("The saved view no longer exists."));
                }
                SavedViewChange::Delete { id }
            }
        };
        Ok(SavedViewWriteRequest {
            path: self.path.clone(),
            expected: views.clone(),
            change,
            revision: self.revision,
        })
    }

    /// Foreground step: installs a committed result. A result prepared before another accepted
    /// change is refused as [`CoreError::StaleCommand`]; the file on disk has changed
    /// regardless, so the caller rereads it.
    pub fn accept(&mut self, result: SavedViewWriteResult) -> Result<(), CoreError> {
        if result.revision != self.revision {
            return Err(CoreError::StaleCommand);
        }
        self.install(Ok(result.views));
        Ok(())
    }

    /// Installs an authoritative reread (see [`read_saved_views`]) as the confirmed views.
    pub fn accept_reread(&mut self, read: Result<Vec<SavedView>, CoreError>) {
        self.install(read.map_err(|e| e.to_string()));
    }

    fn install(&mut self, views: Result<Vec<SavedView>, String>) {
        if self.views != views {
            self.views = views;
            self.revision += 1;
        }
    }
}

impl SavedViewWriteRequest {
    /// Background step: rereads and validates the file, refuses the command if it differs from
    /// the expected views, and atomically replaces it. On any error before the replacement the
    /// file is unchanged.
    pub fn execute(self) -> Result<SavedViewWriteResult, CoreError> {
        let previous = read_saved_views(&self.path)?;
        if previous != self.expected {
            return Err(CoreError::StaleCommand);
        }
        let mut views = previous;
        match self.change {
            SavedViewChange::Create {
                id,
                workspace_id,
                name,
                query,
            } => views.push(SavedView {
                id,
                workspace_id,
                name,
                query,
                grammar_version: QUERY_GRAMMAR_VERSION,
            }),
            SavedViewChange::Delete { id } => views.retain(|v| v.id != id),
        }
        validate(&views).map_err(invalid)?;
        atomic_replace(&self.path, serialize_saved_views(&views).as_bytes(), MODE)?;
        Ok(SavedViewWriteResult {
            views,
            revision: self.revision,
        })
    }
}
