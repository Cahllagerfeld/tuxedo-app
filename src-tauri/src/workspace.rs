use atomicwrites::{AtomicFile, OverwriteBehavior};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::load_todo_file;
use crate::todo_txt::types::TodoFile;

const WORKSPACE_CONFIG_FILE: &str = "workspace.toml";
const WORKSPACE_CONFIG_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceConfig {
    pub version: u32,
    pub root: Option<String>,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            version: WORKSPACE_CONFIG_VERSION,
            root: None,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceLoadResult {
    pub root: String,
    pub todo_path: String,
    pub todo_exists: bool,
    pub todo_file: Option<TodoFile>,
}

#[tauri::command]
pub fn load_workspace_config(app: AppHandle) -> Result<WorkspaceConfig, String> {
    load_workspace_config_from_path(workspace_config_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_workspace_config(app: AppHandle, root: String) -> Result<WorkspaceConfig, String> {
    validate_workspace_root(&root)?;

    let config = WorkspaceConfig {
        version: WORKSPACE_CONFIG_VERSION,
        root: Some(root),
    };

    save_workspace_config_to_path(workspace_config_path(&app)?, &config)
        .map_err(|error| error.to_string())?;

    Ok(config)
}

#[tauri::command]
pub fn load_workspace(root: String) -> Result<WorkspaceLoadResult, String> {
    load_workspace_from_root(root)
}

fn load_workspace_from_root(root: String) -> Result<WorkspaceLoadResult, String> {
    validate_workspace_root(&root)?;

    let todo_path = todo_path_for_root(&root);
    let todo_exists = todo_path.exists();
    let todo_path = todo_path.to_string_lossy().to_string();
    let todo_file = if todo_exists {
        Some(load_todo_file(todo_path.clone()).map_err(|error| error.to_string())?)
    } else {
        None
    };

    Ok(WorkspaceLoadResult {
        root,
        todo_path,
        todo_exists,
        todo_file,
    })
}

fn validate_workspace_root(root: &str) -> Result<(), String> {
    let root_path = PathBuf::from(root);

    if !root_path.exists() {
        return Err(format!("workspace directory does not exist: {root}"));
    }

    if !root_path.is_dir() {
        return Err(format!("workspace root is not a directory: {root}"));
    }

    Ok(())
}

enum WorkspaceFile {
    Todo,
}

impl WorkspaceFile {
    fn filename(&self) -> &'static str {
        match self {
            Self::Todo => "todo.txt",
        }
    }

    fn path_for_root(&self, root: &str) -> PathBuf {
        PathBuf::from(root).join(self.filename())
    }
}

fn todo_path_for_root(root: &str) -> PathBuf {
    WorkspaceFile::Todo.path_for_root(root)
}

fn workspace_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))?;

    Ok(config_dir.join(WORKSPACE_CONFIG_FILE))
}

fn load_workspace_config_from_path(path: PathBuf) -> Result<WorkspaceConfig, WorkspaceConfigError> {
    if !path.exists() {
        return Ok(WorkspaceConfig::default());
    }

    let contents = std::fs::read_to_string(path)?;
    let config = toml::from_str(&contents)?;

    Ok(config)
}

fn save_workspace_config_to_path(
    path: PathBuf,
    config: &WorkspaceConfig,
) -> Result<(), WorkspaceConfigError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let contents = toml::to_string(config)?;
    let atomic_file = AtomicFile::new(path, OverwriteBehavior::AllowOverwrite);

    atomic_file.write(|file| file.write_all(contents.as_bytes()))?;

    Ok(())
}

#[derive(Debug, thiserror::Error)]
enum WorkspaceConfigError {
    #[error("failed to read or write workspace config: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to parse workspace config: {0}")]
    TomlDeserialize(#[from] toml::de::Error),
    #[error("failed to serialize workspace config: {0}")]
    TomlSerialize(#[from] toml::ser::Error),
    #[error("failed to write workspace config atomically: {0}")]
    AtomicWrite(#[from] atomicwrites::Error<std::io::Error>),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn default_workspace_config_has_no_root() {
        assert_eq!(
            WorkspaceConfig::default(),
            WorkspaceConfig {
                version: WORKSPACE_CONFIG_VERSION,
                root: None,
            }
        );
    }

    #[test]
    fn workspace_config_round_trips_through_toml() {
        let config = WorkspaceConfig {
            version: WORKSPACE_CONFIG_VERSION,
            root: Some("/tmp/todos".to_string()),
        };

        let serialized = toml::to_string(&config).unwrap();
        let deserialized: WorkspaceConfig = toml::from_str(&serialized).unwrap();

        assert_eq!(deserialized, config);
    }

    #[test]
    fn todo_path_is_derived_from_workspace_root() {
        let workspace_file = WorkspaceFile::Todo;
        let path = workspace_file.path_for_root("/tmp/todos");

        assert_eq!(path, PathBuf::from("/tmp/todos").join("todo.txt"));
        assert_eq!(todo_path_for_root("/tmp/todos"), path);
    }

    #[test]
    fn rejects_file_as_workspace_root() {
        let temp_dir = unique_temp_dir("rejects-file-root");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("todo.txt");
        std::fs::write(&file_path, "Test task").unwrap();

        let result = validate_workspace_root(&file_path.to_string_lossy());

        assert!(result
            .unwrap_err()
            .contains("workspace root is not a directory"));

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn load_workspace_reports_missing_todo_file() {
        let temp_dir = unique_temp_dir("missing-todo");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let result = load_workspace_from_root(temp_dir.to_string_lossy().to_string()).unwrap();

        assert!(!result.todo_exists);
        assert!(result.todo_file.is_none());
        assert_eq!(
            result.todo_path,
            temp_dir.join("todo.txt").to_string_lossy()
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn load_workspace_rejects_missing_workspace_root() {
        let temp_dir = unique_temp_dir("missing-root");

        let error = load_workspace_from_root(temp_dir.to_string_lossy().to_string()).unwrap_err();

        assert!(error.contains("workspace directory does not exist"));
    }

    #[test]
    fn load_workspace_parses_existing_todo_file() {
        let temp_dir = unique_temp_dir("existing-todo");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "(A) Test task +Tuxedo").unwrap();

        let result = load_workspace_from_root(temp_dir.to_string_lossy().to_string()).unwrap();

        assert!(result.todo_exists);
        assert_eq!(result.todo_file.unwrap().items.len(), 1);

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn missing_workspace_config_file_loads_default_config() {
        let temp_dir = unique_temp_dir("missing-config");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config_path = temp_dir.join("workspace.toml");

        let config = load_workspace_config_from_path(config_path).unwrap();

        assert_eq!(config, WorkspaceConfig::default());

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn saved_workspace_config_restores_root_and_workspace_load_parses_todo_file() {
        let temp_dir = unique_temp_dir("restore-root");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "(A) Restored task +Tuxedo").unwrap();
        let config_path = temp_dir.join("workspace.toml");
        let saved_config = WorkspaceConfig {
            version: WORKSPACE_CONFIG_VERSION,
            root: Some(temp_dir.to_string_lossy().to_string()),
        };

        save_workspace_config_to_path(config_path.clone(), &saved_config).unwrap();
        let restored_config = load_workspace_config_from_path(config_path).unwrap();
        let workspace =
            load_workspace_from_root(restored_config.root.clone().expect("saved root")).unwrap();

        assert_eq!(restored_config, saved_config);
        assert!(workspace.todo_exists);
        assert_eq!(workspace.todo_file.unwrap().items[0].description, "Restored task");

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("tuxedo-ui-{name}-{nanos}"))
    }
}
