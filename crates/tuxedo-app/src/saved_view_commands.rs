//! Saved-view commands (save, delete, and reloading a file that could not be read): the family's
//! `prepare`/`accept` for the command queue. They write only the saved-views file.

use std::path::PathBuf;

use tuxedo_core::{
    read_saved_views, CoreError, SavedView, SavedViewChange, SavedViewWriteRequest,
    SavedViewWriteResult, SavedViews, WorkspaceSession,
};

use crate::command_queue::{Accepted, Outcome, OutcomeKind};

/// A queued Saved-view command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SavedViewCommand {
    Change(SavedViewChange),
    /// Rereads the file, for Retry after it could not be read.
    Reload,
}

impl SavedViewCommand {
    /// Saves `query` under `name` for the Workspace, with a fresh UUID.
    pub fn create(workspace_id: String, name: String, query: String) -> Self {
        Self::Change(SavedViewChange::Create {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id,
            name,
            query,
        })
    }

    pub fn delete(id: String) -> Self {
        Self::Change(SavedViewChange::Delete { id })
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Change(SavedViewChange::Create { .. }) => "save view",
            Self::Change(SavedViewChange::Delete { .. }) => "delete saved view",
            Self::Reload => "reload saved views",
        }
    }
}

/// A prepared command's background step.
pub enum SavedViewRequest {
    /// The write and the file it rereads when the write is refused or unconfirmed.
    Write(SavedViewWriteRequest, PathBuf),
    Read(PathBuf),
}

/// What the background step produced. A failed read is a result to install, not an error.
pub enum SavedViewExecuted {
    Written(SavedViewWriteResult),
    Read(Result<Vec<SavedView>, CoreError>),
    /// The file changed on disk or the write could not be confirmed; `reread` is what the file
    /// holds now. Only the saved-views file is reread: the catalogue and Undo are unaffected.
    Refused {
        error: CoreError,
        reread: Result<Vec<SavedView>, CoreError>,
    },
}

impl SavedViewRequest {
    pub fn execute(self) -> Result<SavedViewExecuted, CoreError> {
        match self {
            Self::Write(request, path) => match request.execute() {
                Ok(result) => Ok(SavedViewExecuted::Written(result)),
                Err(error @ (CoreError::StaleCommand | CoreError::WriteUnconfirmed { .. })) => {
                    let reread = read_saved_views(&path);
                    Ok(SavedViewExecuted::Refused { error, reread })
                }
                Err(error) => Err(error),
            },
            Self::Read(path) => Ok(SavedViewExecuted::Read(read_saved_views(&path))),
        }
    }
}

/// Prepares a dequeued command against the confirmed saved views and the session as they are
/// now.
pub fn prepare(
    views: &SavedViews,
    session: &WorkspaceSession,
    command: SavedViewCommand,
) -> Result<SavedViewRequest, CoreError> {
    match command {
        SavedViewCommand::Change(change) => {
            let request = views.prepare(session, change)?;
            Ok(SavedViewRequest::Write(request, views.path().to_path_buf()))
        }
        SavedViewCommand::Reload => Ok(SavedViewRequest::Read(views.path().to_path_buf())),
    }
}

/// Installs a result, or reports why the command failed. A refused or unconfirmed write installs
/// the saved-views file's reread from the same background step; only a result that cannot be
/// accepted asks the queue for recovery, whose reread includes the saved views.
pub fn accept(views: &mut SavedViews, result: Result<SavedViewExecuted, CoreError>) -> Accepted {
    match result {
        Ok(SavedViewExecuted::Written(result)) => match views.accept(result) {
            // The changed sidebar section is the outcome.
            Ok(()) => Accepted::Done(Outcome::new(OutcomeKind::Applied, "Saved views", None)),
            Err(error) => Accepted::Recover(Outcome::new(
                OutcomeKind::Failed,
                "Saved views changed, but the screen is out of date",
                Some(format!("{error} Reloading the saved views.")),
            )),
        },
        Ok(SavedViewExecuted::Read(read)) => {
            views.accept_reread(read);
            match views.error() {
                None => Accepted::Done(Outcome::new(OutcomeKind::Applied, "Saved views", None)),
                Some(error) => Accepted::Done(Outcome::new(
                    OutcomeKind::Failed,
                    "Saved views unavailable",
                    Some(error.to_owned()),
                )),
            }
        }
        Ok(SavedViewExecuted::Refused { error, reread }) => {
            views.accept_reread(reread);
            Accepted::Done(match error {
                CoreError::StaleCommand => Outcome::new(
                    OutcomeKind::Conflict,
                    "Saved views changed",
                    Some(
                        "The saved views changed outside Tuxedo and were reloaded. Nothing was saved."
                            .into(),
                    ),
                ),
                error => Outcome::new(
                    OutcomeKind::Failed,
                    "Saved view change not confirmed",
                    Some(format!("{error} The saved views were reloaded.")),
                ),
            })
        }
        Err(error) => Accepted::Done(Outcome::new(
            OutcomeKind::Failed,
            "Saved view not saved",
            Some(error.to_string()),
        )),
    }
}
