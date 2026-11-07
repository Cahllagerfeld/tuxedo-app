//! The Todo-file command family: building targets from displayed Todo items, preparing queued
//! commands against the current session, and accepting their results.

use std::path::Path;
use std::sync::{Arc, Mutex};

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

/// How the editor learns its own command's outcome: filled when the queue accepts the result.
/// A command dropped without one (quitting, paused changes) wrote nothing.
#[derive(Clone, Default)]
pub struct Reply(Arc<Mutex<Option<Replied>>>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Replied {
    Applied,
    Conflict,
    /// Nothing was written.
    Failed,
    /// The write may have happened; the session rereads. Never resubmit.
    Uncertain,
}

impl Reply {
    /// The outcome, `Some(Failed)` when the command was dropped unanswered, or `None` while it
    /// is still admitted.
    pub fn get(&self) -> Option<Replied> {
        let replied = *self.0.lock().expect("reply lock");
        match replied {
            None if Arc::strong_count(&self.0) == 1 => Some(Replied::Failed),
            replied => replied,
        }
    }

    fn set(&self, accepted: &Accepted) {
        let replied = match accepted {
            Accepted::Done(outcome) => match outcome.kind {
                OutcomeKind::Applied => Replied::Applied,
                OutcomeKind::Conflict => Replied::Conflict,
                _ => Replied::Failed,
            },
            Accepted::Recover(_) => Replied::Uncertain,
        };
        *self.0.lock().expect("reply lock") = Some(replied);
    }
}

impl PartialEq for Reply {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for Reply {}

impl std::fmt::Debug for Reply {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Reply")
    }
}

/// A prepared Todo-file command. An editor command carries its reply through the background
/// step, and a preparation failure still reaches acceptance so the editor hears of it.
pub struct TodoRequest {
    request: Result<TodoWriteRequest, CoreError>,
    reply: Option<Reply>,
}

pub struct TodoResult {
    result: Result<TodoWriteResult, CoreError>,
    reply: Option<Reply>,
}

impl TodoRequest {
    /// Background step.
    pub fn execute(self) -> Result<TodoResult, CoreError> {
        Ok(TodoResult {
            result: self.request.and_then(TodoWriteRequest::execute),
            reply: self.reply,
        })
    }
}

/// Foreground: prepares a dequeued Todo-file command against the session as it is now. A command
/// admitted against an older revision or another Workspace is refused as stale.
pub fn prepare(
    session: &WorkspaceSession,
    catalogue_path: &Path,
    command: TodoCommand,
    today: TodoDate,
) -> Result<TodoRequest, CoreError> {
    let plain = |request: Result<TodoWriteRequest, CoreError>| {
        request.map(|request| TodoRequest {
            request: Ok(request),
            reply: None,
        })
    };
    match command {
        TodoCommand::Complete { target, completed } => {
            plain(session.prepare_completion(catalogue_path, target, completed, today))
        }
        TodoCommand::Undo {
            workspace_id,
            revision,
        } => {
            let current = session.selected().map(|s| s.workspace.id.as_str());
            if current != Some(workspace_id.as_str()) || revision != session.revision() {
                return Err(CoreError::StaleCommand);
            }
            plain(session.prepare_undo(catalogue_path))
        }
        TodoCommand::Create {
            workspace_id,
            revision,
            fields,
            reply,
        } => Ok(TodoRequest {
            request: session.prepare_create(catalogue_path, &workspace_id, revision, fields, today),
            reply: Some(reply),
        }),
        TodoCommand::Edit {
            target,
            fields,
            reply,
        } => Ok(TodoRequest {
            request: session.prepare_edit(catalogue_path, target, fields, today),
            reply: Some(reply),
        }),
    }
}

/// Foreground: installs a Todo-file command's result (or reports its failure, including a
/// preparation failure), and answers an editor command's reply.
pub fn accept(session: &mut WorkspaceSession, result: Result<TodoResult, CoreError>) -> Accepted {
    let (result, reply) = match result {
        Ok(TodoResult { result, reply }) => (result, reply),
        Err(error) => (Err(error), None),
    };
    let accepted = accept_write(session, result);
    if let Some(reply) = reply {
        reply.set(&accepted);
    }
    accepted
}

fn accept_write(
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
