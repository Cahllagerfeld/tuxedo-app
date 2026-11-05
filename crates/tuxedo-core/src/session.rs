//! The Workspace session: the catalogue, the selected Workspace's loaded Todo file, the
//! session revision, and at most one Undo step. Synchronous; callers run I/O off the UI thread.
//!
//! Extension modules (`todo_write`, and Workspace commands) add `impl WorkspaceSession` blocks
//! and reach the shared state through the `pub(crate)` fields and helpers below.

use crate::{
    read_todo_file, Catalogue, CoreError, TodoFile, TodoFileSummary, UndoToken, Workspace,
};

#[derive(Debug, Clone)]
pub struct WorkspaceSnapshot {
    pub workspace: Workspace,
    pub file: TodoFile,
    pub summary: TodoFileSummary,
}

impl WorkspaceSnapshot {
    /// Whether `other` shows the same Todo file contents of the same Workspace. Catalogue
    /// metadata (name, color, preferences) may differ.
    pub(crate) fn same_file(&self, other: &WorkspaceSnapshot) -> bool {
        self.workspace.id == other.workspace.id
            && self.workspace.todo_file == other.workspace.todo_file
            && self.file.source == other.file.source
    }
}

#[derive(Debug, Clone)]
pub struct WorkspaceSession {
    pub(crate) catalogue: Catalogue,
    pub(crate) selected: Option<WorkspaceSnapshot>,
    /// Advances whenever an accepted change alters the selected snapshot. Commands capture it at
    /// admission and are refused as stale when it moved.
    pub(crate) revision: u64,
    /// The one Undo step, valid only for the selected Workspace's current file contents.
    pub(crate) undo: Option<UndoToken>,
}

impl WorkspaceSession {
    pub fn new(catalogue: Catalogue) -> Self {
        Self {
            catalogue,
            selected: None,
            revision: 0,
            undo: None,
        }
    }

    pub fn catalogue(&self) -> &Catalogue {
        &self.catalogue
    }

    pub fn selected(&self) -> Option<&WorkspaceSnapshot> {
        self.selected.as_ref()
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn can_undo(&self) -> bool {
        self.undo.is_some()
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
        self.replace_selected(Some(snapshot));
        self.selected.as_ref().expect("just installed")
    }

    /// Convenience for synchronous callers: `prepare_open`, `load`, then `accept`.
    /// On failure the previous selection is kept. This never writes the catalogue.
    pub fn open(&mut self, workspace_id: &str) -> Result<&WorkspaceSnapshot, CoreError> {
        let snapshot = self.prepare_open(workspace_id)?.load()?;
        Ok(self.accept(snapshot))
    }

    /// Installs a committed catalogue and the selection it implies (Workspace commands).
    #[allow(dead_code, reason = "called by Workspace commands (#258)")]
    pub(crate) fn accept_catalogue(
        &mut self,
        catalogue: Catalogue,
        selected: Option<WorkspaceSnapshot>,
    ) {
        self.catalogue = catalogue;
        self.replace_selected(selected);
    }

    /// Replaces the selected snapshot. A changed snapshot advances the revision. Undo survives
    /// only when the new snapshot shows the same Workspace's same file contents (a metadata-only
    /// change); a switch, deselection, or external change clears it.
    pub(crate) fn replace_selected(&mut self, selected: Option<WorkspaceSnapshot>) {
        let same_file = match (&self.selected, &selected) {
            (Some(old), Some(new)) => old.same_file(new),
            (None, None) => true,
            _ => false,
        };
        let unchanged = same_file
            && self.selected.as_ref().map(|s| &s.workspace)
                == selected.as_ref().map(|s| &s.workspace);
        if !same_file {
            self.undo = None;
        }
        if !unchanged {
            self.revision += 1;
        }
        self.selected = selected;
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
