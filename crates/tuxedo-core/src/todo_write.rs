//! Todo-file commands: complete/reopen a Todo item and Undo the last change.
//!
//! Each command runs in three steps, like opening a Workspace: a foreground `prepare_*` that
//! checks the session and captures owned expectations without I/O, a background
//! [`TodoWriteRequest::execute`] that rereads and writes the file, and a foreground
//! [`WorkspaceSession::accept_todo_write`] that installs the result.

use std::fs;
use std::path::{Path, PathBuf};

use crate::atomic_file::atomic_replace;
use crate::{
    load_catalogue, parse_todo_text, CoreError, TodoDate, Workspace, WorkspaceSession,
    WorkspaceSnapshot,
};

/// The Todo item a command addresses, captured when the command is admitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoTarget {
    pub workspace_id: String,
    /// The session revision the target was read from.
    pub revision: u64,
    /// 1-based physical line.
    pub line_number: u32,
    /// The line as displayed, without its line ending.
    pub expected_raw: String,
}

/// The one Undo step: restores `before` when the file still holds exactly `after`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoToken {
    workspace_id: String,
    path: PathBuf,
    before: Vec<u8>,
    after: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoWriteStatus {
    /// The change was written.
    Applied,
    /// The file changed on disk; nothing was written and the result carries the current file.
    Conflict,
}

/// A prepared Todo-file command. Owns everything the background step needs.
#[derive(Debug, Clone)]
pub struct TodoWriteRequest {
    catalogue_path: PathBuf,
    origin: Origin,
    command: TodoCommand,
}

#[derive(Debug, Clone)]
enum TodoCommand {
    #[allow(
        dead_code,
        reason = "read by the completion transformation, landing next in #253"
    )]
    Completion {
        target: TodoTarget,
        completed: bool,
        today: TodoDate,
    },
    Undo {
        token: UndoToken,
    },
}

/// The session state a command was prepared against; acceptance refuses any other.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Origin {
    workspace_id: String,
    revision: u64,
}

#[derive(Debug, Clone)]
pub struct TodoWriteResult {
    pub snapshot: WorkspaceSnapshot,
    pub undo: Option<UndoToken>,
    pub status: TodoWriteStatus,
    /// A message for the person: why a Conflict refused the command, or what an Applied
    /// command could not do (such as an unsupported recurrence rule).
    pub notice: Option<String>,
    origin: Origin,
}

fn invalid(message: &str) -> CoreError {
    CoreError::InvalidCommand {
        message: message.to_owned(),
    }
}

impl WorkspaceSession {
    /// Foreground step: refuses a target from another Workspace or an older revision as
    /// [`CoreError::StaleCommand`]. Performs no I/O.
    pub fn prepare_completion(
        &self,
        catalogue_path: &Path,
        target: TodoTarget,
        completed: bool,
        today: TodoDate,
    ) -> Result<TodoWriteRequest, CoreError> {
        let origin = self.current_origin(&target.workspace_id, target.revision)?;
        Ok(TodoWriteRequest {
            catalogue_path: catalogue_path.to_path_buf(),
            origin,
            command: TodoCommand::Completion {
                target,
                completed,
                today,
            },
        })
    }

    /// Foreground step: captures the Undo step for the selected Workspace. Performs no I/O.
    pub fn prepare_undo(&self, catalogue_path: &Path) -> Result<TodoWriteRequest, CoreError> {
        let token = self
            .undo
            .clone()
            .ok_or_else(|| invalid("Nothing to undo."))?;
        let origin = self.current_origin(&token.workspace_id, self.revision)?;
        Ok(TodoWriteRequest {
            catalogue_path: catalogue_path.to_path_buf(),
            origin,
            command: TodoCommand::Undo { token },
        })
    }

    /// Foreground step: installs the result's snapshot and Undo step, leaving the catalogue
    /// untouched. A result prepared against another Workspace or revision is refused as
    /// [`CoreError::StaleCommand`]; the caller then rereads the file to recover.
    pub fn accept_todo_write(
        &mut self,
        result: TodoWriteResult,
    ) -> Result<TodoWriteStatus, CoreError> {
        self.current_origin(&result.origin.workspace_id, result.origin.revision)?;
        self.replace_selected(Some(result.snapshot));
        self.undo = result.undo;
        Ok(result.status)
    }

    fn current_origin(&self, workspace_id: &str, revision: u64) -> Result<Origin, CoreError> {
        let selected = self.selected.as_ref().map(|s| s.workspace.id.as_str());
        if selected != Some(workspace_id) || revision != self.revision {
            return Err(CoreError::StaleCommand);
        }
        Ok(Origin {
            workspace_id: workspace_id.to_owned(),
            revision,
        })
    }
}

impl TodoWriteRequest {
    /// Background step: rereads the catalogue and Todo file, checks the expectations, and
    /// atomically replaces the file. Touches no session state.
    pub fn execute(self) -> Result<TodoWriteResult, CoreError> {
        let workspace = load_catalogue(&self.catalogue_path)?
            .active_workspace()
            .filter(|w| w.id == self.origin.workspace_id)
            .cloned()
            .ok_or_else(|| invalid("This Workspace is no longer the Active workspace."))?;
        let path = workspace.todo_file.clone();
        let before = fs::read(&path).map_err(|source| CoreError::Io {
            path: path.clone(),
            source,
        })?;
        match self.command {
            TodoCommand::Completion { .. } => {
                Err(invalid("Completing Todo items is not available yet."))
            }
            TodoCommand::Undo { token } => {
                if token.path != path || token.after != before {
                    let snapshot = snapshot(workspace, before)?;
                    return Ok(TodoWriteResult {
                        snapshot,
                        undo: None,
                        status: TodoWriteStatus::Conflict,
                        notice: Some(
                            "Cannot undo: the Todo file changed on disk. Showing its current contents."
                                .to_owned(),
                        ),
                        origin: self.origin,
                    });
                }
                atomic_replace(&path, &token.before, file_mode(&path)?)?;
                Ok(TodoWriteResult {
                    snapshot: snapshot(workspace, token.before)?,
                    undo: None,
                    status: TodoWriteStatus::Applied,
                    notice: None,
                    origin: self.origin,
                })
            }
        }
    }
}

fn snapshot(workspace: Workspace, bytes: Vec<u8>) -> Result<WorkspaceSnapshot, CoreError> {
    let text = String::from_utf8(bytes).map_err(|_| CoreError::InvalidUtf8 {
        path: workspace.todo_file.clone(),
    })?;
    let file = parse_todo_text(workspace.todo_file.clone(), &text);
    Ok(WorkspaceSnapshot {
        summary: file.summary(),
        workspace,
        file,
    })
}

/// The file's current permission bits, so a replacement keeps them.
fn file_mode(path: &Path) -> Result<u32, CoreError> {
    let metadata = fs::metadata(path).map_err(|source| CoreError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    #[cfg(unix)]
    let mode = std::os::unix::fs::PermissionsExt::mode(&metadata.permissions()) & 0o7777;
    #[cfg(not(unix))]
    let mode = {
        let _ = metadata;
        0o644
    };
    Ok(mode)
}
