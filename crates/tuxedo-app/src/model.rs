//! The retained session entity. Views hold its handle and read projections from it.
//!
//! Write commands run through one [`CommandQueue`], Workspace switches included: a switch loads
//! and persists the Active workspace in admission order, so the last choice is what ends up both
//! displayed and persisted, and no read accepts across a command.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use gpui_kit::*;
use tuxedo_core::{CoreError, Workspace, WorkspaceChange, WorkspaceSession, WorkspaceSnapshot};

use crate::command_queue::{Accepted, Command, CommandQueue, Outcome, OutcomeKind, TodoCommand};
use crate::session::{self, Restored};
use crate::todo_commands;
use crate::workspace_commands;

/// How long Quit waits for admitted commands before exiting with a failure status (as in the
/// Electron app).
const QUIT_DEADLINE: Duration = Duration::from_secs(10);

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
    /// The Workspace being opened; the current one stays displayed until it loads.
    pending: Option<String>,
    /// Startup restoration.
    _restore: Task<()>,
    /// Where the catalogue lives; every write command rereads it. `None` when it has no location.
    catalogue_path: Option<PathBuf>,
    /// Write commands, run one at a time in admission order.
    commands: CommandQueue,
    recovery: Recovery,
    /// Every command's outcome, until the UI presents it.
    outcomes: VecDeque<Outcome>,
    /// The window asked to close while commands were still admitted.
    close_requested: bool,
    /// Quit was requested: admission is closed and the app quits once the queue drains.
    quitting: bool,
    /// Ends the application once quitting has drained the queue (replaced in tests).
    quit_app: fn(&mut App),
    /// Ends the process when quitting exceeds [`QUIT_DEADLINE`] (replaced in tests).
    exit_process: fn(i32),
    /// The quit deadline, running from the first quit request until the queue drains.
    quit_deadline: Option<Task<()>>,
    /// Whether a command's background step is running, for the best-effort native-quit wait.
    in_flight: Arc<AtomicBool>,
    _app_quit: Subscription,
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
        // Native termination (Dock > Quit, logout) cannot be delayed beyond GPUI's short shutdown
        // timeout, and windows are already gone by then: wait only for a running write's
        // background step, best effort. Quit Tuxedo (Cmd-Q) drains the queue properly instead.
        let in_flight = Arc::new(AtomicBool::new(false));
        let app_quit = cx.on_app_quit({
            let in_flight = in_flight.clone();
            move |_, cx| {
                let (in_flight, executor) = (in_flight.clone(), cx.background_executor().clone());
                async move {
                    while in_flight.load(Ordering::Acquire) {
                        executor.timer(Duration::from_millis(5)).await;
                    }
                }
            }
        });
        Self {
            state: SessionState::Restoring,
            warning: None,
            pending: None,
            _restore: task,
            catalogue_path,
            commands: CommandQueue::default(),
            recovery: Recovery::Confirmed,
            outcomes: VecDeque::new(),
            close_requested: false,
            quitting: false,
            quit_app: |cx| cx.quit(),
            exit_process: |code| std::process::exit(code),
            quit_deadline: None,
            in_flight,
            _app_quit: app_quit,
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
        // Restoration's warning explains the Empty state until a Workspace is shown.
        self.warning
            .as_deref()
            .filter(|_| self.selected().is_none())
    }

    pub fn pending(&self) -> Option<&str> {
        self.pending.as_deref()
    }

    /// Queues a switch to `workspace_id`: it loads that Workspace and persists it as the Active
    /// workspace after every command admitted before it, so the last choice is what ends up both
    /// displayed and persisted. A failed switch keeps the current Workspace and reports why.
    pub fn select(&mut self, workspace_id: &str, cx: &mut Context<Self>) {
        if !matches!(self.state, SessionState::Ready(_)) {
            return;
        }
        if !self.quitting {
            self.pending = Some(workspace_id.to_owned());
        }
        let id = workspace_id.to_owned();
        self.enqueue(Command::Workspace(WorkspaceChange::Select { id }), cx);
    }
}

impl SessionModel {
    /// Admits a write command; it runs after every command admitted before it.
    pub fn enqueue(&mut self, command: Command, cx: &mut Context<Self>) {
        if self.quitting {
            self.outcomes.push_back(Outcome::new(
                OutcomeKind::Failed,
                "Tuxedo is quitting",
                Some("Nothing was written.".into()),
            ));
            cx.notify();
            return;
        }
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
    /// fails while being prepared reports its outcome and lets the next one start.
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
                    let name = command.name();
                    match self.start(command, cx) {
                        Ok(task) => return self.commands.start(task, name),
                        Err(outcome) => self.outcomes.push_back(outcome),
                    }
                }
            }
        }
        if self.commands.is_drained() {
            self.pending = None;
        }
        if self.quitting {
            self.quit_deadline = None;
            (self.quit_app)(cx);
        }
    }

    /// Quit Tuxedo: closes admission, lets every admitted command finish through foreground
    /// acceptance (and any recovery), then quits the application. Repeated requests share it.
    pub fn request_quit(&mut self, cx: &mut Context<Self>) {
        if self.quitting {
            return;
        }
        self.quitting = true;
        // A command or reread that never returns must not keep the app open forever.
        self.quit_deadline = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(QUIT_DEADLINE).await;
            this.update(cx, |model, _| model.quit_timed_out()).ok();
        }));
        self.run_next(cx);
    }

    /// Quitting exceeded its deadline: report what is blocked and exit with a failure status. The
    /// running write is neither accepted nor retried.
    fn quit_timed_out(&mut self) {
        let (running, pending) = self.commands.describe();
        let phase = match (running, self.recovery) {
            (Some(_), Recovery::Needed) => "rereading the Todo file after an unconfirmed write",
            (Some(_), _) => "running a command",
            (None, _) => "waiting for queued commands",
        };
        eprintln!(
            "tuxedo: quit timed out after {}s while {phase}; running: {}; pending: [{}]",
            QUIT_DEADLINE.as_secs(),
            running.unwrap_or("none"),
            pending.join(", ")
        );
        (self.exit_process)(1);
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
            Command::Workspace(command) => {
                match workspace_commands::prepare(session, &catalogue_path, command) {
                    Ok(request) => {
                        Ok(self.run(move || request.execute(), workspace_commands::accept, cx))
                    }
                    Err(error) => Err(self.accept_failure(workspace_commands::accept, error)),
                }
            }
            #[cfg(test)]
            Command::Held => Ok(cx.spawn(async |_, _| std::future::pending::<()>().await)),
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
        let in_flight = self.in_flight.clone();
        in_flight.store(true, Ordering::Release);
        let execute = cx.background_spawn(async move {
            let result = execute();
            in_flight.store(false, Ordering::Release);
            result
        });
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
        self.commands.start(task, "recovery reread");
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

    use std::time::Duration;

    use super::{SessionModel, QUIT_DEADLINE};
    use crate::command_queue::{Accepted, Command, Outcome, OutcomeKind, TodoCommand};
    use crate::todo_commands;
    use tuxedo_core::WorkspaceSession;

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
        model.read_with(cx, |m, _| assert!(m.pending().is_none()));
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
    fn queued_switches_persist_the_last_choice_and_a_failed_one_changes_nothing(
        cx: &mut TestAppContext,
    ) {
        let (model, todo) = restored_with("select-queue", "First\n", cx);
        let catalogue = todo.with_file_name("workspaces.json");
        let persisted = || {
            tuxedo_core::load_catalogue(&catalogue)
                .unwrap()
                .active_workspace_id
        };

        // A failed switch keeps the displayed Workspace and the catalogue, and says why.
        let saved = std::fs::read(&catalogue).unwrap();
        model.update(cx, |m, cx| m.select(MISSING, cx));
        cx.run_until_parked();
        assert_eq!(kinds(&model, cx), [OutcomeKind::Failed]);
        assert_eq!(selected_id(&model, cx).as_deref(), Some(A));
        assert_eq!(std::fs::read(&catalogue).unwrap(), saved);

        // Switches run in admission order behind earlier commands: the completion admitted first
        // still targets A, and choosing the displayed A while B is pending ends on A.
        let command = complete(&model, 1, cx);
        model.update(cx, |m, cx| {
            m.enqueue(command, cx);
            m.select(B, cx);
            m.select(A, cx);
            assert_eq!(m.pending(), Some(A));
        });
        cx.run_until_parked();
        assert_eq!(kinds(&model, cx), [OutcomeKind::Applied; 3]);
        assert!(std::fs::read_to_string(&todo).unwrap().starts_with("x "));
        assert_eq!(selected_id(&model, cx).as_deref(), Some(A));
        assert_eq!(persisted().as_deref(), Some(A));

        model.update(cx, |m, cx| {
            m.select(C, cx);
            m.select(B, cx);
        });
        cx.run_until_parked();
        assert_eq!(selected_id(&model, cx).as_deref(), Some(B));
        assert_eq!(persisted().as_deref(), Some(B));
        model.read_with(cx, |m, _| assert!(m.pending().is_none()));
    }

    #[gpui::test]
    fn an_unconfirmed_write_pauses_the_queue_until_its_reread_is_accepted(cx: &mut TestAppContext) {
        let (model, todo) = restored_with("unconfirmed", "First\nSecond\n", cx);
        tuxedo_core::fail_directory_sync(todo.parent().unwrap());
        // Both captured at one revision. Had the second run before the reread, it would apply.
        let (first, second) = (complete(&model, 1, cx), complete(&model, 2, cx));
        model.update(cx, |m, cx| {
            m.enqueue(first, cx);
            m.enqueue(second, cx);
        });
        cx.run_until_parked();

        assert_eq!(
            kinds(&model, cx),
            [OutcomeKind::Failed, OutcomeKind::Failed]
        );
        let disk = std::fs::read_to_string(&todo).unwrap();
        assert!(
            disk.starts_with("x ") && disk.ends_with("\nSecond\n"),
            "{disk}"
        );
        model.read_with(cx, |m, _| {
            assert_eq!(
                m.selected().unwrap().file.source,
                disk,
                "the reread was accepted"
            );
            assert_eq!(m.undo_label(), None);
        });
    }

    #[test]
    fn an_executed_write_whose_result_cannot_be_accepted_needs_recovery() {
        let path = catalogue("guard");
        let mut session = WorkspaceSession::new(tuxedo_core::load_catalogue(&path).unwrap());
        session.open(A).unwrap();
        let selected = session.selected().unwrap();
        let target = todo_commands::target(selected, session.revision(), &selected.file.items[0]);
        let command = TodoCommand::Complete {
            target,
            completed: true,
        };
        let today = todo_commands::local_today();
        let request = todo_commands::prepare(&session, &path, command, today).unwrap();
        let result = request.execute();
        session.open(B).unwrap();
        assert!(matches!(
            todo_commands::accept(&mut session, result),
            Accepted::Recover(_)
        ));
    }

    #[gpui::test]
    fn quitting_closes_admission_and_quits_after_admitted_commands_finish(cx: &mut TestAppContext) {
        thread_local! {
            static QUIT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
            static EXIT: std::cell::Cell<Option<i32>> = const { std::cell::Cell::new(None) };
        }
        let hooks = |m: &mut SessionModel| {
            m.quit_app = |_| QUIT.with(|q| q.set(true));
            m.exit_process = |code| EXIT.with(|e| e.set(Some(code)));
        };
        let (model, todo) = restored_with("quit", "First\n", cx);
        let first = complete(&model, 1, cx);
        let second = Accepted::Done(Outcome::new(OutcomeKind::Applied, "second", None));
        model.update(cx, |m, cx| {
            hooks(m);
            m.enqueue(first, cx);
            m.enqueue(Command::Scripted(second), cx);
            m.request_quit(cx);
            let late = Outcome::new(OutcomeKind::Applied, "late", None);
            m.enqueue(Command::Scripted(Accepted::Done(late)), cx);
        });
        // The first command's execution has not run yet: nothing has finished, so no quit yet.
        assert!(!QUIT.with(|q| q.get()));
        assert_eq!(
            kinds(&model, cx),
            [OutcomeKind::Failed],
            "the late admission is refused"
        );

        // Released before the deadline: both commands are accepted, then the app quits.
        cx.run_until_parked();
        assert!(QUIT.with(|q| q.get()));
        assert_eq!(
            kinds(&model, cx),
            [OutcomeKind::Applied, OutcomeKind::Applied]
        );
        assert!(std::fs::read_to_string(&todo).unwrap().starts_with("x "));
        cx.executor().advance_clock(QUIT_DEADLINE * 2);
        cx.run_until_parked();
        assert_eq!(
            EXIT.with(|e| e.get()),
            None,
            "the deadline ended with the drain"
        );

        // Held past the deadline: the process exits with a failure status instead of quitting.
        QUIT.with(|q| q.set(false));
        let (model, _) = restored_with("quit-held", "First\n", cx);
        model.update(cx, |m, cx| {
            hooks(m);
            m.enqueue(Command::Held, cx);
            m.request_quit(cx);
        });
        cx.run_until_parked();
        cx.executor()
            .advance_clock(QUIT_DEADLINE - Duration::from_millis(1));
        cx.run_until_parked();
        assert_eq!(EXIT.with(|e| e.get()), None);
        cx.executor().advance_clock(Duration::from_millis(1));
        cx.run_until_parked();
        assert_eq!(EXIT.with(|e| e.get()), Some(1));
        assert!(!QUIT.with(|q| q.get()));
    }
}
