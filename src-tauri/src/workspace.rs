use atomicwrites::{AtomicFile, OverwriteBehavior};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::load_todo_file;
use crate::todo_txt::error::LoadError;
use crate::todo_txt::types::TodoFile;

const WORKSPACE_CONFIG_FILE: &str = "workspace.toml";
const MAX_RECENT_WORKSPACES: usize = 10;
const WORKSPACE_COLORS: [&str; 8] = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4",
    "#f97316",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceConfig {
    pub active_workspace_id: Option<String>,
    pub recent_workspaces: Vec<WorkspaceEntry>,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            active_workspace_id: None,
            recent_workspaces: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    pub color: String,
    pub root: String,
    pub last_opened_at: String,
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
pub fn save_workspace_entry(app: AppHandle, root: String) -> Result<WorkspaceConfig, String> {
    save_workspace_entry_to_path(workspace_config_path(&app)?, root)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_active_workspace(app: AppHandle, id: String) -> Result<WorkspaceConfig, String> {
    set_active_workspace_in_path(workspace_config_path(&app)?, id)
        .map_err(|error| error.to_string())
}

fn save_workspace_entry_to_path(path: PathBuf, root: String) -> Result<WorkspaceConfig, String> {
    validate_workspace_root(&root)?;

    let mut config =
        load_workspace_config_from_path(path.clone()).map_err(|error| error.to_string())?;
    let entry = workspace_entry_for_root(&root, &config);

    upsert_recent_workspace(&mut config, entry);
    save_workspace_config_to_path(path, &config).map_err(|error| error.to_string())?;

    Ok(config)
}

fn set_active_workspace_in_path(path: PathBuf, id: String) -> Result<WorkspaceConfig, String> {
    let mut config =
        load_workspace_config_from_path(path.clone()).map_err(|error| error.to_string())?;

    let Some(index) = config
        .recent_workspaces
        .iter()
        .position(|workspace| workspace.id == id)
    else {
        return Err(format!("workspace not found: {id}"));
    };

    let mut workspace = config.recent_workspaces.remove(index);
    workspace.last_opened_at = now_timestamp();
    config.active_workspace_id = Some(workspace.id.clone());
    config.recent_workspaces.insert(0, workspace);

    save_workspace_config_to_path(path, &config).map_err(|error| error.to_string())?;

    Ok(config)
}

#[tauri::command]
pub fn load_workspace(root: String) -> Result<WorkspaceLoadResult, String> {
    validate_workspace_root(&root)?;
    load_workspace_from_root(root).map_err(|error| error.to_string())
}

fn load_workspace_from_root(root: String) -> Result<WorkspaceLoadResult, LoadError> {
    let todo_path = todo_path_for_root(&root);
    let todo_exists = todo_path.exists();
    let todo_path = todo_path.to_string_lossy().to_string();
    let todo_file = if todo_exists {
        Some(load_todo_file(todo_path.clone())?)
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

fn workspace_entry_for_root(root: &str, config: &WorkspaceConfig) -> WorkspaceEntry {
    let existing = config
        .recent_workspaces
        .iter()
        .find(|workspace| workspace.root == root);
    let recent_count = config.recent_workspaces.len();

    WorkspaceEntry {
        id: existing
            .map(|workspace| workspace.id.clone())
            .unwrap_or_else(|| generate_workspace_id(root)),
        name: existing
            .map(|workspace| workspace.name.clone())
            .unwrap_or_else(|| workspace_name_from_root(root)),
        color: existing
            .map(|workspace| workspace.color.clone())
            .unwrap_or_else(|| WORKSPACE_COLORS[recent_count % WORKSPACE_COLORS.len()].to_string()),
        root: root.to_string(),
        last_opened_at: now_timestamp(),
    }
}

fn upsert_recent_workspace(config: &mut WorkspaceConfig, entry: WorkspaceEntry) {
    config
        .recent_workspaces
        .retain(|workspace| workspace.root != entry.root && workspace.id != entry.id);

    config.active_workspace_id = Some(entry.id.clone());
    config.recent_workspaces.insert(0, entry);
    config.recent_workspaces.truncate(MAX_RECENT_WORKSPACES);
}

fn workspace_name_from_root(root: &str) -> String {
    PathBuf::from(root)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Workspace")
        .to_string()
}

fn generate_workspace_id(root: &str) -> String {
    let mut hasher = DefaultHasher::new();
    root.hash(&mut hasher);
    now_timestamp().hash(&mut hasher);
    format!("workspace-{:x}", hasher.finish())
}

fn now_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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
    let config = toml::from_str(&contents).unwrap_or_default();

    Ok(normalize_workspace_config(config))
}

fn normalize_workspace_config(mut config: WorkspaceConfig) -> WorkspaceConfig {
    config.recent_workspaces.truncate(MAX_RECENT_WORKSPACES);

    let active_workspace_exists = config
        .active_workspace_id
        .as_ref()
        .is_some_and(|active_id| {
            config
                .recent_workspaces
                .iter()
                .any(|workspace| &workspace.id == active_id)
        });

    if !active_workspace_exists {
        config.active_workspace_id = config
            .recent_workspaces
            .first()
            .map(|workspace| workspace.id.clone());
    }

    config
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
    fn default_workspace_config_has_no_recent_workspaces() {
        assert_eq!(
            WorkspaceConfig::default(),
            WorkspaceConfig {
                active_workspace_id: None,
                recent_workspaces: Vec::new(),
            }
        );
    }

    #[test]
    fn workspace_config_round_trips_through_toml() {
        let config = WorkspaceConfig {
            active_workspace_id: Some("workspace-1".to_string()),
            recent_workspaces: vec![WorkspaceEntry {
                id: "workspace-1".to_string(),
                name: "Work".to_string(),
                color: "#3b82f6".to_string(),
                root: "/tmp/todos".to_string(),
                last_opened_at: "2026-05-30T10:00:00.000Z".to_string(),
            }],
        };

        let serialized = toml::to_string(&config).unwrap();
        let deserialized: WorkspaceConfig = toml::from_str(&serialized).unwrap();

        assert_eq!(deserialized, config);
    }

    #[test]
    fn invalid_workspace_config_returns_default_config() {
        let temp_dir = unique_temp_dir("invalid-config");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config_path = temp_dir.join("workspace.toml");
        std::fs::write(&config_path, "version = 1").unwrap();

        let result = load_workspace_config_from_path(config_path).unwrap();

        assert_eq!(result, WorkspaceConfig::default());

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn workspace_config_with_invalid_active_id_uses_first_recent_workspace() {
        let temp_dir = unique_temp_dir("invalid-active-workspace");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config_path = temp_dir.join("workspace.toml");
        std::fs::write(
            &config_path,
            r##"
active_workspace_id = "missing"

[[recent_workspaces]]
id = "workspace-1"
name = "Work"
color = "#3b82f6"
root = "/tmp/work"
last_opened_at = "2026-05-30T10:00:00.000Z"
"##,
        )
        .unwrap();

        let result = load_workspace_config_from_path(config_path).unwrap();

        assert_eq!(result.active_workspace_id, Some("workspace-1".to_string()));

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn upsert_recent_workspace_deduplicates_and_caps_recents() {
        let mut config = WorkspaceConfig::default();

        for index in 0..12 {
            upsert_recent_workspace(
                &mut config,
                WorkspaceEntry {
                    id: format!("workspace-{index}"),
                    name: format!("Workspace {index}"),
                    color: "#3b82f6".to_string(),
                    root: format!("/tmp/workspace-{index}"),
                    last_opened_at: now_timestamp(),
                },
            );
        }

        upsert_recent_workspace(
            &mut config,
            WorkspaceEntry {
                id: "workspace-new".to_string(),
                name: "Renamed".to_string(),
                color: "#10b981".to_string(),
                root: "/tmp/workspace-10".to_string(),
                last_opened_at: now_timestamp(),
            },
        );

        assert_eq!(config.recent_workspaces.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(config.active_workspace_id, Some("workspace-new".to_string()));
        assert_eq!(config.recent_workspaces[0].root, "/tmp/workspace-10");
        assert_eq!(
            config
                .recent_workspaces
                .iter()
                .filter(|workspace| workspace.root == "/tmp/workspace-10")
                .count(),
            1
        );
    }

    #[test]
    fn workspace_entry_for_root_derives_default_metadata() {
        let config = WorkspaceConfig::default();
        let entry = workspace_entry_for_root("/tmp/todos", &config);

        assert!(entry.id.starts_with("workspace-"));
        assert_eq!(entry.name, "todos");
        assert_eq!(entry.color, WORKSPACE_COLORS[0]);
        assert_eq!(entry.root, "/tmp/todos");
        assert!(!entry.last_opened_at.is_empty());
    }

    #[test]
    fn save_workspace_entry_persists_active_recent_workspace() {
        let temp_dir = unique_temp_dir("save-workspace-entry");
        let workspace_root = temp_dir.join("work");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let config_path = temp_dir.join("workspace.toml");

        let result = save_workspace_entry_to_path(
            config_path.clone(),
            workspace_root.to_string_lossy().to_string(),
        )
        .unwrap();
        let saved = load_workspace_config_from_path(config_path).unwrap();

        assert_eq!(result.recent_workspaces.len(), 1);
        assert_eq!(
            result.recent_workspaces[0].root,
            workspace_root.to_string_lossy().to_string()
        );
        assert_eq!(result.recent_workspaces[0].name, "work");
        assert_eq!(
            result.active_workspace_id,
            Some(result.recent_workspaces[0].id.clone())
        );
        assert_eq!(saved, result);

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn set_active_workspace_moves_workspace_to_front() {
        let temp_dir = unique_temp_dir("set-active-workspace");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config_path = temp_dir.join("workspace.toml");
        let config = WorkspaceConfig {
            active_workspace_id: Some("workspace-1".to_string()),
            recent_workspaces: vec![
                WorkspaceEntry {
                    id: "workspace-1".to_string(),
                    name: "Work".to_string(),
                    color: "#3b82f6".to_string(),
                    root: "/tmp/work".to_string(),
                    last_opened_at: "2026-05-30T10:00:00.000Z".to_string(),
                },
                WorkspaceEntry {
                    id: "workspace-2".to_string(),
                    name: "Personal".to_string(),
                    color: "#10b981".to_string(),
                    root: "/tmp/personal".to_string(),
                    last_opened_at: "2026-05-30T09:00:00.000Z".to_string(),
                },
            ],
        };
        save_workspace_config_to_path(config_path.clone(), &config).unwrap();

        let result = set_active_workspace_in_path(config_path, "workspace-2".to_string()).unwrap();

        assert_eq!(result.active_workspace_id, Some("workspace-2".to_string()));
        assert_eq!(result.recent_workspaces[0].id, "workspace-2");
        assert_eq!(result.recent_workspaces[1].id, "workspace-1");

        std::fs::remove_dir_all(temp_dir).unwrap();
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
    fn rejects_missing_workspace_root() {
        let result = validate_workspace_root("/tmp/tuxedo-ui-definitely-missing");

        assert!(result
            .unwrap_err()
            .contains("workspace directory does not exist"));
    }

    #[test]
    fn load_workspace_rejects_invalid_roots() {
        let temp_dir = unique_temp_dir("load-rejects-file-root");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("todo.txt");
        std::fs::write(&file_path, "Test task").unwrap();

        assert!(load_workspace(file_path.to_string_lossy().to_string()).is_err());
        assert!(load_workspace(temp_dir.join("missing").to_string_lossy().to_string()).is_err());

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
    fn load_workspace_parses_existing_todo_file() {
        let temp_dir = unique_temp_dir("existing-todo");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "(A) Test task +Tuxedo").unwrap();

        let result = load_workspace_from_root(temp_dir.to_string_lossy().to_string()).unwrap();

        assert!(result.todo_exists);
        assert_eq!(result.todo_file.unwrap().items.len(), 1);

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
