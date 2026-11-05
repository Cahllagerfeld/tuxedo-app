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
        let path = session::catalogue_path();
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
