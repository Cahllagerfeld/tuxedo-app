//! The retained session entity. Views hold its handle and read projections from it.
//!
//! Write commands run through one [`CommandQueue`], Workspace switches included: a switch loads
//! and persists the Active workspace in admission order, so the last choice is what ends up both
//! displayed and persisted, and no read accepts across a command.
//!
//! Todo-file observation shares that queue: debounced change signals mark the observed file
//! dirty, and one authoritative read runs once no command is running or queued, so it never
//! overlaps a command and signals received during one are applied after it.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use gpui_kit::*;
use tuxedo_core::{
    read_saved_views, saved_views_path, CoreError, Observed, SavedViews, Workspace,
    WorkspaceChange, WorkspaceSession, WorkspaceSnapshot,
};

use crate::command_queue::{Accepted, Command, CommandQueue, Outcome, OutcomeKind, TodoCommand};
use crate::observation::{self, Target, Watch, Watching};
use crate::saved_view_commands;
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
    /// The confirmed saved views, next to the catalogue; `None` until restored.
    saved_views: Option<SavedViews>,
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
    /// Starts a Todo-file watch (replaced in tests by an injected signal source).
    watch: Watch,
    /// The Active workspace's Todo-file observation, while a Workspace is shown.
    observer: Option<Observer>,
    /// Advances whenever observation is retargeted or stopped; older signals are ignored.
    observation_generation: u64,
    /// A debounced change signal awaits its read; cleared when that read starts.
    observe_dirty: bool,
    /// The last read found the file missing; the next read confirms or ends that.
    observe_missing: bool,
    /// Set by native termination: no new watch starts.
    observation_closed: bool,
    /// Stopped watches, retained until their owners have released them.
    retiring: Vec<WatchOwner>,
    /// Quitting waits here for stopped watches to be released.
    release_wait: Option<Task<()>>,
    _release: Subscription,
}

/// One observed Todo file: its watch and the tasks forwarding and debouncing its signals.
struct Observer {
    target: Target,
    generation: u64,
    /// Closing it tells the owner to release the watch.
    stop: async_channel::Sender<()>,
    owner: WatchOwner,
    /// Forwards the watch's signals once it is acquired.
    _listen: Task<()>,
    /// The pending debounce; replacing it restarts the delay.
    debounce: Option<Task<()>>,
}

/// The background task that acquires a native watch, holds it, and releases it when stopped.
struct WatchOwner {
    task: Task<()>,
    /// Closes once the watch has been released (or never started).
    released: async_channel::Receiver<()>,
}

impl SessionModel {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self::restore_importing(session::catalogue_path(), session::electron_data_dir(), cx)
    }

    /// Workspace session restoration from the catalogue at `path`, without an import (tests).
    #[cfg(test)]
    pub fn restore_from(path: Option<PathBuf>, cx: &mut Context<Self>) -> Self {
        Self::restore_importing(path, None, cx)
    }

    /// Workspace session restoration from the catalogue at `path`, first importing the Electron
    /// app's data from `import_from` when the catalogue's folder has none (see
    /// [`session::restore`]).
    fn restore_importing(
        path: Option<PathBuf>,
        import_from: Option<PathBuf>,
        cx: &mut Context<Self>,
    ) -> Self {
        let catalogue_path = path.clone();
        let load = cx.background_spawn(async move {
            // Restoration runs first: the import may write the saved views read next.
            let restored = session::restore(path.as_deref(), import_from.as_deref());
            let views = path
                .as_deref()
                .map(|p| SavedViews::load(saved_views_path(p)));
            (restored, views)
        });
        let task = cx.spawn(async move |this, cx| {
            let (restored, views) = load.await;
            this.update(cx, |model, cx| {
                match restored {
                    Restored::Unavailable(error) => model.state = SessionState::Unavailable(error),
                    Restored::Ready {
                        session,
                        warning,
                        notices,
                    } => {
                        model.state = SessionState::Ready(session);
                        model.warning = warning;
                        model.outcomes.extend(notices);
                        model.saved_views = views;
                    }
                }
                model.sync_observation(cx);
                cx.notify();
            })
            .ok();
        });
        // Native termination (Dock > Quit, logout) cannot be delayed beyond GPUI's short shutdown
        // timeout, and windows are already gone by then: stop observing and wait only for a
        // running write's background step and the watches' release, best effort. Quit Tuxedo
        // (Cmd-Q) drains the queue properly instead.
        let in_flight = Arc::new(AtomicBool::new(false));
        let app_quit = cx.on_app_quit({
            let in_flight = in_flight.clone();
            move |model, cx| {
                model.observation_closed = true;
                model.sync_observation(cx);
                let released = model.watches_released();
                let (in_flight, executor) = (in_flight.clone(), cx.background_executor().clone());
                async move {
                    while in_flight.load(Ordering::Acquire) {
                        executor.timer(Duration::from_millis(5)).await;
                    }
                    released.await;
                }
            }
        });
        // Releasing the model stops its watch; the owner finishes the release in the background.
        let release = cx.on_release(|model: &mut Self, _| {
            if let Some(observer) = model.observer.take() {
                model.retire(observer);
            }
            for owner in model.retiring.drain(..) {
                owner.task.detach();
            }
        });
        Self {
            state: SessionState::Restoring,
            warning: None,
            pending: None,
            _restore: task,
            catalogue_path,
            saved_views: None,
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
            watch: observation::default_watch(),
            observer: None,
            observation_generation: 0,
            observe_dirty: false,
            observe_missing: false,
            observation_closed: false,
            retiring: Vec::new(),
            release_wait: None,
            _release: release,
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

    /// The saved views, once restored with a catalogue location.
    pub fn saved_views(&self) -> Option<&SavedViews> {
        self.saved_views.as_ref()
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
        self.sync_observation(cx);
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
            self.quit_when_released(cx);
        } else if self.observe_dirty && self.recovery == Recovery::Confirmed {
            self.start_observed_read(cx);
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
            (None, _) if self.release_wait.is_some() => "releasing Todo-file watches",
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
                    Ok(request) => Ok(self.run(
                        move || request.execute(),
                        in_session(todo_commands::accept),
                        cx,
                    )),
                    Err(error) => {
                        Err(self.accept_failure(in_session(todo_commands::accept), error))
                    }
                }
            }
            Command::Workspace(command) => {
                match workspace_commands::prepare(session, &catalogue_path, command) {
                    Ok(request) => Ok(self.run(
                        move || request.execute(),
                        in_session(workspace_commands::accept),
                        cx,
                    )),
                    Err(error) => {
                        Err(self.accept_failure(in_session(workspace_commands::accept), error))
                    }
                }
            }
            Command::SavedView(command) => {
                let Some(views) = &self.saved_views else {
                    return Err(Outcome::new(
                        OutcomeKind::Failed,
                        "Saved view not saved",
                        Some("Saved views are not available.".into()),
                    ));
                };
                match saved_view_commands::prepare(views, session, command) {
                    Ok(request) => Ok(self.run(move || request.execute(), in_saved_views, cx)),
                    Err(error) => Err(self.accept_failure(in_saved_views, error)),
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
        accept: impl FnOnce(&mut SessionModel, Result<R, CoreError>) -> Accepted,
        error: CoreError,
    ) -> Outcome {
        match accept(self, Err(error)) {
            Accepted::Done(outcome) | Accepted::Recover(outcome) => outcome,
        }
    }

    /// Runs `execute` on the background executor, then `accept` on the foreground, and only then
    /// frees the queue (or pauses it for recovery).
    fn run<R: Send + 'static>(
        &mut self,
        execute: impl FnOnce() -> Result<R, CoreError> + Send + 'static,
        accept: impl FnOnce(&mut SessionModel, Result<R, CoreError>) -> Accepted + 'static,
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
                let accepted = accept(model, result);
                match accepted {
                    Accepted::Done(outcome) => {
                        if outcome.kind == OutcomeKind::Applied {
                            // A committed change replaces restoration's warning: it explains the
                            // Empty state only when this result left nothing displayed.
                            model.warning = outcome
                                .message
                                .clone()
                                .filter(|_| model.selected().is_none());
                        }
                        model.outcomes.push_back(outcome)
                    }
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

    /// Rereads the catalogue, the selected Todo file, and the saved views and accepts them as
    /// confirmed (clearing Undo) before any further command runs. Never resubmits the command
    /// that needed it. Saved views that cannot be read are shown as unavailable, not a failure.
    fn start_recovery(&mut self, cx: &mut Context<Self>) {
        let request = match (self.session(), self.catalogue_path.as_deref()) {
            (Some(session), Some(path)) => session.prepare_reread(path),
            _ => return self.finish_recovery(Err("No Workspace session is available.".into()), cx),
        };
        let views_path = self.saved_views.as_ref().map(|v| v.path().to_path_buf());
        let reread = cx.background_spawn(async move {
            let views = views_path.map(|path| read_saved_views(&path));
            (request.execute(), views)
        });
        let task = cx.spawn(async move |this, cx| {
            let (result, views) = reread.await;
            this.update(cx, |model, cx| {
                if let (Some(saved), Some(read)) = (&mut model.saved_views, views) {
                    saved.accept_reread(read);
                }
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
            Ok(()) => {
                self.recovery = Recovery::Confirmed;
                if self.selected().is_some() {
                    self.warning = None;
                }
            }
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

/// Todo-file observation.
impl SessionModel {
    /// Watches the shown Workspace's Todo file, keeping the watch across same-file revisions and
    /// replacing it when the shown Todo file changes. Stops in the Empty state and when quitting.
    fn sync_observation(&mut self, cx: &mut Context<Self>) {
        let target = self
            .selected()
            .filter(|_| !self.quitting && !self.observation_closed)
            .map(|selected| Target {
                workspace_id: selected.workspace.id.clone(),
                path: selected.workspace.todo_file.clone(),
            });
        if self.observer.as_ref().map(|o| &o.target) == target.as_ref() {
            return;
        }
        // Invalidate first, so nothing the old watch still delivers is accepted.
        self.observation_generation += 1;
        self.observe_dirty = false;
        self.observe_missing = false;
        if let Some(old) = self.observer.take() {
            self.retire(old);
        }
        let Some(target) = target else {
            return;
        };
        let generation = self.observation_generation;
        let (ready, acquired) = async_channel::bounded(1);
        let (stop, stopped) = async_channel::bounded::<()>(1);
        let (done, released) = async_channel::bounded::<()>(1);
        let (watch, path) = (self.watch.clone(), target.path.clone());
        // The native watch lives and ends in this background task, never on the UI thread:
        // stopping it may wait for the watcher's own thread.
        let task = cx.background_spawn(async move {
            let _done = done;
            match watch(&path) {
                Ok(Watching { signals, guard }) => {
                    let _ = ready.send(Ok(signals)).await;
                    // Returns once `stop` is closed.
                    let _ = stopped.recv().await;
                    drop(guard);
                }
                Err(error) => {
                    let _ = ready.send(Err(error)).await;
                }
            }
        });
        let listen = cx.spawn(async move |this, cx| {
            let signals = match acquired.recv().await {
                Ok(Ok(signals)) => signals,
                // Best effort: the Workspace stays usable without observation.
                Ok(Err(error)) => {
                    eprintln!("tuxedo: could not observe the Todo file: {error}");
                    return;
                }
                Err(_) => return,
            };
            // Reconcile once: the file may have changed since it was loaded.
            let mut forwarded = this.update(cx, |model, cx| model.signal(generation, cx));
            while forwarded.is_ok() && signals.recv().await.is_ok() {
                forwarded = this.update(cx, |model, cx| model.signal(generation, cx));
            }
        });
        self.observer = Some(Observer {
            target,
            generation,
            stop,
            owner: WatchOwner { task, released },
            _listen: listen,
            debounce: None,
        });
    }

    /// Stops a watch and retains its owner until the watch is released.
    fn retire(&mut self, observer: Observer) {
        observer.stop.close();
        self.retiring.retain(|owner| !owner.task.is_ready());
        self.retiring.push(observer.owner);
    }

    /// Completes once every stopped watch has been released.
    fn watches_released(&self) -> impl std::future::Future<Output = ()> + 'static {
        let released: Vec<_> = self.retiring.iter().map(|o| o.released.clone()).collect();
        async move {
            for watch in released {
                let _ = watch.recv().await;
            }
        }
    }

    /// Quitting with the queue drained: waits for every stopped watch's release, then quits.
    fn quit_when_released(&mut self, cx: &mut Context<Self>) {
        self.retiring.retain(|owner| !owner.task.is_ready());
        if self.release_wait.is_none() && !self.retiring.is_empty() {
            let released = self.watches_released();
            self.release_wait = Some(cx.spawn(async move |this, cx| {
                released.await;
                this.update(cx, |model, cx| {
                    model.retiring.clear();
                    // This task is finishing; its handle has nothing left to cancel.
                    if let Some(finishing) = model.release_wait.take() {
                        finishing.detach();
                    }
                    model.run_next(cx);
                })
                .ok();
            }));
        }
        if self.release_wait.is_none() && self.quit_deadline.take().is_some() {
            (self.quit_app)(cx);
        }
    }

    fn observer_mut(&mut self, generation: u64) -> Option<&mut Observer> {
        self.observer
            .as_mut()
            .filter(|observer| observer.generation == generation)
    }

    /// A change signal for the watch of `generation`: (re)starts the debounce, after which the
    /// file is marked dirty and read as soon as the queue allows.
    fn signal(&mut self, generation: u64, cx: &mut Context<Self>) {
        let Some(observer) = self.observer_mut(generation) else {
            return;
        };
        observer.debounce = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(observation::DEBOUNCE).await;
            this.update(cx, |model, cx| {
                if model.observer_mut(generation).is_some() {
                    model.observe_dirty = true;
                    model.run_next(cx);
                }
            })
            .ok();
        }));
    }

    /// Reads the observed Todo file in the queue's running slot and accepts what it shows.
    /// Signals arriving meanwhile mark the file dirty again for another read. A read that finds
    /// nothing changed publishes nothing.
    fn start_observed_read(&mut self, cx: &mut Context<Self>) {
        self.observe_dirty = false;
        let confirming = std::mem::take(&mut self.observe_missing);
        let Some(request) = self.session().and_then(|s| s.prepare_observe()) else {
            return;
        };
        let request = if confirming {
            request.confirming_absence()
        } else {
            request
        };
        let generation = self.observation_generation;
        let read = cx.background_spawn(async move { request.execute() });
        let task = cx.spawn(async move |this, cx| {
            let result = read.await;
            this.update(cx, |model, cx| {
                let SessionState::Ready(session) = &mut model.state else {
                    unreachable!("observation runs only with a session");
                };
                let changed = match session.accept_observed(result) {
                    Observed::Unchanged | Observed::Stale => false,
                    // Perhaps an editor between deleting and saving: read once more after
                    // another debounce before the absence counts.
                    Observed::Missing => {
                        if model.observer_mut(generation).is_some() {
                            model.observe_missing = true;
                            model.signal(generation, cx);
                        }
                        false
                    }
                    Observed::Changed { notice } => {
                        if let Some(notice) = notice {
                            let outcome =
                                Outcome::new(OutcomeKind::Applied, notice, Some(notice.into()));
                            model.outcomes.push_back(outcome);
                        }
                        true
                    }
                    Observed::Unavailable { warning } => {
                        model.warning = Some(warning);
                        true
                    }
                };
                model.commands.accept();
                model.run_next(cx);
                if changed || !model.outcomes.is_empty() || model.close_ready() {
                    cx.notify();
                }
            })
            .ok();
        });
        self.commands.start(task, "Todo-file observation");
    }
}

/// A Todo-file or Workspace family's acceptance, which installs into the core session.
fn in_session<R>(
    accept: fn(&mut WorkspaceSession, Result<R, CoreError>) -> Accepted,
) -> impl FnOnce(&mut SessionModel, Result<R, CoreError>) -> Accepted {
    move |model, result| match &mut model.state {
        SessionState::Ready(session) => accept(session, result),
        _ => unreachable!("commands start only with a session"),
    }
}

/// The Saved-view family's acceptance, which installs into the confirmed saved views.
fn in_saved_views(
    model: &mut SessionModel,
    result: Result<saved_view_commands::SavedViewExecuted, CoreError>,
) -> Accepted {
    let views = model
        .saved_views
        .as_mut()
        .expect("prepared with saved views");
    saved_view_commands::accept(views, result)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::cell::Cell;
    use std::path::{Path, PathBuf};
    use std::rc::Rc;
    use std::sync::{Arc, Mutex};

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{AppContext as _, BackgroundExecutor, Entity, TestAppContext};

    use std::time::Duration;

    use super::{SessionModel, QUIT_DEADLINE};
    use crate::command_queue::{Accepted, Command, Outcome, OutcomeKind, TodoCommand};
    use crate::observation::{Watch, Watching, DEBOUNCE};
    use crate::todo_commands;
    use tuxedo_core::{WorkspaceChange, WorkspaceSession};

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

        // Restoring into the Empty state warns about the unopenable Active workspace; a successful
        // switch ends that warning, and removing the then-active Workspace does not bring it back.
        let text = std::fs::read_to_string(&catalogue).unwrap();
        let active = format!(r#""active_workspace_id": "{B}""#);
        let missing = format!(r#""active_workspace_id": "{MISSING}""#);
        std::fs::write(&catalogue, text.replace(&active, &missing)).unwrap();
        let model = cx.new(|cx| SessionModel::restore_from(Some(catalogue.clone()), cx));
        cx.run_until_parked();
        model.read_with(cx, |m, _| assert!(m.warning().is_some()));
        model.update(cx, |m, cx| m.select(C, cx));
        cx.run_until_parked();
        assert_eq!(selected_id(&model, cx).as_deref(), Some(C));
        let delete = WorkspaceChange::Delete { id: C.into() };
        model.update(cx, |m, cx| m.enqueue(Command::Workspace(delete), cx));
        cx.run_until_parked();
        assert_eq!(selected_id(&model, cx), None);
        model.read_with(cx, |m, _| assert_eq!(m.warning(), None));
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
            // Quitting waits for the Todo-file watch to be released.
            m.quit_app = |_| QUIT.with(|q| q.set(RELEASES.with(|r| r.get()) > 0));
            m.exit_process = |code| EXIT.with(|e| e.set(Some(code)));
        };
        QUIT.with(|q| q.set(false));
        EXIT.with(|e| e.set(None));
        RELEASES.with(|r| r.set(0));
        let (watch, watches) = injected_watch(cx);
        let todo = catalogue("quit").with_file_name("A.txt");
        std::fs::write(&todo, "First\n").unwrap();
        let model = observed(&todo.with_file_name("workspaces.json"), watch, cx);
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
        assert!(QUIT.with(|q| q.get()), "quit after the watch was released");
        assert_eq!(*watches.lock().unwrap()[0].2.lock().unwrap(), Some(false));
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

        // With nothing queued, quitting still waits for the watch's release.
        let (watch, watches) = injected_watch(cx);
        let model = observed(&catalogue("quit-idle"), watch, cx);
        RELEASES.with(|r| r.set(0));
        model.update(cx, |m, cx| {
            hooks(m);
            m.request_quit(cx);
        });
        assert!(!QUIT.with(|q| q.get()));
        cx.run_until_parked();
        assert!(QUIT.with(|q| q.get()), "quit after the watch was released");
        assert_eq!(*watches.lock().unwrap()[0].2.lock().unwrap(), Some(false));
    }

    thread_local! {
        /// Watches released on this test's thread (the test scheduler runs every task here).
        static RELEASES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }

    /// A test watch's guard. On release it records whether that happened on the UI thread.
    struct Released {
        on_main_thread: Arc<Mutex<Option<bool>>>,
        executor: BackgroundExecutor,
    }

    impl Drop for Released {
        fn drop(&mut self) {
            *self.on_main_thread.lock().unwrap() = Some(self.executor.is_main_thread());
            RELEASES.with(|r| r.set(r.get() + 1));
        }
    }

    /// Each watch's path, its signal sender, and where it was released (`Some(false)`: off the
    /// UI thread).
    type Watches = Arc<Mutex<Vec<(PathBuf, async_channel::Sender<()>, Arc<Mutex<Option<bool>>>)>>>;

    /// An injected signal source: records each watch so the test can signal and inspect it.
    fn injected_watch(cx: &TestAppContext) -> (Watch, Watches) {
        let watches = Watches::default();
        let recorded = watches.clone();
        let executor = cx.executor();
        let watch: Watch = Arc::new(move |path| {
            let (sender, signals) = async_channel::bounded(1);
            let on_main_thread = Arc::new(Mutex::new(None));
            let entry = (path.to_owned(), sender, on_main_thread.clone());
            recorded.lock().unwrap().push(entry);
            Ok(Watching {
                signals,
                guard: Box::new(Released {
                    on_main_thread,
                    executor: executor.clone(),
                }),
            })
        });
        (watch, watches)
    }

    /// Restores from `catalogue` with `watch` as the signal source.
    fn observed(catalogue: &Path, watch: Watch, cx: &mut TestAppContext) -> Entity<SessionModel> {
        let model = cx.new(|cx| {
            let mut model = SessionModel::restore_from(Some(catalogue.to_owned()), cx);
            model.watch = watch;
            model
        });
        cx.run_until_parked();
        model
    }

    #[gpui::test]
    fn observed_changes_wait_for_commands_and_follow_the_shown_workspace(cx: &mut TestAppContext) {
        let (watch, watches) = injected_watch(cx);
        let catalogue = catalogue("observe");
        let todo = catalogue.with_file_name("A.txt");
        std::fs::write(&todo, "First\nSecond\n").unwrap();
        let model = observed(&catalogue, watch, cx);
        let notified = Rc::new(Cell::new(0));
        let _counting = cx.update(|cx| {
            let notified = notified.clone();
            cx.observe(&model, move |_, _| notified.set(notified.get() + 1))
        });
        let signal = |index: usize| {
            let _ = watches.lock().unwrap()[index].1.try_send(());
        };
        let released = |index: usize| *watches.lock().unwrap()[index].2.lock().unwrap();
        let settle = |cx: &mut TestAppContext| {
            cx.executor().advance_clock(DEBOUNCE);
            cx.run_until_parked();
        };
        let source = |cx: &mut TestAppContext| {
            model.read_with(cx, |m, _| m.selected().map(|s| s.file.source.clone()))
        };
        settle(cx); // The reconciling read after the watch starts finds nothing new.
        assert_eq!(watches.lock().unwrap()[0].0, todo);
        assert!(kinds(&model, cx).is_empty());

        // Tuxedo's own write signals too, but its bytes are already confirmed: no notice, no
        // publication (so no projection pass), and Undo and the revision survive.
        let command = complete(&model, 1, cx);
        model.update(cx, |m, cx| m.enqueue(command, cx));
        cx.run_until_parked();
        assert_eq!(kinds(&model, cx), [OutcomeKind::Applied]);
        let (revision, notifications) = (model.read_with(cx, |m, _| m.revision()), notified.get());
        signal(0);
        settle(cx);
        assert!(kinds(&model, cx).is_empty());
        assert_eq!(notified.get(), notifications, "an unchanged read is silent");
        model.read_with(cx, |m, _| {
            assert_eq!(m.revision(), revision);
            assert_eq!(m.undo_label(), Some("Undo completion"));
        });

        // A change signalled while a command runs is read only after that command finishes.
        model.update(cx, |m, cx| m.enqueue(Command::Held, cx));
        std::fs::write(&todo, "Third\n").unwrap();
        signal(0);
        settle(cx);
        assert!(
            source(cx).unwrap().starts_with("x "),
            "not read during the command"
        );
        model.update(cx, |m, cx| {
            m.commands.accept();
            m.run_next(cx);
        });
        cx.run_until_parked();
        assert_eq!(source(cx).as_deref(), Some("Third\n"));
        let outcomes = model.update(cx, |m, _| m.take_outcomes());
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].message.as_deref(), Some("Todo file reloaded"));
        model.read_with(cx, |m, _| assert_eq!(m.undo_label(), None));

        // Signals are debounced: each one restarts the 250 ms delay.
        std::fs::write(&todo, "Fourth\n").unwrap();
        for _ in 0..2 {
            signal(0);
            cx.run_until_parked();
            cx.executor()
                .advance_clock(DEBOUNCE - Duration::from_millis(1));
            cx.run_until_parked();
            assert_eq!(source(cx).as_deref(), Some("Third\n"));
        }
        cx.executor().advance_clock(Duration::from_millis(1));
        cx.run_until_parked();
        assert_eq!(source(cx).as_deref(), Some("Fourth\n"));
        kinds(&model, cx);

        // A Workspace switch releases A's watch off the UI thread and starts B's; A's late
        // signals change nothing.
        model.update(cx, |m, cx| m.select(B, cx));
        cx.run_until_parked();
        settle(cx);
        assert_eq!(released(0), Some(false));
        let b = todo.with_file_name("B.txt");
        assert_eq!(watches.lock().unwrap()[1].0, b);
        kinds(&model, cx);
        std::fs::write(&todo, "Ignored\n").unwrap();
        signal(0);
        settle(cx);
        assert_eq!(source(cx).as_deref(), Some("Task in B\n"));
        assert!(kinds(&model, cx).is_empty());

        // A file missing for one read stays displayed and is read again after another debounce:
        // recreated by then, its new contents are shown.
        std::fs::remove_file(&b).unwrap();
        signal(1);
        settle(cx);
        assert_eq!(source(cx).as_deref(), Some("Task in B\n"));
        assert!(kinds(&model, cx).is_empty());
        std::fs::write(&b, "Recreated in B\n").unwrap();
        settle(cx);
        assert_eq!(source(cx).as_deref(), Some("Recreated in B\n"));
        assert_eq!(kinds(&model, cx), [OutcomeKind::Applied]);

        // Still missing on the second read: the Empty state with a warning, and watching ends.
        std::fs::remove_file(&b).unwrap();
        signal(1);
        settle(cx);
        assert!(source(cx).is_some() && released(1).is_none());
        settle(cx);
        assert_eq!(source(cx), None);
        model.read_with(cx, |m, _| assert!(m.warning().unwrap().contains("B.txt")));
        assert_eq!(released(1), Some(false));
        assert_eq!(watches.lock().unwrap().len(), 2);

        // Releasing the model releases its watch off the UI thread too.
        let (watch, watches) = injected_watch(cx);
        let model = observed(&super::tests::catalogue("observe-release"), watch, cx);
        assert_eq!(*watches.lock().unwrap()[0].2.lock().unwrap(), None);
        drop(model);
        cx.update(|_| {}); // Released entities are dropped when effects flush.
        cx.run_until_parked();
        assert_eq!(*watches.lock().unwrap()[0].2.lock().unwrap(), Some(false));
    }
}
