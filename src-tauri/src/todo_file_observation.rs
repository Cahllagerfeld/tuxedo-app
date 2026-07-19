use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub const TODO_FILE_CHANGED_EVENT: &str = "todo-file-changed";

/// Brief settle time so atomic save replace flickers do not emit spuriously.
const OBSERVATION_DEBOUNCE: Duration = Duration::from_millis(250);

struct ObservationSession {
    stop_tx: mpsc::Sender<()>,
    _watcher: RecommendedWatcher,
}

pub struct TodoFileObservation {
    session: Mutex<Option<ObservationSession>>,
}

impl TodoFileObservation {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }

    pub fn start(&self, app: AppHandle, path: PathBuf) -> Result<(), String> {
        self.stop();

        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(Path::to_path_buf)
            .ok_or_else(|| "Todo file path has no parent directory to observe".to_string())?;

        let (event_tx, event_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = mpsc::channel();

        let mut watcher = RecommendedWatcher::new(
            move |result| {
                if let Ok(event) = result {
                    let _ = event_tx.send(event);
                }
            },
            notify::Config::default(),
        )
        .map_err(|error| error.to_string())?;

        watcher
            .watch(&parent, RecursiveMode::NonRecursive)
            .map_err(|error| error.to_string())?;

        let watched_path = path.clone();
        thread::spawn(move || {
            run_observation_loop(app, watched_path, event_rx, stop_rx);
        });

        *self
            .session
            .lock()
            .map_err(|_| "Todo-file observation lock poisoned".to_string())? =
            Some(ObservationSession {
                stop_tx,
                _watcher: watcher,
            });

        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut session) = self.session.lock() {
            if let Some(active) = session.take() {
                let _ = active.stop_tx.send(());
            }
        }
    }
}

fn run_observation_loop(
    app: AppHandle,
    watched_path: PathBuf,
    event_rx: mpsc::Receiver<notify::Event>,
    stop_rx: mpsc::Receiver<()>,
) {
    let mut pending_emit_at: Option<Instant> = None;

    loop {
        let timeout = pending_emit_at
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(60));

        match event_rx.recv_timeout(timeout) {
            Ok(event) => {
                if event_targets_watched_path(&event, &watched_path) {
                    pending_emit_at = Some(Instant::now() + OBSERVATION_DEBOUNCE);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if pending_emit_at.is_some_and(|deadline| Instant::now() >= deadline) {
                    pending_emit_at = None;
                    let _ = app.emit(TODO_FILE_CHANGED_EVENT, ());
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        if stop_rx.try_recv().is_ok() {
            break;
        }
    }
}

fn event_targets_watched_path(event: &notify::Event, watched_path: &Path) -> bool {
    match event.kind {
        EventKind::Access(_) => return false,
        EventKind::Any
        | EventKind::Create(_)
        | EventKind::Modify(_)
        | EventKind::Remove(_)
        | EventKind::Other => {}
    }

    event.paths.iter().any(|path| paths_refer_to_same_file(path, watched_path))
}

fn paths_refer_to_same_file(left: &Path, right: &Path) -> bool {
    left == right
        || left.file_name().is_some_and(|name| {
            name == right.file_name().unwrap_or_default()
                && left.parent() == right.parent()
        })
}

#[tauri::command]
pub(crate) fn start_todo_file_observation(
    app: AppHandle,
    observation: State<'_, TodoFileObservation>,
    path: String,
) -> Result<(), String> {
    observation.start(app, PathBuf::from(path))
}

#[tauri::command]
pub(crate) fn stop_todo_file_observation(
    observation: State<'_, TodoFileObservation>,
) -> Result<(), String> {
    observation.stop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::Event;

    #[test]
    fn ignores_access_only_noise_for_the_watched_todo_file() {
        let watched = PathBuf::from("/tmp/todo.txt");
        let event = Event {
            kind: EventKind::Access(notify::event::AccessKind::Any),
            paths: vec![watched.clone()],
            attrs: Default::default(),
        };
        assert!(!event_targets_watched_path(&event, &watched));
    }

    #[test]
    fn matches_modify_events_for_the_watched_todo_file() {
        let watched = PathBuf::from("/tmp/todo.txt");
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from("/tmp/todo.txt")],
            attrs: Default::default(),
        };
        assert!(event_targets_watched_path(&event, &watched));
    }

    #[test]
    fn ignores_sibling_files_in_the_same_directory() {
        let watched = PathBuf::from("/tmp/todo.txt");
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from("/tmp/other.txt")],
            attrs: Default::default(),
        };
        assert!(!event_targets_watched_path(&event, &watched));
    }
}
