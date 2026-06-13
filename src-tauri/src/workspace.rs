use atomicwrites::{AtomicFile, OverwriteBehavior};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::load_todo_file;
use crate::todo_txt::parser::parse_line;
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

#[tauri::command]
pub fn append_todo_item(root: String, raw: String) -> Result<WorkspaceLoadResult, String> {
    validate_todo_line(&raw)?;
    append_todo_line_for_root(&root, raw).map_err(|error| error.to_string())?;
    load_workspace_from_root(root)
}

#[tauri::command]
pub fn update_todo_item(
    root: String,
    line_number: usize,
    expected_raw: String,
    raw: String,
) -> Result<WorkspaceLoadResult, String> {
    validate_todo_line(&raw)?;
    replace_todo_line_for_root(&root, line_number, &expected_raw, raw)
        .map_err(|error| error.to_string())?;
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

fn validate_todo_line(raw: &str) -> Result<(), String> {
    if raw.contains('\n') || raw.contains('\r') {
        return Err("todo item must be a single line".to_string());
    }

    parse_line(1, raw).map_err(|error| error.to_string())?;

    Ok(())
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

#[allow(dead_code)]
fn read_todo_lines_for_root(root: &str) -> Result<Vec<String>, TodoWriteError> {
    validate_workspace_root(root).map_err(TodoWriteError::InvalidWorkspace)?;

    let todo_path = todo_path_for_root(root);

    if !todo_path.exists() {
        return Ok(Vec::new());
    }

    if !todo_path.is_file() {
        return Err(TodoWriteError::NotAFile(todo_path));
    }

    let contents = std::fs::read_to_string(todo_path)?;

    Ok(contents.lines().map(str::to_string).collect())
}

#[allow(dead_code)]
fn append_todo_line_for_root(root: &str, next_line: String) -> Result<(), TodoWriteError> {
    let mut lines = read_todo_lines_for_root(root)?;
    lines.push(next_line);

    write_todo_lines_for_root(root, &lines)
}

#[allow(dead_code)]
fn replace_todo_line_for_root(
    root: &str,
    line_number: usize,
    expected_raw_line: &str,
    next_line: String,
) -> Result<(), TodoWriteError> {
    let mut lines = read_todo_lines_for_root(root)?;
    let line = guarded_line_mut(&mut lines, line_number, expected_raw_line)?;
    *line = next_line;

    write_todo_lines_for_root(root, &lines)
}

#[allow(dead_code)]
fn remove_todo_line_for_root(
    root: &str,
    line_number: usize,
    expected_raw_line: &str,
) -> Result<(), TodoWriteError> {
    let mut lines = read_todo_lines_for_root(root)?;
    guarded_line_mut(&mut lines, line_number, expected_raw_line)?;
    lines.remove(line_number - 1);

    write_todo_lines_for_root(root, &lines)
}

#[allow(dead_code)]
fn guarded_line_mut<'a>(
    lines: &'a mut [String],
    line_number: usize,
    expected_raw_line: &str,
) -> Result<&'a mut String, TodoWriteError> {
    if line_number == 0 {
        return Err(TodoWriteError::InvalidLineNumber(line_number));
    }

    let line = lines
        .get_mut(line_number - 1)
        .ok_or(TodoWriteError::InvalidLineNumber(line_number))?;

    if line != expected_raw_line {
        return Err(TodoWriteError::StaleLine {
            line_number,
            expected: expected_raw_line.to_string(),
            actual: line.clone(),
        });
    }

    Ok(line)
}

#[allow(dead_code)]
fn write_todo_lines_for_root(root: &str, lines: &[String]) -> Result<(), TodoWriteError> {
    validate_workspace_root(root).map_err(TodoWriteError::InvalidWorkspace)?;
    write_todo_lines(todo_path_for_root(root), lines)
}

#[allow(dead_code)]
fn write_todo_lines(path: PathBuf, lines: &[String]) -> Result<(), TodoWriteError> {
    let contents = if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    };
    let atomic_file = AtomicFile::new(path, OverwriteBehavior::AllowOverwrite);

    atomic_file.write(|file| file.write_all(contents.as_bytes()))?;

    Ok(())
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
#[allow(dead_code)]
enum TodoWriteError {
    #[error("{0}")]
    InvalidWorkspace(String),
    #[error("todo file path is not a file: {0}")]
    NotAFile(PathBuf),
    #[error("todo line number is invalid: {0}")]
    InvalidLineNumber(usize),
    #[error("todo line {line_number} changed on disk; expected {expected:?}, found {actual:?}")]
    StaleLine {
        line_number: usize,
        expected: String,
        actual: String,
    },
    #[error("failed to read or write todo file: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to write todo file atomically: {0}")]
    AtomicWrite(#[from] atomicwrites::Error<std::io::Error>),
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

    #[test]
    fn append_todo_line_creates_missing_todo_file() {
        let temp_dir = unique_temp_dir("append-creates");
        std::fs::create_dir_all(&temp_dir).unwrap();

        append_todo_line_for_root(&temp_dir.to_string_lossy(), "(A) New task".to_string()).unwrap();

        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "(A) New task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn append_todo_line_preserves_existing_lines() {
        let temp_dir = unique_temp_dir("append-preserves");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\nbad line\n").unwrap();

        append_todo_line_for_root(&temp_dir.to_string_lossy(), "Second task".to_string()).unwrap();

        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\nbad line\nSecond task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn replace_todo_line_updates_guarded_line_and_preserves_other_lines() {
        let temp_dir = unique_temp_dir("replace-guarded");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\nSecond task\nThird task\n").unwrap();

        replace_todo_line_for_root(
            &temp_dir.to_string_lossy(),
            2,
            "Second task",
            "Updated second task".to_string(),
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\nUpdated second task\nThird task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn replace_todo_line_rejects_stale_raw_line_guard() {
        let temp_dir = unique_temp_dir("replace-stale");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\nChanged task\n").unwrap();

        let error = replace_todo_line_for_root(
            &temp_dir.to_string_lossy(),
            2,
            "Old task",
            "Updated task".to_string(),
        )
        .unwrap_err();

        assert!(error.to_string().contains("todo line 2 changed on disk"));
        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\nChanged task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn remove_todo_line_deletes_guarded_line_and_preserves_other_lines() {
        let temp_dir = unique_temp_dir("remove-guarded");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\nSecond task\nThird task\n").unwrap();

        remove_todo_line_for_root(&temp_dir.to_string_lossy(), 2, "Second task").unwrap();

        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\nThird task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn guarded_todo_line_rejects_zero_and_out_of_range_line_numbers() {
        let temp_dir = unique_temp_dir("guard-invalid");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\n").unwrap();

        let zero_error = replace_todo_line_for_root(
            &temp_dir.to_string_lossy(),
            0,
            "First task",
            "Updated task".to_string(),
        )
        .unwrap_err();
        let range_error = replace_todo_line_for_root(
            &temp_dir.to_string_lossy(),
            2,
            "Missing task",
            "Updated task".to_string(),
        )
        .unwrap_err();

        assert!(zero_error.to_string().contains("todo line number is invalid: 0"));
        assert!(range_error.to_string().contains("todo line number is invalid: 2"));
        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn read_todo_lines_rejects_todo_path_that_is_directory() {
        let temp_dir = unique_temp_dir("todo-path-directory");
        std::fs::create_dir_all(temp_dir.join("todo.txt")).unwrap();

        let error = read_todo_lines_for_root(&temp_dir.to_string_lossy()).unwrap_err();

        assert!(error.to_string().contains("todo file path is not a file"));

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn append_todo_item_creates_todo_file_and_returns_reloaded_workspace() {
        let temp_dir = unique_temp_dir("append-command-creates");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let result = append_todo_item(
            temp_dir.to_string_lossy().to_string(),
            "(A) Capture task +Tuxedo @computer".to_string(),
        )
        .unwrap();

        assert!(result.todo_exists);
        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "(A) Capture task +Tuxedo @computer\n"
        );
        let todo_file = result.todo_file.unwrap();
        assert_eq!(todo_file.items.len(), 1);
        assert_eq!(todo_file.items[0].line_number, 1);
        assert_eq!(todo_file.items[0].priority, Some('A'));
        assert_eq!(todo_file.items[0].description, "Capture task");
        assert_eq!(todo_file.items[0].projects, vec!["Tuxedo"]);
        assert_eq!(todo_file.items[0].contexts, vec!["computer"]);

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn append_todo_item_extends_todo_file_without_discarding_existing_lines() {
        let temp_dir = unique_temp_dir("append-command-extends");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "Existing task\n2024-99-99 bad date\n").unwrap();

        let result = append_todo_item(
            temp_dir.to_string_lossy().to_string(),
            "Second task due:2026-01-02".to_string(),
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "Existing task\n2024-99-99 bad date\nSecond task due:2026-01-02\n"
        );
        let todo_file = result.todo_file.unwrap();
        assert_eq!(todo_file.items.len(), 2);
        assert_eq!(todo_file.skipped.len(), 1);
        assert_eq!(todo_file.items[1].line_number, 3);
        assert_eq!(todo_file.items[1].description, "Second task");

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn append_todo_item_rejects_invalid_todo_line_without_writing() {
        let temp_dir = unique_temp_dir("append-command-invalid");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "Existing task\n").unwrap();

        let error = append_todo_item(
            temp_dir.to_string_lossy().to_string(),
            "2024-99-99 bad date".to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "date must use YYYY-MM-DD format");
        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "Existing task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn append_todo_item_rejects_multiline_input_without_writing() {
        let temp_dir = unique_temp_dir("append-command-multiline");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let error = append_todo_item(
            temp_dir.to_string_lossy().to_string(),
            "First task\nSecond task".to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "todo item must be a single line");
        assert!(!temp_dir.join("todo.txt").exists());

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn update_todo_item_replaces_guarded_line_and_returns_reloaded_workspace() {
        let temp_dir = unique_temp_dir("update-command-replaces");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(
            temp_dir.join("todo.txt"),
            "First task\nSecond task +Old\nThird task\n",
        )
        .unwrap();

        let result = update_todo_item(
            temp_dir.to_string_lossy().to_string(),
            2,
            "Second task +Old".to_string(),
            "(A) Updated second task +New @computer".to_string(),
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\n(A) Updated second task +New @computer\nThird task\n"
        );
        let todo_file = result.todo_file.unwrap();
        assert_eq!(todo_file.items.len(), 3);
        assert_eq!(todo_file.items[1].line_number, 2);
        assert_eq!(todo_file.items[1].priority, Some('A'));
        assert_eq!(todo_file.items[1].description, "Updated second task");
        assert_eq!(todo_file.items[1].projects, vec!["New"]);
        assert_eq!(todo_file.items[1].contexts, vec!["computer"]);

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn update_todo_item_rejects_stale_raw_line_guard_without_writing() {
        let temp_dir = unique_temp_dir("update-command-stale");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\nChanged on disk\n").unwrap();

        let error = update_todo_item(
            temp_dir.to_string_lossy().to_string(),
            2,
            "Second task".to_string(),
            "Updated task".to_string(),
        )
        .unwrap_err();

        assert!(error.contains("todo line 2 changed on disk"));
        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\nChanged on disk\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn update_todo_item_rejects_invalid_replacement_without_writing() {
        let temp_dir = unique_temp_dir("update-command-invalid");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\nSecond task\n").unwrap();

        let error = update_todo_item(
            temp_dir.to_string_lossy().to_string(),
            2,
            "Second task".to_string(),
            "2024-99-99 bad date".to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "date must use YYYY-MM-DD format");
        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\nSecond task\n"
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn update_todo_item_rejects_multiline_replacement_without_writing() {
        let temp_dir = unique_temp_dir("update-command-multiline");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("todo.txt"), "First task\nSecond task\n").unwrap();

        let error = update_todo_item(
            temp_dir.to_string_lossy().to_string(),
            2,
            "Second task".to_string(),
            "Updated task\nInjected task".to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "todo item must be a single line");
        assert_eq!(
            std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
            "First task\nSecond task\n"
        );

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
