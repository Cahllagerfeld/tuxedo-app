use atomicwrites::{AtomicFile, OverwriteBehavior};
use chrono::Local;
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
pub struct WorkspaceTodoResolution {
    pub root: String,
    pub todo_path: String,
    pub todo_exists: bool,
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
pub fn resolve_workspace_todo(root: String) -> Result<WorkspaceTodoResolution, String> {
    resolve_workspace_todo_from_root(root)
}

#[tauri::command]
pub fn append_todo_item(root: String, raw: String) -> Result<TodoFile, String> {
    validate_todo_line(&raw)?;
    append_todo_line_for_root(&root, raw).map_err(|error| error.to_string())?;
    reload_todo_file_for_root(&root)
}

#[tauri::command]
pub fn update_todo_item(
    root: String,
    line_number: usize,
    expected_raw: String,
    raw: String,
) -> Result<TodoFile, String> {
    validate_todo_line(&raw)?;
    replace_todo_line_for_root(&root, line_number, &expected_raw, raw)
        .map_err(|error| error.to_string())?;
    reload_todo_file_for_root(&root)
}

#[tauri::command]
pub fn toggle_todo_item_completed(
    root: String,
    line_number: usize,
    expected_raw: String,
) -> Result<TodoFile, String> {
    let toggled = toggle_todo_line_completed(&expected_raw, &current_local_date());
    validate_todo_line(&toggled)?;
    replace_todo_line_for_root(&root, line_number, &expected_raw, toggled)
        .map_err(|error| error.to_string())?;
    reload_todo_file_for_root(&root)
}

#[tauri::command]
pub fn delete_todo_item(
    root: String,
    line_number: usize,
    expected_raw: String,
) -> Result<TodoFile, String> {
    remove_todo_line_for_root(&root, line_number, &expected_raw)
        .map_err(|error| error.to_string())?;
    reload_todo_file_for_root(&root)
}

fn resolve_workspace_todo_from_root(root: String) -> Result<WorkspaceTodoResolution, String> {
    validate_workspace_root(&root)?;

    let todo_path = todo_path_for_root(&root);
    let todo_exists = todo_path.exists();
    let todo_path = todo_path.to_string_lossy().to_string();

    Ok(WorkspaceTodoResolution {
        root,
        todo_path,
        todo_exists,
    })
}

fn reload_todo_file_for_root(root: &str) -> Result<TodoFile, String> {
    validate_workspace_root(root)?;

    let todo_path = todo_path_for_root(root);

    if !todo_path.exists() {
        return Err(format!(
            "no todo.txt file was found in {root}; add one there or choose another directory"
        ));
    }

    load_todo_file(todo_path.to_string_lossy().to_string()).map_err(|error| error.to_string())
}

fn validate_todo_line(raw: &str) -> Result<(), String> {
    if raw.contains('\n') || raw.contains('\r') {
        return Err("todo item must be a single line".to_string());
    }

    parse_line(1, raw).map_err(|error| error.to_string())?;

    Ok(())
}

fn toggle_todo_line_completed(raw: &str, completion_date: &str) -> String {
    let trimmed = raw.trim_start();

    if let Some(rest) = trimmed.strip_prefix("x ") {
        return reopen_todo_line(rest);
    }

    format!("x {completion_date} {raw}")
}

fn reopen_todo_line(completed_rest: &str) -> String {
    let rest = completed_rest.trim_start();
    let Some((first_token, remaining)) = split_first_token(rest) else {
        return String::new();
    };

    if is_date_token(first_token) {
        remaining.to_string()
    } else {
        rest.to_string()
    }
}

fn split_first_token(line: &str) -> Option<(&str, &str)> {
    match line.find(char::is_whitespace) {
        Some(index) => Some((&line[..index], line[index..].trim_start())),
        None if !line.is_empty() => Some((line, "")),
        None => None,
    }
}

fn is_date_token(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() == 10 && bytes[4] == b'-' && bytes[7] == b'-'
}

fn current_local_date() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
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
mod tests;
