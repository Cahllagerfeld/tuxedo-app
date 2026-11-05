//! Workspace commands (create, update, delete, select): building them from the person's input
//! and the family's `prepare`/`accept` for the command queue.

use std::path::{Path, PathBuf};

use tuxedo_core::{
    CoreError, Workspace, WorkspaceChange, WorkspaceColor, WorkspaceSession, WorkspaceWriteRequest,
    WorkspaceWriteResult,
};

use crate::command_queue::{Accepted, Outcome, OutcomeKind};

/// A queued Workspace command: the core's change, with Create's identity already supplied.
pub type WorkspaceCommand = WorkspaceChange;

/// A new Workspace for the chosen Todo file, with a fresh UUID and the current time as its
/// `created_at` (the Electron app's `toISOString` format). Preferences start absent.
pub fn create(name: String, color: WorkspaceColor, todo_file: PathBuf) -> WorkspaceCommand {
    WorkspaceChange::Create {
        workspace: Workspace {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            todo_file,
            color,
            created_at: chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            sort_order: None,
            show_deferred: None,
        },
    }
}

/// Prepares a dequeued Workspace command against the session as it is now. Never refuses a
/// command as stale: Workspace commands name their Workspace by id, not by a revision.
pub fn prepare(
    session: &WorkspaceSession,
    catalogue_path: &Path,
    command: WorkspaceCommand,
) -> Result<WorkspaceWriteRequest, CoreError> {
    session.prepare_workspace_change(catalogue_path, command)
}

/// Installs a Workspace command's result, or reports why it failed. Recovery (an authoritative
/// reread) follows when disk may differ from the session: an unconfirmed write, a result the
/// session could not accept, or a catalogue changed outside the app. Because [`prepare`] never
/// refuses as stale, a [`CoreError::StaleCommand`] here always comes from the background step
/// finding a different catalogue on disk.
pub fn accept(
    session: &mut WorkspaceSession,
    result: Result<WorkspaceWriteResult, CoreError>,
) -> Accepted {
    match result {
        Ok(result) => {
            let warning = result.warning.clone();
            match session.accept_workspace_change(result) {
                // The changed sidebar is the outcome; a warning explains an Empty state.
                Ok(()) => Accepted::Done(Outcome::new(
                    OutcomeKind::Applied,
                    "Workspace saved",
                    warning,
                )),
                Err(error) => Accepted::Recover(Outcome::new(
                    OutcomeKind::Failed,
                    "Workspace saved, but the screen is out of date",
                    Some(format!("{error} Reloading the Workspace catalogue.")),
                )),
            }
        }
        Err(CoreError::StaleCommand) => Accepted::Recover(Outcome::new(
            OutcomeKind::Conflict,
            "Workspace catalogue changed",
            Some(
                "The Workspace catalogue changed outside Tuxedo and was reloaded. Nothing was saved."
                    .into(),
            ),
        )),
        Err(error @ CoreError::WriteUnconfirmed { .. }) => Accepted::Recover(Outcome::new(
            OutcomeKind::Failed,
            "Workspace change not confirmed",
            Some(error.to_string()),
        )),
        Err(error) => Accepted::Done(Outcome::new(
            OutcomeKind::Failed,
            "Workspace not saved",
            Some(error.to_string()),
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tuxedo_core::{load_catalogue, CoreError, WorkspaceChange, WorkspaceSession};

    use super::{accept, prepare};
    use crate::command_queue::{Accepted, OutcomeKind};
    use crate::model::tests::{catalogue, A, C};

    fn session(path: &Path) -> WorkspaceSession {
        let mut session = WorkspaceSession::new(load_catalogue(path).unwrap());
        session.open(A).unwrap();
        session
    }

    type Case<'a> = (
        &'a str,
        Box<dyn Fn(&mut WorkspaceSession) -> Accepted + 'a>,
        (OutcomeKind, bool),
    );

    /// The outcome's kind, and whether the queue pauses for a reread.
    fn verdict(accepted: Accepted) -> (OutcomeKind, bool) {
        match accepted {
            Accepted::Done(outcome) => (outcome.kind, false),
            Accepted::Recover(outcome) => (outcome.kind, true),
        }
    }

    #[test]
    fn only_outcomes_that_may_leave_disk_ahead_of_the_session_recover() {
        let path = catalogue("workspace-accept");
        let select = |id: &str| WorkspaceChange::Select { id: id.into() };
        let cases: Vec<Case> = vec![
            (
                "an applied command",
                Box::new(|s| {
                    let result = prepare(s, &path, select(C)).unwrap().execute();
                    accept(s, result)
                }),
                (OutcomeKind::Applied, false),
            ),
            (
                // Preparation never refuses as stale; its failures leave disk untouched.
                "a preparation failure",
                Box::new(|s| {
                    let error = prepare(s, &path, select("nope")).unwrap_err();
                    accept(s, Err(error))
                }),
                (OutcomeKind::Failed, false),
            ),
            (
                "a catalogue changed outside the app",
                Box::new(|s| {
                    let request = prepare(s, &path, select(C)).unwrap();
                    let text = std::fs::read_to_string(&path).unwrap();
                    std::fs::write(&path, text.replace("\"B\"", "\"Elsewhere\"")).unwrap();
                    let result = request.execute();
                    assert!(matches!(result, Err(CoreError::StaleCommand)));
                    accept(s, result)
                }),
                (OutcomeKind::Conflict, true),
            ),
            (
                "an unconfirmed write",
                Box::new(|s| {
                    let source = std::io::Error::other("fsync failed");
                    let error = CoreError::WriteUnconfirmed {
                        path: path.clone(),
                        source,
                    };
                    accept(s, Err(error))
                }),
                (OutcomeKind::Failed, true),
            ),
            (
                "an executed result the session moved past",
                Box::new(|s| {
                    let result = prepare(s, &path, select(C)).unwrap().execute();
                    s.open(C).unwrap();
                    accept(s, result)
                }),
                (OutcomeKind::Failed, true),
            ),
        ];
        let saved = std::fs::read(&path).unwrap();
        for (label, run, expected) in cases {
            std::fs::write(&path, &saved).unwrap();
            let mut session = session(&path);
            assert_eq!(verdict(run(&mut session)), expected, "{label}");
        }
    }
}
