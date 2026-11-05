//! Todo-file commands from the List view: building targets from displayed Todo items and
//! preparing queued commands against the current session.

use std::path::Path;

use tuxedo_core::{
    CoreError, TodoDate, TodoItem, TodoTarget, TodoWriteRequest, WorkspaceSession,
    WorkspaceSnapshot,
};

use crate::command_queue::Command;

/// The target for a displayed Todo item, captured when the person acts on it.
pub fn target(selected: &WorkspaceSnapshot, revision: u64, item: &TodoItem) -> TodoTarget {
    TodoTarget {
        workspace_id: selected.workspace.id.clone(),
        revision,
        line_number: item.line_number,
        expected_raw: item.raw.clone(),
    }
}

/// Prepares a dequeued Todo-file command against the session as it is now. A command admitted
/// against an older revision or another Workspace is refused as stale.
pub fn prepare(
    session: &WorkspaceSession,
    catalogue_path: &Path,
    command: Command,
    today: TodoDate,
) -> Result<TodoWriteRequest, CoreError> {
    match command {
        Command::Complete { target, completed } => {
            session.prepare_completion(catalogue_path, target, completed, today)
        }
        Command::Undo {
            workspace_id,
            revision,
        } => {
            let current = session.selected().map(|s| s.workspace.id.as_str());
            if current != Some(workspace_id.as_str()) || revision != session.revision() {
                return Err(CoreError::StaleCommand);
            }
            session.prepare_undo(catalogue_path)
        }
    }
}

/// Today's local calendar date.
pub fn local_today() -> TodoDate {
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();
    TodoDate::parse(&today).expect("chrono formats a valid YYYY-MM-DD date")
}
