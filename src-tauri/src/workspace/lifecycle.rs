use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use super::catalogue::{
    CatalogueError, Workspace, WorkspaceCatalogue, WorkspaceCatalogueStore, WORKSPACE_COLORS,
};
use crate::load_todo_file;
use crate::todo_txt::error::LoadError;
use crate::todo_txt::mutation::{self, MutationError, MutationOutcome};
use crate::todo_txt::parser;
use crate::todo_txt::types::TodoFile;
use chrono::NaiveDate;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum WorkspaceSessionSnapshot {
    NoActiveWorkspace {
        catalogue: WorkspaceCatalogue,
    },
    ActiveWorkspaceLoaded {
        catalogue: WorkspaceCatalogue,
        todo_file: TodoFile,
    },
    ActiveWorkspaceUnavailable {
        catalogue: WorkspaceCatalogue,
        warning: String,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub(crate) enum WorkspaceSessionOperationOutcome {
    Applied {
        snapshot: WorkspaceSessionSnapshot,
    },
    Conflict {
        message: String,
        snapshot: WorkspaceSessionSnapshot,
    },
    Rejected {
        message: String,
    },
}

pub(crate) struct WorkspaceSession {
    catalogue_store: WorkspaceCatalogueStore,
    operation_lock: Mutex<()>,
}

impl WorkspaceSession {
    pub(super) fn new(catalogue_path: PathBuf) -> Self {
        Self {
            catalogue_store: WorkspaceCatalogueStore::new(catalogue_path),
            operation_lock: Mutex::new(()),
        }
    }

    pub(super) fn restore(&self) -> Result<WorkspaceSessionSnapshot, LifecycleError> {
        let _operation = self.lock_operation()?;
        let catalogue = self.catalogue_store.load()?;
        Ok(workspace_session_snapshot(catalogue))
    }

    pub(super) fn switch(
        &self,
        workspace_id: String,
    ) -> Result<WorkspaceSessionSnapshot, LifecycleError> {
        let _operation = self.lock_operation()?;
        let mut catalogue = self.catalogue_store.load()?;
        let workspace = catalogue
            .workspace(&workspace_id)
            .cloned()
            .ok_or_else(|| LifecycleError::MissingWorkspace(workspace_id.clone()))?;

        let loaded = load_workspace(workspace)?;
        catalogue.activate(loaded.workspace.id())?;
        self.catalogue_store.save(&catalogue)?;

        Ok(WorkspaceSessionSnapshot::ActiveWorkspaceLoaded {
            catalogue,
            todo_file: loaded.todo_file,
        })
    }

    pub(super) fn delete(
        &self,
        workspace_id: String,
    ) -> Result<WorkspaceSessionSnapshot, LifecycleError> {
        let _operation = self.lock_operation()?;
        let mut catalogue = self.catalogue_store.load()?;
        if !catalogue.remove(&workspace_id) {
            return Err(LifecycleError::MissingWorkspace(workspace_id));
        }
        self.catalogue_store.save(&catalogue)?;
        Ok(workspace_session_snapshot(catalogue))
    }

    pub(super) fn create(
        &self,
        name: String,
        color: String,
        todo_path: String,
    ) -> Result<WorkspaceSessionSnapshot, LifecycleError> {
        let _operation = self.lock_operation()?;
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(LifecycleError::Invalid(
                "workspace name must be trimmed and non-empty".into(),
            ));
        }
        if !WORKSPACE_COLORS.contains(&color.as_str()) {
            return Err(LifecycleError::Invalid(format!(
                "unsupported workspace color: {color}"
            )));
        }

        let todo_file = load_todo_file(todo_path.clone())?;
        if !todo_file.skipped.is_empty() {
            return Err(LifecycleError::Invalid(
                "selected Todo file could not be parsed".into(),
            ));
        }

        let mut catalogue = self.catalogue_store.load()?;
        let workspace = Workspace::new(name, color, todo_path);
        catalogue.add(workspace)?;
        self.catalogue_store.save(&catalogue)?;

        Ok(WorkspaceSessionSnapshot::ActiveWorkspaceLoaded {
            catalogue,
            todo_file,
        })
    }

    pub(super) fn set_todo_item_completion(
        &self,
        line_number: u32,
        expected_raw: String,
        completed: bool,
        today: NaiveDate,
    ) -> Result<WorkspaceSessionOperationOutcome, LifecycleError> {
        let _operation = self.lock_operation()?;
        let catalogue = self.catalogue_store.load()?;
        let workspace = catalogue
            .active_workspace()
            .ok_or_else(|| LifecycleError::Invalid("no active workspace".into()))?;
        let todo_path = PathBuf::from(workspace.todo_path());
        let path = workspace.todo_path().to_owned();
        let outcome =
            mutation::set_completion(&todo_path, line_number, &expected_raw, completed, today)?;
        Ok(todo_mutation_outcome(catalogue, path, outcome))
    }

    pub(super) fn delete_todo_item(
        &self,
        line_number: u32,
        expected_raw: String,
    ) -> Result<WorkspaceSessionOperationOutcome, LifecycleError> {
        let _operation = self.lock_operation()?;
        let catalogue = self.catalogue_store.load()?;
        let workspace = catalogue
            .active_workspace()
            .ok_or_else(|| LifecycleError::Invalid("no active workspace".into()))?;
        let todo_path = PathBuf::from(workspace.todo_path());
        let path = workspace.todo_path().to_owned();
        let outcome = mutation::delete(&todo_path, line_number, &expected_raw)?;
        Ok(todo_mutation_outcome(catalogue, path, outcome))
    }

    fn lock_operation(&self) -> Result<MutexGuard<'_, ()>, LifecycleError> {
        self.operation_lock
            .lock()
            .map_err(|_| LifecycleError::OperationLock)
    }
}

fn todo_mutation_outcome(
    catalogue: WorkspaceCatalogue,
    path: String,
    outcome: MutationOutcome,
) -> WorkspaceSessionOperationOutcome {
    let (contents, conflict) = match outcome {
        MutationOutcome::Updated(contents) => (contents, false),
        MutationOutcome::Conflict(contents) => (contents, true),
    };
    let (items, skipped) = parser::parse_file(&contents);
    let snapshot = WorkspaceSessionSnapshot::ActiveWorkspaceLoaded {
        catalogue,
        todo_file: TodoFile {
            path,
            items,
            skipped,
        },
    };
    if conflict {
        WorkspaceSessionOperationOutcome::Conflict {
            message: "Todo item changed externally".into(),
            snapshot,
        }
    } else {
        WorkspaceSessionOperationOutcome::Applied { snapshot }
    }
}

fn workspace_session_snapshot(catalogue: WorkspaceCatalogue) -> WorkspaceSessionSnapshot {
    let Some(workspace) = catalogue.active_workspace().cloned() else {
        return WorkspaceSessionSnapshot::NoActiveWorkspace { catalogue };
    };

    match load_workspace(workspace) {
        Ok(loaded) => WorkspaceSessionSnapshot::ActiveWorkspaceLoaded {
            catalogue,
            todo_file: loaded.todo_file,
        },
        Err(error) => WorkspaceSessionSnapshot::ActiveWorkspaceUnavailable {
            catalogue,
            warning: format!("Saved workspace could not be opened: {error}"),
        },
    }
}

fn load_workspace(workspace: Workspace) -> Result<LoadedWorkspace, LoadError> {
    let todo_file = load_todo_file(workspace.todo_path().to_owned())?;
    Ok(LoadedWorkspace {
        workspace,
        todo_file,
    })
}

struct LoadedWorkspace {
    workspace: Workspace,
    todo_file: TodoFile,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum LifecycleError {
    #[error(transparent)]
    Catalogue(#[from] CatalogueError),
    #[error("failed to load Todo file: {0}")]
    TodoFile(#[from] LoadError),
    #[error(transparent)]
    TodoMutation(#[from] MutationError),
    #[error("invalid workspace catalogue: workspace does not exist: {0}")]
    MissingWorkspace(String),
    #[error("invalid workspace catalogue: {0}")]
    Invalid(String),
    #[error("Workspace session operation lock is unavailable")]
    OperationLock,
}

#[cfg(test)]
mod tests;
