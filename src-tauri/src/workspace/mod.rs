mod catalogue;
mod lifecycle;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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
