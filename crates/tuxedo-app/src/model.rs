//! The retained session entity. Views hold its handle and read projections from it.

use gpui_kit::*;
use tuxedo_core::{Workspace, WorkspaceSession, WorkspaceSnapshot};

use crate::session::{self, Restored};

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
}

impl SessionModel {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self::restore_from(session::catalogue_path(), cx)
    }

    /// Workspace session restoration from the catalogue at `path`.
    pub fn restore_from(path: Option<std::path::PathBuf>, cx: &mut Context<Self>) -> Self {
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
        }
    }

    pub fn state(&self) -> &SessionState {
        &self.state
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

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{AppContext as _, Entity, TestAppContext};

    use super::SessionModel;

    const A: &str = "0b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const B: &str = "1b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const C: &str = "2b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const MISSING: &str = "3b1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

    /// A catalogue with Workspaces A, B, C (readable) and MISSING (no Todo file); A is active.
    fn catalogue(name: &str) -> PathBuf {
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
