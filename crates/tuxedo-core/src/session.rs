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

    /// Reads the Workspace's Todo file and makes it the selected Workspace. On failure the
    /// previous selection is kept. This never writes the catalogue.
    pub fn open(&mut self, workspace_id: &str) -> Result<WorkspaceSnapshot, CoreError> {
        let workspace = self
            .catalogue
            .workspace(workspace_id)
            .cloned()
            .ok_or_else(|| CoreError::UnknownWorkspace {
                id: workspace_id.to_owned(),
            })?;
        let file = read_todo_file(&workspace.todo_file)?;
        let snapshot = WorkspaceSnapshot {
            summary: file.summary(),
            workspace,
            file,
        };
        self.selected = Some(snapshot.clone());
        Ok(snapshot)
    }
}
