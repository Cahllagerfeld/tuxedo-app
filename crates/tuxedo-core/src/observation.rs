//! Todo-file observation: accepting the selected Todo file's disk contents after a change signal.
//!
//! Like every session operation it runs in three steps: a foreground
//! [`WorkspaceSession::prepare_observe`] that captures the selected Workspace and the confirmed
//! bytes without I/O, a background [`ObserveRequest::execute`] that reads the file, and a
//! foreground [`WorkspaceSession::accept_observed`] that decides what the read means.
//!
//! The confirmed bytes are what Tuxedo last read or wrote, so a signal caused by Tuxedo's own
//! write finds exactly those bytes on disk and changes nothing. Only the Todo file is reread: the
//! catalogue is not observed, and observation never changes it.

use std::path::Path;

use crate::{parse_todo_text, CoreError, TodoFile, Workspace, WorkspaceSession, WorkspaceSnapshot};

/// The info notice for a refreshed Todo file whose parsed contents changed (Electron wording).
pub const TODO_FILE_RELOADED: &str = "Todo file reloaded";

/// A pending read of the selected Todo file. Owns everything the background step needs.
#[derive(Debug, Clone)]
pub struct ObserveRequest {
    workspace: Workspace,
    revision: u64,
    /// The confirmed source the read is compared with before anything is parsed.
    confirmed: String,
}

/// What [`ObserveRequest::execute`] read, ready for [`WorkspaceSession::accept_observed`].
#[derive(Debug)]
pub struct ObserveResult {
    workspace: Workspace,
    revision: u64,
    read: Read,
}

#[derive(Debug)]
enum Read {
    /// The file holds the confirmed bytes; nothing was parsed.
    Unchanged,
    Changed(TodoFile),
    Failed(CoreError),
}

/// What accepting an observed read did to the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observed {
    /// The file holds the confirmed bytes: nothing changed, Undo and the revision are kept.
    Unchanged,
    /// The file's new contents are confirmed; the revision advanced and Undo was cleared.
    /// `notice` is set when the parsed Todo items or skipped lines changed, not only bytes such
    /// as line endings.
    Changed { notice: Option<&'static str> },
    /// The file cannot be read: the session entered the Empty state (Undo cleared) and `warning`
    /// says why. Observation of this Workspace ends.
    Unavailable { warning: String },
    /// The session moved on since the read was prepared; nothing was accepted.
    Stale,
}

impl WorkspaceSession {
    /// Foreground step: the read to run for a change signal, or `None` when no Workspace is
    /// shown (the Empty state observes nothing). Performs no I/O.
    pub fn prepare_observe(&self) -> Option<ObserveRequest> {
        self.selected.as_ref().map(|selected| ObserveRequest {
            workspace: selected.workspace.clone(),
            revision: self.revision,
            confirmed: selected.file.source.clone(),
        })
    }

    /// Foreground step: accepts an observed read of the selected Todo file. Same bytes change
    /// nothing; other contents become the confirmed snapshot; a read failure enters the Empty
    /// state. A read prepared against another Workspace or revision is [`Observed::Stale`].
    pub fn accept_observed(&mut self, result: ObserveResult) -> Observed {
        let Some(current) = self.selected.as_ref().filter(|s| {
            s.workspace.id == result.workspace.id
                && s.workspace.todo_file == result.workspace.todo_file
                && self.revision == result.revision
        }) else {
            return Observed::Stale;
        };
        match result.read {
            Read::Unchanged => Observed::Unchanged,
            Read::Changed(file) => {
                let parsed_changed =
                    file.items != current.file.items || file.skipped != current.file.skipped;
                self.replace_selected(Some(WorkspaceSnapshot {
                    summary: file.summary(),
                    workspace: current.workspace.clone(),
                    file,
                }));
                Observed::Changed {
                    notice: parsed_changed.then_some(TODO_FILE_RELOADED),
                }
            }
            Read::Failed(error) => {
                self.replace_selected(None);
                Observed::Unavailable {
                    warning: error.to_string(),
                }
            }
        }
    }
}

impl ObserveRequest {
    /// The Todo file to observe.
    pub fn path(&self) -> &Path {
        &self.workspace.todo_file
    }

    /// Background step: reads the Todo file and parses it only when its bytes differ from the
    /// confirmed source. Touches no session state.
    pub fn execute(self) -> ObserveResult {
        let path = &self.workspace.todo_file;
        let read = match std::fs::read(path) {
            Ok(bytes) if bytes == self.confirmed.as_bytes() => Read::Unchanged,
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(text) => Read::Changed(parse_todo_text(path.clone(), &text)),
                Err(_) => Read::Failed(CoreError::InvalidUtf8 { path: path.clone() }),
            },
            Err(source) => Read::Failed(CoreError::Io {
                path: path.clone(),
                source,
            }),
        };
        ObserveResult {
            read,
            workspace: self.workspace,
            revision: self.revision,
        }
    }
}
