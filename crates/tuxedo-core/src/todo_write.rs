//! Todo-file commands: complete/reopen a Todo item and Undo the last change.
//!
//! Each command runs in three steps, like opening a Workspace: a foreground `prepare_*` that
//! checks the session and captures owned expectations without I/O, a background
//! [`TodoWriteRequest::execute`] that rereads and writes the file, and a foreground
//! [`WorkspaceSession::accept_todo_write`] that installs the result.

use std::fs;
use std::path::{Path, PathBuf};

use crate::atomic_file::atomic_replace;
use crate::completion::set_completion_line;
use crate::recurrence::plan_recurring_completion;
use crate::{
    load_catalogue, parse_todo_text, CoreError, LineEnding, TodoDate, TodoFile, Workspace,
    WorkspaceSession, WorkspaceSnapshot,
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
    label: &'static str,
}

impl UndoToken {
    /// What Undo reverts, such as "Undo completion".
    pub fn label(&self) -> &str {
        self.label
    }
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
    /// The selected Workspace's Todo file when the command was prepared.
    path: PathBuf,
    origin: Origin,
    command: TodoCommand,
}

#[derive(Debug, Clone)]
enum TodoCommand {
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
    /// command adds (such as the next occurrence, or an unsupported Repeat rule).
    pub notice: Option<String>,
    origin: Origin,
}

fn invalid(message: &str) -> CoreError {
    CoreError::InvalidCommand {
        message: message.to_owned(),
    }
}

impl WorkspaceSession {
    /// The current Undo step's label, such as "Undo completion".
    pub fn undo_label(&self) -> Option<&str> {
        self.undo.as_ref().map(UndoToken::label)
    }

    /// Foreground step: refuses a target from another Workspace or an older revision as
    /// [`CoreError::StaleCommand`], and a target that is not one Todo item's line as
    /// [`CoreError::InvalidCommand`]. Performs no I/O.
    pub fn prepare_completion(
        &self,
        catalogue_path: &Path,
        target: TodoTarget,
        completed: bool,
        today: TodoDate,
    ) -> Result<TodoWriteRequest, CoreError> {
        let (origin, path) = self.current_origin(&target.workspace_id, target.revision)?;
        let expected = parse_todo_text(PathBuf::new(), &target.expected_raw);
        if expected.items.len() != 1
            || !expected.skipped.is_empty()
            || target.expected_raw.contains('\n')
        {
            return Err(invalid("Invalid Todo item target."));
        }
        Ok(TodoWriteRequest {
            catalogue_path: catalogue_path.to_path_buf(),
            path,
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
            .ok_or_else(|| invalid("There is no change to undo."))?;
        let (origin, path) = self.current_origin(&token.workspace_id, self.revision)?;
        Ok(TodoWriteRequest {
            catalogue_path: catalogue_path.to_path_buf(),
            path,
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

    fn current_origin(
        &self,
        workspace_id: &str,
        revision: u64,
    ) -> Result<(Origin, PathBuf), CoreError> {
        match &self.selected {
            Some(selected)
                if selected.workspace.id == workspace_id && revision == self.revision =>
            {
                let origin = Origin {
                    workspace_id: workspace_id.to_owned(),
                    revision,
                };
                Ok((origin, selected.workspace.todo_file.clone()))
            }
            _ => Err(CoreError::StaleCommand),
        }
    }
}

impl TodoWriteRequest {
    /// Background step: rereads the catalogue and Todo file, checks the expectations, and
    /// atomically replaces the file. Touches no session state.
    pub fn execute(self) -> Result<TodoWriteResult, CoreError> {
        let workspace = load_catalogue(&self.catalogue_path)?
            .active_workspace()
            .filter(|w| w.id == self.origin.workspace_id && w.todo_file == self.path)
            .cloned()
            .ok_or_else(|| invalid("The Active workspace changed."))?;
        let before = fs::read(&self.path).map_err(|source| CoreError::Io {
            path: self.path.clone(),
            source,
        })?;
        let origin = self.origin;
        let conflict = |workspace, before, notice: &str| {
            Ok(TodoWriteResult {
                snapshot: snapshot(workspace, before)?,
                undo: None,
                status: TodoWriteStatus::Conflict,
                notice: Some(notice.to_owned()),
                origin: origin.clone(),
            })
        };
        let (after, undo, notice) = match self.command {
            TodoCommand::Completion {
                target,
                completed,
                today,
            } => {
                let current = snapshot(workspace.clone(), before.clone())?;
                let item = current
                    .file
                    .items
                    .iter()
                    .find(|item| item.line_number == target.line_number)
                    .filter(|item| item.raw == target.expected_raw);
                let Some(item) = item else {
                    return conflict(
                        workspace,
                        before,
                        "The Todo item changed on disk. Review its current contents.",
                    );
                };
                let raw = set_completion_line(item, completed, today).map_err(invalid)?;
                let (raw, notice) = if completed {
                    let index = item.line_number as usize - 1;
                    let ending = ending_str(current.file.lines[index].ending);
                    let first = current.file.lines.first().map(|l| ending_str(l.ending));
                    let plan = plan_recurring_completion(
                        item,
                        raw,
                        today,
                        ending,
                        first.filter(|e| !e.is_empty()),
                    )
                    .map_err(invalid)?;
                    (plan.raw, plan.notice)
                } else {
                    (raw, None)
                };
                let after = replace_line(&current.file, target.line_number, &raw);
                let token = UndoToken {
                    workspace_id: workspace.id.clone(),
                    path: self.path.clone(),
                    before: before.clone(),
                    after: after.clone().into_bytes(),
                    label: if completed {
                        "Undo completion"
                    } else {
                        "Undo uncompletion"
                    },
                };
                (after.into_bytes(), Some(token), notice)
            }
            TodoCommand::Undo { token } => {
                if token.path != self.path || token.after != before {
                    return conflict(
                        workspace,
                        before,
                        "The Todo file changed on disk. Undo is no longer available.",
                    );
                }
                (token.before, None, None)
            }
        };
        atomic_replace(&self.path, &after, file_mode(&self.path)?)?;
        Ok(TodoWriteResult {
            snapshot: snapshot(workspace, after)?,
            undo,
            status: TodoWriteStatus::Applied,
            notice,
            origin,
        })
    }
}

fn ending_str(ending: LineEnding) -> &'static str {
    match ending {
        LineEnding::Lf => "\n",
        LineEnding::CrLf => "\r\n",
        LineEnding::None => "",
    }
}

/// The file's source with physical line `line_number` replaced by `raw`, keeping that line's
/// ending and every other byte.
fn replace_line(file: &TodoFile, line_number: u32, raw: &str) -> String {
    let mut out = String::with_capacity(file.source.len() + raw.len());
    for line in &file.lines {
        let text = if line.line_number == line_number {
            raw
        } else {
            &line.text
        };
        out.push_str(text);
        out.push_str(ending_str(line.ending));
    }
    out
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
