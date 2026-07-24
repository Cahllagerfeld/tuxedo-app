mod catalogue;
mod lifecycle;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::todo_txt::mutation::MutationError;
use crate::todo_txt::types::TodoFile;

use lifecycle::{WorkspaceLifecycle, WorkspaceSessionSnapshot};

const WORKSPACE_CATALOGUE_FILE: &str = "workspaces.toml";

#[tauri::command]
pub(crate) fn restore_workspace_session(
    app: AppHandle,
) -> Result<WorkspaceSessionSnapshot, String> {
    lifecycle(&app)?
        .restore()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn switch_workspace(
    app: AppHandle,
    workspace_id: String,
) -> Result<WorkspaceSessionSnapshot, String> {
    lifecycle(&app)?
        .switch(workspace_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_workspace(
    app: AppHandle,
    workspace_id: String,
) -> Result<WorkspaceSessionSnapshot, String> {
    lifecycle(&app)?
        .delete(workspace_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn create_workspace(
    app: AppHandle,
    name: String,
    color: String,
    todo_path: String,
) -> Result<WorkspaceSessionSnapshot, String> {
    lifecycle(&app)?
        .create(name, color, todo_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn set_todo_item_completion(
    app: AppHandle,
    line_number: u32,
    expected_raw: String,
    completed: bool,
) -> Result<TodoFile, TodoMutationCommandError> {
    lifecycle(&app)?
        .set_todo_item_completion(
            line_number,
            expected_raw,
            completed,
            chrono::Local::now().date_naive(),
        )
        .map_err(TodoMutationCommandError::from)
}

#[tauri::command]
pub(crate) fn delete_todo_item(
    app: AppHandle,
    line_number: u32,
    expected_raw: String,
) -> Result<TodoFile, TodoMutationCommandError> {
    lifecycle(&app)?
        .delete_todo_item(line_number, expected_raw)
        .map_err(TodoMutationCommandError::from)
}

#[tauri::command]
pub(crate) fn create_todo_item(
    app: AppHandle,
    description: String,
    projects: Vec<String>,
    contexts: Vec<String>,
) -> Result<TodoFile, TodoMutationCommandError> {
    lifecycle(&app)?
        .create_todo_item(
            description,
            projects,
            contexts,
            chrono::Local::now().date_naive(),
        )
        .map_err(TodoMutationCommandError::from)
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum TodoMutationCommandError {
    Conflict { message: String },
    Failure { message: String },
}

impl From<String> for TodoMutationCommandError {
    fn from(message: String) -> Self {
        Self::Failure { message }
    }
}

impl From<lifecycle::LifecycleError> for TodoMutationCommandError {
    fn from(error: lifecycle::LifecycleError) -> Self {
        let message = error.to_string();
        match error {
            lifecycle::LifecycleError::TodoMutation(MutationError::Conflict) => {
                Self::Conflict { message }
            }
            _ => Self::Failure { message },
        }
    }
}

fn lifecycle(app: &AppHandle) -> Result<WorkspaceLifecycle, String> {
    Ok(WorkspaceLifecycle::new(workspace_catalogue_path(app)?))
}

fn workspace_catalogue_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))?;
    Ok(config_dir.join(WORKSPACE_CATALOGUE_FILE))
}
