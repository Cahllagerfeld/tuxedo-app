//! Workspace session restoration: finds the catalogue the Electron app persists and opens the
//! saved Active workspace. Blocking; run it on the background executor. Never writes anything.

use std::path::{Path, PathBuf};

use tuxedo_core::{Catalogue, WorkspaceSession};

/// `$TUXEDO_USER_DATA/workspaces.json`, else Electron's `appData/Tuxedo Electron/workspaces.json`
/// (see `apps/desktop/electron/main.ts`).
pub fn catalogue_path() -> Option<PathBuf> {
    let user_data = match std::env::var_os("TUXEDO_USER_DATA") {
        Some(dir) => PathBuf::from(dir),
        None => app_data_dir()?.join("Tuxedo Electron"),
    };
    Some(user_data.join("workspaces.json"))
}

fn app_data_dir() -> Option<PathBuf> {
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        Some(home()?.join("Library/Application Support"))
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| Some(home()?.join(".config")))
    }
}

/// The outcome of restoration, which decides the startup screen.
pub enum Restored {
    /// The catalogue could not be read. It is left untouched and the app shows the error.
    Unavailable(String),
    /// `warning` is set when the saved Active workspace's Todo file could not open (Empty state).
    Ready {
        session: Box<WorkspaceSession>,
        warning: Option<String>,
    },
}

pub fn restore(path: Option<&Path>) -> Restored {
    // Core maps only a missing file to an empty catalogue (the Electron app has never saved a
    // Workspace); every other read failure must surface instead of looking like absence.
    let catalogue = match path.map(tuxedo_core::load_catalogue) {
        Some(Ok(catalogue)) => catalogue,
        Some(Err(error)) => return Restored::Unavailable(error.to_string()),
        None => Catalogue::default(),
    };
    let active_id = catalogue.active_workspace_id.clone();
    let mut session = WorkspaceSession::new(catalogue);
    let warning = active_id.and_then(|id| session.open(&id).err().map(|error| error.to_string()));
    Restored::Ready {
        session: Box::new(session),
        warning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tuxedo-app-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_catalogue_restores_an_empty_session() {
        let restored = restore(Some(&temp_dir("missing").join("workspaces.json")));
        let Restored::Ready { session, warning } = restored else {
            panic!("expected Ready")
        };
        assert!(session.catalogue().workspaces.is_empty());
        assert!(session.selected().is_none() && warning.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn catalogue_read_error_is_not_mistaken_for_absence() {
        // A self-referencing symlink: `Path::exists` reports false, but reading fails with a
        // filesystem loop, not NotFound.
        let path = temp_dir("read-error").join("workspaces.json");
        let _ = std::fs::remove_file(&path);
        std::os::unix::fs::symlink(&path, &path).unwrap();
        assert!(!path.exists());
        assert!(matches!(restore(Some(&path)), Restored::Unavailable(_)));
    }

    #[test]
    fn unreadable_catalogue_is_reported_and_left_untouched() {
        let path = temp_dir("unreadable").join("workspaces.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(matches!(restore(Some(&path)), Restored::Unavailable(_)));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn unopenable_active_workspace_restores_into_empty_state_with_warning() {
        let dir = temp_dir("active-missing");
        let path = dir.join("workspaces.json");
        let todo = dir.join("absent-todo.txt");
        let id = "7d3f2c1e-8a4b-4c5d-9e6f-0a1b2c3d4e5f";
        std::fs::write(
            &path,
            serde_json::json!({
                "version": 1,
                "active_workspace_id": id,
                "workspaces": [{
                    "id": id, "name": "Home", "color": "blue",
                    "todo_path": todo, "created_at": "2026-11-05T00:00:00.000Z",
                }],
            })
            .to_string(),
        )
        .unwrap();
        let Restored::Ready { session, warning } = restore(Some(&path)) else {
            panic!("expected Ready")
        };
        assert_eq!(session.catalogue().workspaces.len(), 1);
        assert!(session.selected().is_none());
        assert!(warning.is_some());
    }
}
