//! Workspace session restoration: finds the native app's own data folder, imports the Electron
//! app's data into it on a first launch, and opens the saved Active workspace. Blocking; run it
//! on the background executor. Writes only the one-time import.

use std::path::{Path, PathBuf};

use tuxedo_core::{
    import_electron_data, Catalogue, ElectronImport, WorkspaceSession, CATALOGUE_FILE,
};

use crate::command_queue::{Outcome, OutcomeKind};

/// The native app's own data folder: `$TUXEDO_USER_DATA`, else `appData/Tuxedo`
/// (`~/Library/Application Support/Tuxedo` on macOS).
fn user_data_dir() -> Option<PathBuf> {
    match std::env::var_os("TUXEDO_USER_DATA") {
        Some(dir) => Some(PathBuf::from(dir)),
        None => Some(app_data_dir()?.join("Tuxedo")),
    }
}

/// `workspaces.json` in the native app's data folder.
pub fn catalogue_path() -> Option<PathBuf> {
    Some(user_data_dir()?.join(CATALOGUE_FILE))
}

/// The Electron app's data folder, read only by the one-time import:
/// `$TUXEDO_ELECTRON_USER_DATA`, else `appData/Tuxedo Electron` (see
/// `apps/desktop/electron/main.ts`). With `TUXEDO_USER_DATA` set (tests, screenshots) and no
/// explicit source, nothing is imported, so a throwaway folder never reads the real one.
pub fn electron_data_dir() -> Option<PathBuf> {
    match std::env::var_os("TUXEDO_ELECTRON_USER_DATA") {
        Some(dir) => Some(PathBuf::from(dir)),
        None if std::env::var_os("TUXEDO_USER_DATA").is_some() => None,
        None => Some(app_data_dir()?.join("Tuxedo Electron")),
    }
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
    /// `notices` report the one-time import of the Electron app's data.
    Ready {
        session: Box<WorkspaceSession>,
        warning: Option<String>,
        notices: Vec<Outcome>,
    },
}

/// Restores from the catalogue at `path`, first importing the Electron app's data from
/// `import_from` into the catalogue's folder when that folder has no catalogue yet.
pub fn restore(path: Option<&Path>, import_from: Option<&Path>) -> Restored {
    let notices = match (path.and_then(Path::parent), import_from) {
        (Some(native), Some(electron)) => import_notices(import_electron_data(native, electron)),
        _ => Vec::new(),
    };
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
        notices,
    }
}

fn import_notices(import: ElectronImport) -> Vec<Outcome> {
    let failed =
        |title: &str, message: String| Outcome::new(OutcomeKind::Failed, title, Some(message));
    match import {
        ElectronImport::NotNeeded => Vec::new(),
        ElectronImport::Refused(error) => vec![failed("Electron data not imported", error)],
        ElectronImport::Imported(report) => {
            let plural =
                |n: usize, word: &str| format!("{n} {word}{}", if n == 1 { "" } else { "s" });
            let mut notices = vec![Outcome::new(
                OutcomeKind::Applied,
                "Imported from the Electron app",
                Some(format!(
                    "Imported {} and {} from the Electron app.",
                    plural(report.workspaces, "Workspace"),
                    plural(report.saved_views, "saved view"),
                )),
            )];
            if let Some(warning) = report.saved_views_warning {
                notices.push(failed("Saved views not imported", warning));
            }
            notices
        }
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
        let restored = restore(Some(&temp_dir("missing").join("workspaces.json")), None);
        let Restored::Ready {
            session, warning, ..
        } = restored
        else {
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
        assert!(matches!(
            restore(Some(&path), None),
            Restored::Unavailable(_)
        ));
    }

    #[test]
    fn unreadable_catalogue_is_reported_and_left_untouched() {
        let path = temp_dir("unreadable").join("workspaces.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(matches!(
            restore(Some(&path), None),
            Restored::Unavailable(_)
        ));
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
        let Restored::Ready {
            session, warning, ..
        } = restore(Some(&path), None)
        else {
            panic!("expected Ready")
        };
        assert_eq!(session.catalogue().workspaces.len(), 1);
        assert!(session.selected().is_none());
        assert!(warning.is_some());
    }

    #[test]
    fn first_launch_imports_the_electron_catalogue_and_saved_views_once() {
        let root = temp_dir("import");
        let _ = std::fs::remove_dir_all(&root);
        let (native, electron) = (root.join("Tuxedo"), root.join("Tuxedo Electron"));
        std::fs::create_dir_all(&electron).unwrap();
        let id = "7d3f2c1e-8a4b-4c5d-9e6f-0a1b2c3d4e5f";
        let todo = root.join("todo.txt");
        std::fs::write(&todo, "(A) Call mom +family @phone\n").unwrap();
        let catalogue = serde_json::json!({
            "version": 1,
            "active_workspace_id": id,
            "workspaces": [{
                "id": id, "name": "Home", "color": "blue",
                "todo_path": todo, "created_at": "2026-11-05T00:00:00.000Z",
            }],
        })
        .to_string();
        let views = serde_json::json!({"version": 1, "views": [{
            "id": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b", "workspace_id": id, "name": "Calls",
            "filters": {"status": "open", "search": "mom", "project": "family",
                        "context": null, "priority": "A", "due": null},
        }]})
        .to_string();
        std::fs::write(electron.join("workspaces.json"), &catalogue).unwrap();
        std::fs::write(electron.join("saved-views.json"), &views).unwrap();
        let native_catalogue = native.join("workspaces.json");
        let restore_native = || restore(Some(&native_catalogue), Some(&electron));

        // A fresh native folder: both files are created and valid; the Electron folder is unchanged.
        let Restored::Ready {
            session, notices, ..
        } = restore_native()
        else {
            panic!("expected Ready")
        };
        assert!(
            session.selected().is_some(),
            "the imported Active workspace opens"
        );
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].kind, OutcomeKind::Applied);
        let imported = tuxedo_core::read_saved_views(&native.join("saved-views.json")).unwrap();
        assert_eq!(imported[0].query, "is:open pri:A +family mom");
        assert_eq!(
            std::fs::read_to_string(electron.join("workspaces.json")).unwrap(),
            catalogue
        );
        assert_eq!(
            std::fs::read_to_string(electron.join("saved-views.json")).unwrap(),
            views
        );

        // The native folder is populated: nothing is imported again.
        std::fs::write(electron.join("workspaces.json"), "{ changed").unwrap();
        let Restored::Ready { notices, .. } = restore_native() else {
            panic!("expected Ready")
        };
        assert!(notices.is_empty());

        // An invalid Electron catalogue writes nothing and is reported; the app starts Empty.
        std::fs::remove_dir_all(&native).unwrap();
        let Restored::Ready {
            session, notices, ..
        } = restore_native()
        else {
            panic!("expected Ready")
        };
        assert!(session.catalogue().workspaces.is_empty());
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].kind, OutcomeKind::Failed);
        assert!(!native.exists());
    }
}
