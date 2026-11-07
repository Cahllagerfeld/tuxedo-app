//! Todo-file observation: watching the Active workspace's Todo file for external changes.
//!
//! A watch only produces change signals; the session model debounces them and runs the
//! authoritative read through its command queue (see `model.rs`). Signals are hints, never
//! replayed: any event that could concern the file (including rescans and watcher errors) asks
//! for one reconciling read.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use notify::{EventKind, RecursiveMode, Watcher};

/// How long signals must be quiet before the file is read, as in the Electron app.
pub const DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(250);

/// An active watch: its change signals, and the guard that ends the watch when dropped.
pub struct Watching {
    pub signals: async_channel::Receiver<()>,
    pub guard: Box<dyn Send>,
}

/// Starts watching a Todo file. Blocking; the model calls it on the background executor.
/// Replaced in tests by an injected signal source.
pub type Watch = Arc<dyn Fn(&Path) -> Result<Watching, String> + Send + Sync>;

/// The app's watch. Unit tests never touch native watchers: each signal there is injected.
pub fn default_watch() -> Watch {
    if cfg!(test) {
        Arc::new(|_| {
            let (_, signals) = async_channel::bounded(1);
            Ok(Watching {
                signals,
                guard: Box::new(()),
            })
        })
    } else {
        watch_todo_file()
    }
}

/// Watches the Todo file's directory (non-recursively), so atomic replacements by Tuxedo or
/// another editor, which swap the file's inode, keep being seen.
pub fn watch_todo_file() -> Watch {
    Arc::new(|path| {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
        // FSEvents reports canonical paths (such as /private/var for /var).
        let parent = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        let name = path.file_name().map(ToOwned::to_owned);
        // One pending signal is enough: a full channel already asks for a read.
        let (sender, signals) = async_channel::bounded(1);
        let watched = parent.clone();
        let mut watcher = notify::recommended_watcher(move |event| {
            if concerns(&event, &watched, name.as_deref()) {
                let _ = sender.try_send(());
            }
        })
        .map_err(|error| error.to_string())?;
        watcher
            .watch(&parent, RecursiveMode::NonRecursive)
            .map_err(|error| error.to_string())?;
        Ok(Watching {
            signals,
            guard: Box::new(watcher),
        })
    })
}

/// Whether a directory event may concern the Todo file named `name`: an event for it (either
/// end of a rename), for the directory itself, without paths, a rescan, or a watcher error.
fn concerns(event: &notify::Result<notify::Event>, parent: &Path, name: Option<&OsStr>) -> bool {
    let Ok(event) = event else {
        return true;
    };
    if event.need_rescan() {
        return true;
    }
    !matches!(event.kind, EventKind::Access(_))
        && (event.paths.is_empty()
            || event
                .paths
                .iter()
                .any(|p| p.file_name() == name || p.parent() != Some(parent)))
}

/// The Todo file being observed: a new target means a new watch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub workspace_id: String,
    pub path: PathBuf,
}
