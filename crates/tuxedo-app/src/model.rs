//! The retained session entity. Views hold its handle and read projections from it.

use std::path::PathBuf;

use gpui_kit::*;
use tuxedo_core::{CoreError, TodoWriteResult, Workspace, WorkspaceSession, WorkspaceSnapshot};

use crate::command_queue::{Command, CommandQueue};
use crate::session::{self, Restored};
use crate::todo_commands;

pub enum SessionState {
    Restoring,
    Unavailable(String),
    Ready(Box<WorkspaceSession>),
}

pub struct SessionModel {
    state: SessionState,
    /// Why the Active workspace is not loaded (Empty state), from restoration.
    warning: Option<String>,
    /// Workspace operation failure from the last switch; cleared by the next one.
    error: Option<String>,
    /// The Workspace being opened; the current one stays displayed until it loads.
    pending: Option<String>,
    /// The latest request. Replacing it drops the previous Task, so a stale load is never accepted.
    task: Option<Task<()>>,
    /// Where the catalogue lives; every write command rereads it. `None` when it has no location.
    catalogue_path: Option<PathBuf>,
    /// Write commands, run one at a time in admission order.
    commands: CommandQueue,
}

impl SessionModel {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self::restore_from(session::catalogue_path(), cx)
    }

    /// Workspace session restoration from the catalogue at `path`.
    pub fn restore_from(path: Option<PathBuf>, cx: &mut Context<Self>) -> Self {
        let catalogue_path = path.clone();
        let load = cx.background_spawn(async move { session::restore(path.as_deref()) });
        let task = cx.spawn(async move |this, cx| {
            let restored = load.await;
            this.update(cx, |model, cx| {
                match restored {
                    Restored::Unavailable(error) => model.state = SessionState::Unavailable(error),
                    Restored::Ready { session, warning } => {
                        model.state = SessionState::Ready(session);
                        model.warning = warning;
                    }
                }
                cx.notify();
            })
            .ok();
        });
        Self {
            state: SessionState::Restoring,
            warning: None,
            error: None,
            pending: None,
            task: Some(task),
            catalogue_path,
            commands: CommandQueue::default(),
        }
    }

    pub fn state(&self) -> &SessionState {
        &self.state
    }

    fn session(&self) -> Option<&WorkspaceSession> {
        match &self.state {
            SessionState::Ready(session) => Some(session),
            _ => None,
        }
    }

    /// The session revision Todo targets are captured against.
    pub fn revision(&self) -> Option<u64> {
        self.session().map(|s| s.revision())
    }

    #[allow(dead_code, reason = "read by the Undo control, landing next in #253")]
    pub fn can_undo(&self) -> bool {
        self.session().is_some_and(|s| s.can_undo())
    }

    /// Whether every admitted write command has finished (normal quit waits for this).
    #[allow(dead_code, reason = "read by the quit drain, landing next in #253")]
    pub fn commands_drained(&self) -> bool {
        self.commands.is_drained()
    }

    pub fn workspaces(&self) -> &[Workspace] {
        match &self.state {
            SessionState::Ready(session) => &session.catalogue().workspaces,
            _ => &[],
        }
    }

    pub fn selected(&self) -> Option<&WorkspaceSnapshot> {
        match &self.state {
            SessionState::Ready(session) => session.selected(),
            _ => None,
        }
    }

    pub fn warning(&self) -> Option<&str> {
        self.warning.as_deref()
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn pending(&self) -> Option<&str> {
        self.pending.as_deref()
    }

    /// Switches the Active workspace in memory once its Todo file has loaded on the background
    /// executor. A failed switch keeps the current Workspace and reports the error.
    pub fn select(&mut self, workspace_id: &str, cx: &mut Context<Self>) {
        let SessionState::Ready(session) = &self.state else {
            return;
        };
        if session
            .selected()
            .is_some_and(|s| s.workspace.id == workspace_id)
        {
            // Returning to the displayed Workspace cancels a pending switch and ends any failure.
            self.pending = None;
            self.error = None;
            self.task = None;
            cx.notify();
            return;
        }
        let request = match session.prepare_open(workspace_id) {
            Ok(request) => request,
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
                return;
            }
        };
        self.error = None;
        self.pending = Some(workspace_id.to_owned());
        cx.notify();

        let load = cx.background_spawn(async move { request.load() });
        self.task = Some(cx.spawn(async move |this, cx| {
            let result = load.await;
            this.update(cx, |model, cx| {
                model.pending = None;
                match (result, &mut model.state) {
                    (Ok(snapshot), SessionState::Ready(session)) => {
                        session.accept(snapshot);
                        model.warning = None;
                    }
                    (Err(error), _) => model.error = Some(error.to_string()),
                    _ => {}
                }
                cx.notify();
            })
            .ok();
        }));
    }
}

impl SessionModel {
    /// Admits a write command; it runs after every command admitted before it.
    pub fn enqueue(&mut self, command: Command, cx: &mut Context<Self>) {
        self.commands.admit(command);
        self.run_next(cx);
    }

    /// Starts queued commands until one is running or the queue is empty. A command that fails
    /// while being prepared reports its error and lets the next one start.
    fn run_next(&mut self, cx: &mut Context<Self>) {
        while let Some(command) = self.commands.dequeue() {
            match self.start(command, cx) {
                Ok(task) => {
                    self.commands.start(task);
                    return;
                }
                Err(error) => self.report(Err(error)),
            }
            cx.notify();
        }
    }

    /// Prepares a dequeued command against the current session and runs its background step.
    fn start(&mut self, command: Command, cx: &mut Context<Self>) -> Result<Task<()>, CoreError> {
        let (Some(session), Some(catalogue_path)) = (self.session(), &self.catalogue_path) else {
            return Err(CoreError::InvalidCommand {
                message: "No Workspace session is available.".to_owned(),
            });
        };
        // Workspace commands (#258) dispatch here once they join `Command`.
        let request = todo_commands::prepare(
            session,
            catalogue_path,
            command,
            todo_commands::local_today(),
        )?;
        let execute = cx.background_spawn(async move { request.execute() });
        Ok(cx.spawn(async move |this, cx| {
            let result = execute.await;
            this.update(cx, |model, cx| {
                model.accept_todo_write(result);
                model.commands.accept();
                model.run_next(cx);
                cx.notify();
            })
            .ok();
        }))
    }

    /// Foreground acceptance of a Todo-file command's background result.
    fn accept_todo_write(&mut self, result: Result<TodoWriteResult, CoreError>) {
        let accepted = match (result, &mut self.state) {
            (Ok(result), SessionState::Ready(session)) => {
                let notice = result.notice.clone();
                session.accept_todo_write(result).map(|_| notice)
            }
            (Ok(_), _) => return,
            (Err(error), _) => Err(error),
        };
        self.report(accepted);
    }

    /// Shows a command's outcome: its error, or its notice when it has one.
    fn report(&mut self, outcome: Result<Option<String>, CoreError>) {
        self.error = match outcome {
            Ok(notice) => notice,
            Err(error) => Some(error.to_string()),
        };
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::{Path, PathBuf};

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{AppContext as _, Entity, TestAppContext};

    use super::SessionModel;

    pub(crate) const A: &str = "0b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const B: &str = "1b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    pub(crate) const C: &str = "2b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const MISSING: &str = "3b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

    /// A catalogue with Workspaces A, B, C (readable) and MISSING (no Todo file); A is active.
    pub(crate) fn catalogue(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tuxedo-app-model-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let workspace = |id: &str, label: &str, file: &Path| {
            serde_json::json!({
                "id": id, "name": label, "color": "blue", "todo_path": file,
                "created_at": "2026-11-05T00:00:00.000Z",
            })
        };
        let mut workspaces = Vec::new();
        for (id, label) in [(A, "A"), (B, "B"), (C, "C")] {
            let file = dir.join(format!("{label}.txt"));
            std::fs::write(&file, format!("Task in {label}\n")).unwrap();
            workspaces.push(workspace(id, label, &file));
        }
        workspaces.push(workspace(MISSING, "Missing", &dir.join("missing.txt")));
        let path = dir.join("workspaces.json");
        let json =
            serde_json::json!({ "version": 1, "active_workspace_id": A, "workspaces": workspaces });
        std::fs::write(&path, json.to_string()).unwrap();
        path
    }

    fn restored(name: &str, cx: &mut TestAppContext) -> Entity<SessionModel> {
        let path = catalogue(name);
        let model = cx.new(|cx| SessionModel::restore_from(Some(path), cx));
        cx.run_until_parked();
        model
    }

    fn selected_id(model: &Entity<SessionModel>, cx: &mut TestAppContext) -> Option<String> {
        model.read_with(cx, |m, _| m.selected().map(|s| s.workspace.id.clone()))
    }

    #[gpui::test(iterations = 20)]
    fn only_the_latest_of_overlapping_switches_is_accepted(cx: &mut TestAppContext) {
        let model = restored("latest", cx);
        assert_eq!(selected_id(&model, cx).as_deref(), Some(A));

        model.update(cx, |m, cx| {
            m.select(B, cx);
            m.select(C, cx);
        });
        cx.run_until_parked();

        assert_eq!(selected_id(&model, cx).as_deref(), Some(C));
        model.read_with(cx, |m, _| {
            assert!(m.pending().is_none() && m.error().is_none())
        });
    }

    #[gpui::test]
    fn failed_switch_keeps_the_previous_selection_until_reselected(cx: &mut TestAppContext) {
        let model = restored("failed", cx);

        model.update(cx, |m, cx| m.select(MISSING, cx));
        cx.run_until_parked();
        assert_eq!(selected_id(&model, cx).as_deref(), Some(A));
        model.read_with(cx, |m, _| {
            assert!(m.error().is_some() && m.pending().is_none())
        });

        model.update(cx, |m, cx| m.select(A, cx));
        model.read_with(cx, |m, _| assert!(m.error().is_none()));
    }
}
