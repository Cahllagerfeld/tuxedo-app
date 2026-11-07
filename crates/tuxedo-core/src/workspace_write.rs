//! Workspace commands: create, update (rename, Workspace color, Workspace replacement), Show
//! deferred, delete, and select. Like Todo-file commands they run in three steps: a foreground
//! [`WorkspaceSession::prepare_workspace_change`] that checks the input and captures the expected
//! catalogue without I/O, a background [`WorkspaceWriteRequest::execute`] that rereads the
//! catalogue, loads any Todo file the result shows, and atomically replaces the catalogue, and a
//! foreground [`WorkspaceSession::accept_workspace_change`] that installs the result.
//!
//! These commands write only the catalogue. They never create, truncate, or delete a Todo file.

use std::path::{Path, PathBuf};

use crate::catalogue::{js_trim, read_catalogue, validate};
use crate::catalogue_write::write_catalogue;
use crate::{
    Catalogue, CoreError, OpenRequest, Workspace, WorkspaceColor, WorkspaceSession,
    WorkspaceSnapshot,
};

/// A Workspace command. Names are trimmed and Todo-file paths canonicalized by the core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceChange {
    /// Saves a new Workspace for an existing Todo file and makes it the Active workspace. The app
    /// supplies its `id` (a UUID) and `created_at` (an ISO datetime); preferences start absent.
    Create { workspace: Workspace },
    /// Renames, recolors, or points a Workspace at another Todo file (Workspace replacement). Its
    /// id, `created_at`, and preferences are kept, and it is not activated. Refused when the new
    /// Todo file or the Active workspace's Todo file cannot be loaded.
    Update {
        id: String,
        name: String,
        color: WorkspaceColor,
        todo_file: PathBuf,
    },
    /// Saves a Workspace's Show deferred preference. Everything else is kept, and it is not
    /// activated. Refused, like an update, when the Active workspace's Todo file cannot be loaded.
    SetShowDeferred { id: String, show_deferred: bool },
    /// Removes a Workspace from the catalogue. Its Todo file is untouched.
    Delete { id: String },
    /// Opens a Workspace and persists it as the Active workspace.
    Select { id: String },
}

/// A prepared Workspace command. Owns everything the background step needs.
#[derive(Debug, Clone)]
pub struct WorkspaceWriteRequest {
    catalogue_path: PathBuf,
    /// The catalogue the command was prepared against; a different one on disk refuses it.
    expected: Catalogue,
    change: WorkspaceChange,
    revision: u64,
}

/// A committed Workspace command: the new catalogue and the selection it implies.
#[derive(Debug, Clone)]
pub struct WorkspaceWriteResult {
    pub catalogue: Catalogue,
    pub selected: Option<WorkspaceSnapshot>,
    /// Why the Active workspace is not loaded although the command succeeded (Empty state), such
    /// as a remaining Active workspace whose Todo file could not reopen after a deletion.
    pub warning: Option<String>,
    revision: u64,
}

fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::InvalidCommand {
        message: message.into(),
    }
}

/// The Electron app's `WorkspaceName`: trimmed (JavaScript whitespace) and non-empty.
fn workspace_name(name: &str) -> Result<String, CoreError> {
    let name = js_trim(name);
    if name.is_empty() {
        return Err(invalid("Enter a workspace name."));
    }
    Ok(name.to_owned())
}

/// The Electron app's `TodoPath`: not blank.
fn check_todo_path(path: &Path) -> Result<(), CoreError> {
    if js_trim(&path.to_string_lossy()).is_empty() {
        return Err(invalid("Choose the exact Todo file for this workspace."));
    }
    Ok(())
}

impl WorkspaceSession {
    /// Foreground step: checks and normalizes the input against the session and captures the
    /// expected catalogue and revision. Performs no I/O.
    pub fn prepare_workspace_change(
        &self,
        catalogue_path: &Path,
        change: WorkspaceChange,
    ) -> Result<WorkspaceWriteRequest, CoreError> {
        let known = |id: &str| {
            self.catalogue
                .workspace(id)
                .map(|_| ())
                .ok_or_else(|| CoreError::UnknownWorkspace { id: id.to_owned() })
        };
        let change = match change {
            WorkspaceChange::Create { mut workspace } => {
                workspace.name = workspace_name(&workspace.name)?;
                check_todo_path(&workspace.todo_file)?;
                WorkspaceChange::Create { workspace }
            }
            WorkspaceChange::Update {
                id,
                name,
                color,
                todo_file,
            } => {
                known(&id)?;
                check_todo_path(&todo_file)?;
                WorkspaceChange::Update {
                    name: workspace_name(&name)?,
                    id,
                    color,
                    todo_file,
                }
            }
            WorkspaceChange::SetShowDeferred { id, show_deferred } => {
                known(&id)?;
                WorkspaceChange::SetShowDeferred { id, show_deferred }
            }
            WorkspaceChange::Delete { id } => {
                known(&id)?;
                WorkspaceChange::Delete { id }
            }
            WorkspaceChange::Select { id } => {
                known(&id)?;
                WorkspaceChange::Select { id }
            }
        };
        Ok(WorkspaceWriteRequest {
            catalogue_path: catalogue_path.to_path_buf(),
            expected: self.catalogue.clone(),
            change,
            revision: self.revision,
        })
    }

    /// Foreground step: installs the committed catalogue and its selection. A result prepared
    /// against an older revision is refused as [`CoreError::StaleCommand`]; the catalogue on disk
    /// has changed regardless, so the caller rereads it to recover.
    pub fn accept_workspace_change(
        &mut self,
        result: WorkspaceWriteResult,
    ) -> Result<(), CoreError> {
        if result.revision != self.revision {
            return Err(CoreError::StaleCommand);
        }
        self.accept_catalogue(result.catalogue, result.selected);
        Ok(())
    }
}

impl WorkspaceWriteRequest {
    /// Background step: rereads and strictly validates the catalogue, refuses the command if it
    /// differs from the expected one, loads the Todo file the result shows, and atomically
    /// replaces the catalogue. Touches no session state. On any error before the replacement the
    /// catalogue on disk is unchanged.
    pub fn execute(self) -> Result<WorkspaceWriteResult, CoreError> {
        let path = &self.catalogue_path;
        let previous = match read_catalogue(path)? {
            Some(catalogue) => catalogue,
            // Only the first Workspace creation may find no catalogue yet.
            None if matches!(self.change, WorkspaceChange::Create { .. })
                && self.expected == Catalogue::default() =>
            {
                Catalogue::default()
            }
            None => {
                return Err(invalid(format!(
                    "The Workspace catalogue at {} is missing. Nothing was saved.",
                    path.display()
                )))
            }
        };
        if previous != self.expected {
            return Err(CoreError::StaleCommand);
        }
        let (catalogue, selected, warning) = match self.change {
            WorkspaceChange::Create { mut workspace } => {
                let snapshot;
                (workspace.todo_file, snapshot) =
                    load_chosen(path, workspace.todo_file.clone(), &workspace)?;
                let mut catalogue = previous;
                catalogue.active_workspace_id = Some(workspace.id.clone());
                catalogue.workspaces.push(workspace);
                checked(path, &catalogue)?;
                let snapshot = WorkspaceSnapshot {
                    workspace: catalogue.workspaces.last().expect("just added").clone(),
                    ..snapshot
                };
                (catalogue, Some(snapshot), None)
            }
            WorkspaceChange::Update {
                id,
                name,
                color,
                todo_file,
            } => {
                let mut catalogue = previous;
                let index = catalogue
                    .workspaces
                    .iter()
                    .position(|w| w.id == id)
                    .ok_or(CoreError::UnknownWorkspace { id: id.clone() })?;
                let current = &catalogue.workspaces[index];
                let mut updated = Workspace {
                    name,
                    color,
                    ..current.clone()
                };
                // Workspace replacement loads the new Todo file before anything is saved.
                let replaced = if todo_file != current.todo_file {
                    let (canonical, snapshot) = load_chosen(path, todo_file, &updated)?;
                    updated.todo_file = canonical;
                    Some(snapshot)
                } else {
                    None
                };
                catalogue.workspaces[index] = updated;
                checked(path, &catalogue)?;
                // Unlike a deletion, an update is refused before writing when the Active
                // workspace it would show cannot be loaded.
                let selected = match replaced {
                    Some(snapshot) if catalogue.active_workspace_id.as_ref() == Some(&id) => {
                        Some(WorkspaceSnapshot {
                            workspace: catalogue.workspaces[index].clone(),
                            ..snapshot
                        })
                    }
                    _ => catalogue
                        .active_workspace()
                        .cloned()
                        .map(|workspace| OpenRequest { workspace }.load())
                        .transpose()?,
                };
                (catalogue, selected, None)
            }
            WorkspaceChange::SetShowDeferred { id, show_deferred } => {
                let mut catalogue = previous;
                let workspace = catalogue
                    .workspaces
                    .iter_mut()
                    .find(|w| w.id == id)
                    .ok_or(CoreError::UnknownWorkspace { id: id.clone() })?;
                workspace.show_deferred = Some(show_deferred);
                // The Todo file is reread as an update does; unchanged contents keep Undo.
                let selected = catalogue
                    .active_workspace()
                    .cloned()
                    .map(|workspace| OpenRequest { workspace }.load())
                    .transpose()?;
                (catalogue, selected, None)
            }
            WorkspaceChange::Delete { id } => {
                let mut catalogue = previous;
                catalogue.workspaces.retain(|w| w.id != id);
                if catalogue.active_workspace_id.as_ref() == Some(&id) {
                    catalogue.active_workspace_id = None;
                }
                checked(path, &catalogue)?;
                let (selected, warning) = project(&catalogue);
                (catalogue, selected, warning)
            }
            WorkspaceChange::Select { id } => {
                let workspace = previous
                    .workspace(&id)
                    .cloned()
                    .ok_or(CoreError::UnknownWorkspace { id: id.clone() })?;
                // Load first: a Todo file that cannot open leaves the Active workspace unchanged.
                let snapshot = OpenRequest { workspace }.load()?;
                let mut catalogue = previous;
                catalogue.active_workspace_id = Some(id);
                (catalogue, Some(snapshot), None)
            }
        };
        if catalogue != self.expected {
            write_catalogue(path, &catalogue)?;
        }
        Ok(WorkspaceWriteResult {
            catalogue,
            selected,
            warning,
            revision: self.revision,
        })
    }
}

/// Validates a catalogue the command is about to persist, reporting the Electron app's issues.
fn checked(path: &Path, catalogue: &Catalogue) -> Result<(), CoreError> {
    validate(catalogue).map_err(|issues| CoreError::InvalidCatalogue {
        path: path.to_path_buf(),
        issues,
    })
}

/// Resolves the Todo file chosen for `workspace` to its canonical path and loads it. Refuses the
/// catalogue itself, paths that are not UTF-8, and files with Skipped lines (as Electron's
/// creation does). Never creates or modifies the file.
fn load_chosen(
    catalogue_path: &Path,
    chosen: PathBuf,
    workspace: &Workspace,
) -> Result<(PathBuf, WorkspaceSnapshot), CoreError> {
    let canonical = std::fs::canonicalize(&chosen).map_err(|source| CoreError::Io {
        path: chosen,
        source,
    })?;
    if canonical.to_str().is_none() {
        return Err(invalid("Choose a Todo file whose path is valid UTF-8."));
    }
    // macOS file systems are usually case-insensitive, so compare as Electron does.
    let lower = |p: &Path| p.to_string_lossy().to_lowercase();
    if std::fs::canonicalize(catalogue_path).is_ok_and(|c| lower(&c) == lower(&canonical)) {
        return Err(invalid(
            "Choose a Todo file outside Tuxedo’s Workspace catalogue.",
        ));
    }
    let snapshot = OpenRequest {
        workspace: Workspace {
            todo_file: canonical.clone(),
            ..workspace.clone()
        },
    }
    .load()?;
    if !snapshot.file.skipped.is_empty() {
        return Err(invalid("Todo file contains skipped lines."));
    }
    Ok((canonical, snapshot))
}

/// The selection a committed deletion implies: its Active workspace's freshly read Todo file,
/// or none. A Todo file that cannot open leaves the Empty state with a warning.
fn project(catalogue: &Catalogue) -> (Option<WorkspaceSnapshot>, Option<String>) {
    let Some(workspace) = catalogue.active_workspace().cloned() else {
        return (None, None);
    };
    match (OpenRequest { workspace }).load() {
        Ok(snapshot) => (Some(snapshot), None),
        Err(error) => (None, Some(error.to_string())),
    }
}
