use atomicwrites::{AtomicFile, OverwriteBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::load_todo_file;
use crate::todo_txt::error::LoadError;
use crate::todo_txt::types::TodoFile;

const WORKSPACE_CATALOGUE_FILE: &str = "workspaces.toml";
const WORKSPACE_CATALOGUE_VERSION: u32 = 1;
const WORKSPACE_COLORS: [&str; 8] = [
    "blue", "green", "amber", "red", "violet", "pink", "cyan", "orange",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub color: String,
    pub todo_path: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceCatalogue {
    pub version: u32,
    pub active_workspace_id: Option<String>,
    pub workspaces: Vec<Workspace>,
}

impl Default for WorkspaceCatalogue {
    fn default() -> Self {
        Self {
            version: WORKSPACE_CATALOGUE_VERSION,
            active_workspace_id: None,
            workspaces: Vec::new(),
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceLoadResult {
    pub workspace: Workspace,
    pub todo_file: TodoFile,
}

#[tauri::command]
pub fn load_workspace_catalogue(app: AppHandle) -> Result<WorkspaceCatalogue, String> {
    load_workspace_catalogue_from_path(workspace_catalogue_path(&app)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_workspace_catalogue(
    app: AppHandle,
    catalogue: WorkspaceCatalogue,
) -> Result<WorkspaceCatalogue, String> {
    save_workspace_catalogue_to_path(workspace_catalogue_path(&app)?, &catalogue)
        .map_err(|error| error.to_string())?;
    Ok(catalogue)
}

#[tauri::command]
pub fn open_workspace(app: AppHandle, workspace_id: String) -> Result<WorkspaceLoadResult, String> {
    let catalogue = load_workspace_catalogue_from_path(workspace_catalogue_path(&app)?)
        .map_err(|error| error.to_string())?;
    let workspace = catalogue
        .workspaces
        .into_iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("workspace does not exist: {workspace_id}"))?;

    load_workspace(workspace).map_err(|error| error.to_string())
}

fn load_workspace(workspace: Workspace) -> Result<WorkspaceLoadResult, LoadError> {
    let todo_file = load_todo_file(workspace.todo_path.clone())?;
    Ok(WorkspaceLoadResult {
        workspace,
        todo_file,
    })
}

fn validate_catalogue(catalogue: &WorkspaceCatalogue) -> Result<(), WorkspaceCatalogueError> {
    if catalogue.version != WORKSPACE_CATALOGUE_VERSION {
        return Err(WorkspaceCatalogueError::Invalid(format!(
            "unsupported workspace catalogue version: {}",
            catalogue.version
        )));
    }

    let mut names = HashSet::new();
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();
    for workspace in &catalogue.workspaces {
        if workspace.name.is_empty() || workspace.name != workspace.name.trim() {
            return Err(WorkspaceCatalogueError::Invalid(
                "workspace name must be trimmed and non-empty".into(),
            ));
        }
        Uuid::parse_str(&workspace.id).map_err(|_| {
            WorkspaceCatalogueError::Invalid(format!("invalid workspace id: {}", workspace.id))
        })?;
        chrono::DateTime::parse_from_rfc3339(&workspace.created_at).map_err(|_| {
            WorkspaceCatalogueError::Invalid(format!(
                "invalid workspace creation timestamp: {}",
                workspace.created_at
            ))
        })?;
        if workspace.todo_path.trim().is_empty() {
            return Err(WorkspaceCatalogueError::Invalid(
                "workspace todo file path must not be empty".into(),
            ));
        }
        if !WORKSPACE_COLORS.contains(&workspace.color.as_str()) {
            return Err(WorkspaceCatalogueError::Invalid(format!(
                "unsupported workspace color: {}",
                workspace.color
            )));
        }
        if !ids.insert(&workspace.id) {
            return Err(WorkspaceCatalogueError::Invalid(format!(
                "duplicate workspace id: {}",
                workspace.id
            )));
        }
        if !names.insert(workspace.name.trim().to_lowercase()) {
            return Err(WorkspaceCatalogueError::Invalid(format!(
                "duplicate workspace name: {}",
                workspace.name
            )));
        }
        if !paths.insert(&workspace.todo_path) {
            return Err(WorkspaceCatalogueError::Invalid(format!(
                "duplicate todo file: {}",
                workspace.todo_path
            )));
        }
    }
    if let Some(active_id) = &catalogue.active_workspace_id {
        if !ids.contains(active_id) {
            return Err(WorkspaceCatalogueError::Invalid(format!(
                "active workspace does not exist: {active_id}"
            )));
        }
    }
    Ok(())
}

fn workspace_catalogue_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))?;
    Ok(config_dir.join(WORKSPACE_CATALOGUE_FILE))
}

fn load_workspace_catalogue_from_path(
    path: PathBuf,
) -> Result<WorkspaceCatalogue, WorkspaceCatalogueError> {
    if !path.exists() {
        return Ok(WorkspaceCatalogue::default());
    }
    let contents = std::fs::read_to_string(path)?;
    let catalogue: WorkspaceCatalogue = toml::from_str(&contents)?;
    validate_catalogue(&catalogue)?;
    Ok(catalogue)
}

fn save_workspace_catalogue_to_path(
    path: PathBuf,
    catalogue: &WorkspaceCatalogue,
) -> Result<(), WorkspaceCatalogueError> {
    validate_catalogue(catalogue)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let contents = toml::to_string(catalogue)?;
    let atomic_file = AtomicFile::new(path, OverwriteBehavior::AllowOverwrite);
    atomic_file.write(|file| file.write_all(contents.as_bytes()))?;
    Ok(())
}

#[derive(Debug, thiserror::Error)]
enum WorkspaceCatalogueError {
    #[error("failed to read or write workspace catalogue: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to parse workspace catalogue: {0}")]
    TomlDeserialize(#[from] toml::de::Error),
    #[error("failed to serialize workspace catalogue: {0}")]
    TomlSerialize(#[from] toml::ser::Error),
    #[error("failed to write workspace catalogue atomically: {0}")]
    AtomicWrite(#[from] atomicwrites::Error<std::io::Error>),
    #[error("invalid workspace catalogue: {0}")]
    Invalid(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn workspace(id: &str, name: &str, todo_path: &str) -> Workspace {
        Workspace {
            id: id.into(),
            name: name.into(),
            color: "blue".into(),
            todo_path: todo_path.into(),
            created_at: "2026-01-01T00:00:00+00:00".into(),
        }
    }

    #[test]
    fn default_catalogue_has_no_active_workspace() {
        assert_eq!(
            WorkspaceCatalogue::default(),
            WorkspaceCatalogue {
                version: 1,
                active_workspace_id: None,
                workspaces: vec![]
            }
        );
    }

    #[test]
    fn catalogue_round_trips_through_toml_without_task_data() {
        let catalogue = WorkspaceCatalogue {
            version: 1,
            active_workspace_id: Some("550e8400-e29b-41d4-a716-446655440000".into()),
            workspaces: vec![workspace(
                "550e8400-e29b-41d4-a716-446655440000",
                "Work",
                "/tmp/work.todo",
            )],
        };
        let serialized = toml::to_string(&catalogue).unwrap();
        assert!(!serialized.contains("items"));
        assert_eq!(
            toml::from_str::<WorkspaceCatalogue>(&serialized).unwrap(),
            catalogue
        );
    }

    #[test]
    fn missing_catalogue_loads_as_default() {
        let path = unique_temp_dir("missing").join(WORKSPACE_CATALOGUE_FILE);
        assert_eq!(
            load_workspace_catalogue_from_path(path).unwrap(),
            WorkspaceCatalogue::default()
        );
    }

    #[test]
    fn malformed_catalogue_is_an_error_and_is_left_untouched() {
        let directory = unique_temp_dir("malformed");
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(WORKSPACE_CATALOGUE_FILE);
        let contents = "this is not = [valid toml";
        std::fs::write(&path, contents).unwrap();
        assert!(load_workspace_catalogue_from_path(path.clone()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn semantically_invalid_catalogue_is_an_error_and_is_left_untouched() {
        let directory = unique_temp_dir("invalid");
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(WORKSPACE_CATALOGUE_FILE);
        let contents = "version = 1\nactive_workspace_id = \"missing\"\nworkspaces = []\n";
        std::fs::write(&path, contents).unwrap();

        assert!(load_workspace_catalogue_from_path(path.clone()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn loading_workspace_reads_its_exact_todo_file() {
        let directory = unique_temp_dir("exact-path");
        std::fs::create_dir_all(&directory).unwrap();
        let todo_path = directory.join("not-todo.txt");
        std::fs::write(&todo_path, "(A) Exact file").unwrap();
        let result = load_workspace(workspace(
            "550e8400-e29b-41d4-a716-446655440000",
            "Work",
            &todo_path.to_string_lossy(),
        ))
        .unwrap();
        assert_eq!(result.todo_file.path, todo_path.to_string_lossy());
        assert_eq!(result.todo_file.items.len(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn atomic_save_replaces_a_previous_valid_catalogue() {
        let directory = unique_temp_dir("atomic-save");
        let path = directory.join(WORKSPACE_CATALOGUE_FILE);
        let first = WorkspaceCatalogue::default();
        let second = WorkspaceCatalogue {
            version: 1,
            active_workspace_id: Some("550e8400-e29b-41d4-a716-446655440000".into()),
            workspaces: vec![workspace(
                "550e8400-e29b-41d4-a716-446655440000",
                "Work",
                "/tmp/work.todo",
            )],
        };
        save_workspace_catalogue_to_path(path.clone(), &first).unwrap();
        save_workspace_catalogue_to_path(path.clone(), &second).unwrap();
        assert_eq!(load_workspace_catalogue_from_path(path).unwrap(), second);
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("tuxedo-ui-{name}-{nanos}"))
    }
}
