mod catalogue;
mod lifecycle;

use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use lifecycle::{
    LifecycleError, WorkspaceSession, WorkspaceSessionOperationOutcome, WorkspaceSessionSnapshot,
};

const WORKSPACE_CATALOGUE_FILE: &str = "workspaces.toml";

#[tauri::command]
pub(crate) fn restore_workspace_session(
    session: State<'_, WorkspaceSession>,
) -> Result<WorkspaceSessionSnapshot, String> {
    session.restore().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn switch_workspace(
    session: State<'_, WorkspaceSession>,
    workspace_id: String,
) -> Result<WorkspaceSessionOperationOutcome, String> {
    operation_outcome(session.switch(workspace_id))
}

#[tauri::command]
pub(crate) fn delete_workspace(
    session: State<'_, WorkspaceSession>,
    workspace_id: String,
) -> Result<WorkspaceSessionOperationOutcome, String> {
    operation_outcome(session.delete(workspace_id))
}

#[tauri::command]
pub(crate) fn create_workspace(
    session: State<'_, WorkspaceSession>,
    name: String,
    color: String,
    todo_path: String,
) -> Result<WorkspaceSessionOperationOutcome, String> {
    operation_outcome(session.create(name, color, todo_path))
}

#[tauri::command]
pub(crate) fn set_todo_item_completion(
    session: State<'_, WorkspaceSession>,
    line_number: u32,
    expected_raw: String,
    completed: bool,
) -> Result<WorkspaceSessionOperationOutcome, String> {
    operation_outcome_result(session.set_todo_item_completion(
        line_number,
        expected_raw,
        completed,
        chrono::Local::now().date_naive(),
    ))
}

#[tauri::command]
pub(crate) fn delete_todo_item(
    session: State<'_, WorkspaceSession>,
    line_number: u32,
    expected_raw: String,
) -> Result<WorkspaceSessionOperationOutcome, String> {
    operation_outcome_result(session.delete_todo_item(line_number, expected_raw))
}

fn operation_outcome(
    result: Result<WorkspaceSessionSnapshot, LifecycleError>,
) -> Result<WorkspaceSessionOperationOutcome, String> {
    operation_outcome_result(
        result.map(|snapshot| WorkspaceSessionOperationOutcome::Applied { snapshot }),
    )
}

fn operation_outcome_result(
    result: Result<WorkspaceSessionOperationOutcome, LifecycleError>,
) -> Result<WorkspaceSessionOperationOutcome, String> {
    match result {
        Ok(outcome) => Ok(outcome),
        Err(LifecycleError::OperationLock) => Err(LifecycleError::OperationLock.to_string()),
        Err(error) => Ok(WorkspaceSessionOperationOutcome::Rejected {
            message: error.to_string(),
        }),
    }
}

pub(crate) fn workspace_session(app: &AppHandle) -> Result<WorkspaceSession, String> {
    Ok(WorkspaceSession::new(workspace_catalogue_path(app)?))
}

fn workspace_catalogue_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))?;
    Ok(config_dir.join(WORKSPACE_CATALOGUE_FILE))
}
