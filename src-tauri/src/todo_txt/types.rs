use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
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
    pub metadata: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SkippedLine {
    pub line_number: u32,
    pub raw: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TodoFile {
    pub path: String,
    pub items: Vec<TodoItem>,
    pub skipped: Vec<SkippedLine>,
}
