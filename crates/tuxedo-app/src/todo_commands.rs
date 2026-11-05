//! The Todo-file command family: building targets from displayed Todo items, preparing queued
//! commands against the current session, and accepting their results.

use std::path::Path;

use tuxedo_core::{
    CoreError, TodoDate, TodoItem, TodoTarget, TodoWriteRequest, TodoWriteResult, TodoWriteStatus,
    WorkspaceSession, WorkspaceSnapshot,
};

use crate::command_queue::{Accepted, Outcome, OutcomeKind, TodoCommand};

/// The target for a displayed Todo item, captured when the person acts on it.
pub fn target(selected: &WorkspaceSnapshot, revision: u64, item: &TodoItem) -> TodoTarget {
    TodoTarget {
        workspace_id: selected.workspace.id.clone(),
        revision,
        line_number: item.line_number,
        expected_raw: item.raw.clone(),
    }
}

/// Foreground: prepares a dequeued Todo-file command against the session as it is now. A command
/// admitted against an older revision or another Workspace is refused as stale.
pub fn prepare(
    session: &WorkspaceSession,
    catalogue_path: &Path,
    command: TodoCommand,
    today: TodoDate,
) -> Result<TodoWriteRequest, CoreError> {
    match command {
        TodoCommand::Complete { target, completed } => {
            session.prepare_completion(catalogue_path, target, completed, today)
        }
        TodoCommand::Undo {
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

/// Foreground: installs a Todo-file command's result (or reports its failure, including a
/// preparation failure).
pub fn accept(
    session: &mut WorkspaceSession,
    result: Result<TodoWriteResult, CoreError>,
) -> Accepted {
    let failed = |message: String| Outcome::new(OutcomeKind::Failed, FAILED, Some(message));
    match result {
        Ok(result) => {
            let notice = result.notice.clone();
            match session.accept_todo_write(result) {
                Ok(TodoWriteStatus::Applied) => {
                    Accepted::Done(Outcome::new(OutcomeKind::Applied, "Saved", notice))
                }
                Ok(TodoWriteStatus::Conflict) => Accepted::Done(Outcome::new(
                    OutcomeKind::Conflict,
                    "Todo file changed",
                    notice,
                )),
                // The write happened, but the session moved on: reread before anything else.
                Err(error) => Accepted::Recover(failed(error.to_string())),
            }
        }
        Err(error @ CoreError::WriteUnconfirmed { .. }) => {
            Accepted::Recover(failed(error.to_string()))
        }
        Err(error) => Accepted::Done(failed(error.to_string())),
    }
}

const FAILED: &str = "Could not update Todo item";

/// Today's local calendar date.
pub fn local_today() -> TodoDate {
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();
    TodoDate::parse(&today).expect("chrono formats a valid YYYY-MM-DD date")
}
