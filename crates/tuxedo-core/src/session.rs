//! A minimal read-only Workspace session: the catalogue plus the selected
//! Workspace's loaded Todo file. Synchronous; callers run it off the UI thread.

use crate::{read_todo_file, Catalogue, CoreError, TodoFile, TodoFileSummary, Workspace};

#[derive(Debug, Clone)]
pub struct WorkspaceSnapshot {
    pub workspace: Workspace,
    pub file: TodoFile,
    pub summary: TodoFileSummary,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSession {
    catalogue: Catalogue,
    selected: Option<WorkspaceSnapshot>,
}

impl WorkspaceSession {
    pub fn new(catalogue: Catalogue) -> Self {
        Self {
            catalogue,
            selected: None,
        }
    }

    pub fn catalogue(&self) -> &Catalogue {
        &self.catalogue
    }

    pub fn selected(&self) -> Option<&WorkspaceSnapshot> {
        self.selected.as_ref()
    }

    /// Foreground step: resolves `workspace_id` into a `Send` request without doing I/O.
    pub fn prepare_open(&self, workspace_id: &str) -> Result<OpenRequest, CoreError> {
        self.catalogue
            .workspace(workspace_id)
            .cloned()
            .map(|workspace| OpenRequest { workspace })
            .ok_or_else(|| CoreError::UnknownWorkspace {
                id: workspace_id.to_owned(),
            })
    }

    /// Foreground step: makes a loaded snapshot the selected Workspace. Callers that may
    /// have several loads in flight are responsible for dropping stale snapshots.
    pub fn accept(&mut self, snapshot: WorkspaceSnapshot) -> &WorkspaceSnapshot {
        self.selected.insert(snapshot)
    }

    /// Convenience for synchronous callers: `prepare_open`, `load`, then `accept`.
    /// On failure the previous selection is kept. This never writes the catalogue.
    pub fn open(&mut self, workspace_id: &str) -> Result<&WorkspaceSnapshot, CoreError> {
        let snapshot = self.prepare_open(workspace_id)?.load()?;
        Ok(self.accept(snapshot))
    }
}

/// A pending Workspace open: owns everything the background read needs.
#[derive(Debug, Clone)]
pub struct OpenRequest {
    pub workspace: Workspace,
}

impl OpenRequest {
    /// Background step: reads and parses the Todo file. Touches no session state.
    pub fn load(self) -> Result<WorkspaceSnapshot, CoreError> {
        let file = read_todo_file(&self.workspace.todo_file)?;
        Ok(WorkspaceSnapshot {
            summary: file.summary(),
            workspace: self.workspace,
            file,
        })
    }
}
