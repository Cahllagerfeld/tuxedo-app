//! The retained session entity. Views hold its handle and read projections from it.
//!
//! Write commands run through one [`CommandQueue`]. Pure reads (a Workspace switch's load) are
//! replaceable: admitting a command cancels a pending read and a read generation guards its
//! acceptance, so no read accepts across a command. A switch requested while commands are
//! queued waits for them and then loads, so the last choice is what ends up displayed.

use std::collections::VecDeque;
use std::path::PathBuf;

use gpui_kit::*;
use tuxedo_core::{CoreError, Workspace, WorkspaceSession, WorkspaceSnapshot};

use crate::command_queue::{Accepted, Command, CommandQueue, Outcome, OutcomeKind, TodoCommand};
use crate::session::{self, Restored};
use crate::todo_commands;

pub enum SessionState {
    Restoring,
    Unavailable(String),
    Ready(Box<WorkspaceSession>),
}

/// Whether write commands may run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Recovery {
    /// The session holds the confirmed state.
    Confirmed,
    /// The disk may differ from the session; reread before running another command.
    Needed,
    /// The reread failed; commands fail until a later admission retries it.
    Failed,
}

pub struct SessionModel {
    state: SessionState,
    /// Why the Active workspace is not loaded (Empty state), from restoration.
    warning: Option<String>,
    /// Workspace operation failure from the last switch; cleared by the next one.
    error: Option<String>,
    /// The Workspace being opened; the current one stays displayed until it loads.
    pending: Option<String>,
    /// Startup restoration.
    _restore: Task<()>,
    /// The pending pure read. Replacing or dropping it cancels the load.
    read: Option<Task<()>>,
    /// Advances whenever a pending read is invalidated; a read accepts only at its generation.
    read_generation: u64,
    /// A switch requested while commands were queued; it loads once they have finished.
    deferred_select: Option<String>,
    /// Where the catalogue lives; every write command rereads it. `None` when it has no location.
    catalogue_path: Option<PathBuf>,
    /// Write commands, run one at a time in admission order.
    commands: CommandQueue,
    recovery: Recovery,
    /// Every command's outcome, until the UI presents it.
    outcomes: VecDeque<Outcome>,
    /// The window asked to close while commands were still admitted.
    close_requested: bool,
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
            _restore: task,
            read: None,
            read_generation: 0,
            deferred_select: None,
            catalogue_path,
            commands: CommandQueue::default(),
            recovery: Recovery::Confirmed,
            outcomes: VecDeque::new(),
            close_requested: false,
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

    /// The Undo control's label while Undo is available.
    pub fn undo_label(&self) -> Option<&str> {
        self.session().and_then(|s| s.undo_label())
    }

    /// Whether the window may close now. Otherwise the close is remembered and
    /// [`Self::close_ready`] turns true once every admitted command has finished.
    pub fn request_close(&mut self) -> bool {
        self.close_requested = !self.commands.is_drained();
        !self.close_requested
    }

    pub fn close_ready(&self) -> bool {
        self.close_requested && self.commands.is_drained()
    }

    /// Hands the outcomes not yet presented to the UI.
    pub fn take_outcomes(&mut self) -> Vec<Outcome> {
        self.outcomes.drain(..).collect()
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
    /// executor. A failed switch keeps the current Workspace and reports the error. While write
    /// commands are queued, the switch waits for them.
    pub fn select(&mut self, workspace_id: &str, cx: &mut Context<Self>) {
        let SessionState::Ready(session) = &self.state else {
            return;
        };
        if session
            .selected()
            .is_some_and(|s| s.workspace.id == workspace_id)
        {
            // Returning to the displayed Workspace cancels a pending switch and ends any failure.
            self.cancel_read();
            self.deferred_select = None;
            self.pending = None;
            self.error = None;
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
        if !self.commands.is_drained() {
            self.cancel_read();
            self.deferred_select = Some(workspace_id.to_owned());
            return;
        }

        self.cancel_read();
        let generation = self.read_generation;
        let load = cx.background_spawn(async move { request.load() });
        self.read = Some(cx.spawn(async move |this, cx| {
            let result = load.await;
            this.update(cx, |model, cx| {
                if model.read_generation != generation {
                    return;
                }
                model.read = None;
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

    /// Cancels the pending pure read; a load that already finished cannot accept either.
    fn cancel_read(&mut self) {
        self.read = None;
        self.read_generation += 1;
    }
}

impl SessionModel {
    /// Admits a write command; it runs after every command admitted before it. A pending switch
    /// is cancelled and resumes once the queue has drained.
    pub fn enqueue(&mut self, command: Command, cx: &mut Context<Self>) {
        if self.read.is_some() {
            self.deferred_select = self.pending.clone();
        }
        self.cancel_read();
        if self.recovery == Recovery::Failed {
            self.recovery = Recovery::Needed;
        }
        self.commands.admit(command);
        self.run_next(cx);
        cx.notify();
    }

    /// Undo for the displayed Workspace, when it has an Undo step.
    pub fn undo(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session().filter(|s| s.can_undo()) else {
            return;
        };
        let workspace_id = session.selected().map(|s| s.workspace.id.clone());
        let revision = session.revision();
        if let Some(workspace_id) = workspace_id {
            let command = TodoCommand::Undo {
                workspace_id,
                revision,
            };
            self.enqueue(Command::Todo(command), cx);
        }
    }

    /// Runs the next step: a needed recovery first, then queued commands in order. A command that
    /// fails while being prepared reports its outcome and lets the next one start. Once the queue
    /// has drained, a deferred switch loads.
    fn run_next(&mut self, cx: &mut Context<Self>) {
        if self.commands.is_running() {
            return;
        }
        match self.recovery {
            Recovery::Needed => return self.start_recovery(cx),
            Recovery::Failed => {
                for _ in self.commands.take_pending() {
                    self.outcomes.push_back(Outcome::new(
                        OutcomeKind::Failed,
                        "Changes are paused",
                        Some("The Todo file could not be reloaded after an unconfirmed change; nothing was written.".into()),
                    ));
                }
            }
            Recovery::Confirmed => {
                while let Some(command) = self.commands.dequeue() {
                    match self.start(command, cx) {
                        Ok(task) => return self.commands.start(task),
                        Err(outcome) => self.outcomes.push_back(outcome),
                    }
                }
            }
        }
        if let Some(id) = self.deferred_select.take() {
            self.select(&id, cx);
        }
    }

    /// Prepares a dequeued command against the current session and runs its background step.
    /// Each command family plugs in here with its own prepare and accept.
    fn start(&mut self, command: Command, cx: &mut Context<Self>) -> Result<Task<()>, Outcome> {
        let (Some(session), Some(catalogue_path)) = (self.session(), self.catalogue_path.clone())
        else {
            return Err(Outcome::new(
                OutcomeKind::Failed,
                "Could not run the command",
                Some("No Workspace session is available.".into()),
            ));
        };
        match command {
            Command::Todo(command) => {
                let today = todo_commands::local_today();
                match todo_commands::prepare(session, &catalogue_path, command, today) {
                    Ok(request) => {
                        Ok(self.run(move || request.execute(), todo_commands::accept, cx))
                    }
                    Err(error) => Err(self.accept_failure(todo_commands::accept, error)),
                }
            }
            #[cfg(test)]
            Command::Scripted(accepted) => Ok(self.run(
                move || Ok(accepted),
                |_, result: Result<Accepted, CoreError>| result.unwrap(),
                cx,
            )),
        }
    }

    /// A family's preparation failure, reported through its own acceptance.
    fn accept_failure<R>(
        &mut self,
        accept: fn(&mut WorkspaceSession, Result<R, CoreError>) -> Accepted,
        error: CoreError,
    ) -> Outcome {
        let SessionState::Ready(session) = &mut self.state else {
            unreachable!("commands start only with a session");
        };
        match accept(session, Err(error)) {
            Accepted::Done(outcome) | Accepted::Recover(outcome) => outcome,
        }
    }

    /// Runs `execute` on the background executor, then `accept` on the foreground, and only then
    /// frees the queue (or pauses it for recovery).
    fn run<R: Send + 'static>(
        &mut self,
        execute: impl FnOnce() -> Result<R, CoreError> + Send + 'static,
        accept: fn(&mut WorkspaceSession, Result<R, CoreError>) -> Accepted,
        cx: &mut Context<Self>,
    ) -> Task<()> {
        let execute = cx.background_spawn(async move { execute() });
        cx.spawn(async move |this, cx| {
            let result = execute.await;
            this.update(cx, |model, cx| {
                let accepted = match &mut model.state {
                    SessionState::Ready(session) => accept(session, result),
                    _ => unreachable!("commands start only with a session"),
                };
                match accepted {
                    Accepted::Done(outcome) => model.outcomes.push_back(outcome),
                    Accepted::Recover(outcome) => {
                        model.outcomes.push_back(outcome);
                        model.recovery = Recovery::Needed;
                    }
                }
                model.commands.accept();
                model.run_next(cx);
                cx.notify();
            })
            .ok();
        })
    }

    /// Rereads the catalogue and the selected Todo file and accepts them as confirmed (clearing
    /// Undo) before any further command runs. Never resubmits the command that needed it.
    fn start_recovery(&mut self, cx: &mut Context<Self>) {
        let request = match (self.session(), self.catalogue_path.as_deref()) {
            (Some(session), Some(path)) => session.prepare_reread(path),
            _ => return self.finish_recovery(Err("No Workspace session is available.".into()), cx),
        };
        let reread = cx.background_spawn(async move { request.execute() });
        let task = cx.spawn(async move |this, cx| {
            let result = reread.await;
            this.update(cx, |model, cx| {
                let result = match (result, &mut model.state) {
                    (Ok(result), SessionState::Ready(session)) => {
                        session.accept_reread(result);
                        Ok(())
                    }
                    (Ok(_), _) => Err("No Workspace session is available.".to_owned()),
                    (Err(error), _) => Err(error.to_string()),
                };
                model.commands.accept();
                model.finish_recovery(result, cx);
            })
            .ok();
        });
        self.commands.start(task);
    }

    fn finish_recovery(&mut self, result: Result<(), String>, cx: &mut Context<Self>) {
        match result {
            Ok(()) => self.recovery = Recovery::Confirmed,
            Err(error) => {
                self.recovery = Recovery::Failed;
                self.outcomes.push_back(Outcome::new(
                    OutcomeKind::Failed,
                    "Could not reload the Todo file",
                    Some(error),
                ));
            }
        }
        self.run_next(cx);
        cx.notify();
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::{Path, PathBuf};

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{AppContext as _, Entity, TestAppContext};

    use super::SessionModel;
    use crate::command_queue::{Accepted, Command, Outcome, OutcomeKind, TodoCommand};
    use crate::todo_commands;

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
        restored_with(name, "Task in A\n", cx).0
    }

    /// Restores with Workspace A's Todo file holding `contents`; returns the model and that file.
    fn restored_with(
        name: &str,
        contents: &str,
        cx: &mut TestAppContext,
    ) -> (Entity<SessionModel>, PathBuf) {
        let path = catalogue(name);
        let todo = path.with_file_name("A.txt");
        std::fs::write(&todo, contents).unwrap();
        let model = cx.new(|cx| SessionModel::restore_from(Some(path), cx));
        cx.run_until_parked();
        (model, todo)
    }

    /// A completion command for the displayed item on physical line `line`.
    fn complete(model: &Entity<SessionModel>, line: u32, cx: &mut TestAppContext) -> Command {
        model.read_with(cx, |m, _| {
            let selected = m.selected().unwrap();
            let item = selected
                .file
                .items
                .iter()
                .find(|i| i.line_number == line)
                .unwrap();
            Command::Todo(TodoCommand::Complete {
                target: todo_commands::target(selected, m.revision().unwrap(), item),
                completed: !item.completed,
            })
        })
    }

    fn kinds(model: &Entity<SessionModel>, cx: &mut TestAppContext) -> Vec<OutcomeKind> {
        model.update(cx, |m, _| {
            m.take_outcomes().into_iter().map(|o| o.kind).collect()
        })
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

    #[gpui::test]
    fn queued_commands_run_in_order_and_a_stale_one_fails_visibly(cx: &mut TestAppContext) {
        let (model, todo) = restored_with("todo-todo", "First\nSecond\n", cx);
        // Both targets are captured at the same revision; the second is stale once the first
        // has been accepted, and fails instead of being retargeted.
        let (first, second) = (complete(&model, 1, cx), complete(&model, 2, cx));
        model.update(cx, |m, cx| {
            m.enqueue(first, cx);
            m.enqueue(second, cx);
            assert!(!m.request_close(), "closing waits for admitted commands");
        });
        cx.run_until_parked();

        assert_eq!(
            kinds(&model, cx),
            [OutcomeKind::Applied, OutcomeKind::Failed]
        );
        let disk = std::fs::read_to_string(&todo).unwrap();
        assert!(
            disk.starts_with("x ") && disk.ends_with("\nSecond\n"),
            "{disk}"
        );
        model.read_with(cx, |m, _| {
            assert!(m.close_ready());
            assert_eq!(m.undo_label(), Some("Undo completion"));
        });

        // Undo runs through the same queue and restores the file.
        model.update(cx, |m, cx| m.undo(cx));
        cx.run_until_parked();
        assert_eq!(kinds(&model, cx), [OutcomeKind::Applied]);
        assert_eq!(std::fs::read_to_string(&todo).unwrap(), "First\nSecond\n");
    }

    #[gpui::test]
    fn recovery_rereads_before_the_next_command_and_a_failed_reread_blocks_writes(
        cx: &mut TestAppContext,
    ) {
        let (model, todo) = restored_with("recovery", "First\n", cx);
        let unconfirmed = Outcome::new(OutcomeKind::Failed, "unconfirmed", None);
        let queued = complete(&model, 1, cx);
        // The write the unconfirmed command made, which the session never saw.
        std::fs::write(&todo, "Changed elsewhere\n").unwrap();
        model.update(cx, |m, cx| {
            m.enqueue(
                Command::Scripted(Accepted::Recover(unconfirmed.clone())),
                cx,
            );
            m.enqueue(queued, cx);
        });
        cx.run_until_parked();
        // The reread shows the disk; the command admitted before it is stale and writes nothing.
        assert_eq!(
            kinds(&model, cx),
            [OutcomeKind::Failed, OutcomeKind::Failed]
        );
        model.read_with(cx, |m, _| {
            assert_eq!(m.selected().unwrap().file.source, "Changed elsewhere\n")
        });
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            "Changed elsewhere\n"
        );

        // A failed reread fails every pending command; the next admission retries it first.
        let catalogue = todo.with_file_name("workspaces.json");
        let saved = std::fs::read(&catalogue).unwrap();
        std::fs::write(&catalogue, "{ not json").unwrap();
        let queued = complete(&model, 1, cx);
        model.update(cx, |m, cx| {
            m.enqueue(Command::Scripted(Accepted::Recover(unconfirmed)), cx);
            m.enqueue(queued, cx);
        });
        cx.run_until_parked();
        assert_eq!(
            kinds(&model, cx),
            [
                OutcomeKind::Failed,
                OutcomeKind::Failed,
                OutcomeKind::Failed
            ]
        );
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            "Changed elsewhere\n"
        );

        std::fs::write(&catalogue, saved).unwrap();
        let retry = complete(&model, 1, cx);
        model.update(cx, |m, cx| m.enqueue(retry, cx));
        cx.run_until_parked();
        assert_eq!(kinds(&model, cx), [OutcomeKind::Applied]);
        assert!(std::fs::read_to_string(&todo).unwrap().starts_with("x "));
    }

    #[gpui::test(iterations = 10)]
    fn a_command_cancels_a_pending_switch_which_loads_after_the_queue_drains(
        cx: &mut TestAppContext,
    ) {
        let (model, todo) = restored_with("read-cancel", "First\n", cx);
        let command = complete(&model, 1, cx);
        model.update(cx, |m, cx| {
            m.select(B, cx);
            // B's load may already have finished; it must not accept across the command.
            m.enqueue(command, cx);
            assert_eq!(m.pending(), Some(B));
        });
        cx.run_until_parked();

        assert_eq!(kinds(&model, cx), [OutcomeKind::Applied]);
        assert!(std::fs::read_to_string(&todo).unwrap().starts_with("x "));
        assert_eq!(selected_id(&model, cx).as_deref(), Some(B));

        // A switch requested while a command is queued waits for it; the last choice wins.
        let command = complete(&model, 1, cx);
        model.update(cx, |m, cx| {
            m.enqueue(command, cx);
            m.select(C, cx);
            m.select(A, cx);
        });
        cx.run_until_parked();
        assert_eq!(selected_id(&model, cx).as_deref(), Some(A));
        model.read_with(cx, |m, _| assert!(m.pending().is_none()));
    }
}
