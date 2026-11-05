use std::path::{Path, PathBuf};

use crate::CoreError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoItem {
    pub line_number: u32,
    pub raw: String,
    pub completed: bool,
    pub priority: Option<char>,
    pub creation_date: Option<String>,
    pub completion_date: Option<String>,
    pub description: String,
    pub projects: Vec<String>,
    pub contexts: Vec<String>,
    pub metadata: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedLine {
    pub line_number: u32,
    pub raw: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoFile {
    pub path: PathBuf,
    pub items: Vec<TodoItem>,
    pub skipped: Vec<SkippedLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TodoFileSummary {
    pub total: usize,
    pub open: usize,
    pub completed: usize,
    pub skipped: usize,
}

pub fn parse_todo_text(path: PathBuf, _text: &str) -> TodoFile {
    TodoFile { path, items: Vec::new(), skipped: Vec::new() }
}

pub fn read_todo_file(path: &Path) -> Result<TodoFile, CoreError> {
    let text = std::fs::read_to_string(path)
        .map_err(|source| CoreError::Io { path: path.to_path_buf(), source })?;
    Ok(parse_todo_text(path.to_path_buf(), &text))
}

impl TodoFile {
    pub fn summary(&self) -> TodoFileSummary {
        let completed = self.items.iter().filter(|i| i.completed).count();
        TodoFileSummary {
            total: self.items.len(),
            open: self.items.len() - completed,
            completed,
            skipped: self.skipped.len(),
        }
    }
}

impl TodoItem {
    pub fn due_date(&self) -> Option<&str> {
        None
    }
}
