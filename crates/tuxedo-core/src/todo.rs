//! todo.txt parsing with parity to `packages/backend/src/todo-file.ts`.

use std::path::{Path, PathBuf};

use crate::date::{is_date_shaped, TodoDate};
use crate::CoreError;

const INVALID_DATE: &str = "date must use YYYY-MM-DD format";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoItem {
    /// 1-based physical line.
    pub line_number: u32,
    /// The line without its line ending.
    pub raw: String,
    pub completed: bool,
    pub priority: Option<char>,
    pub creation_date: Option<TodoDate>,
    pub completion_date: Option<TodoDate>,
    /// Plain description words; falls back to the remaining text when only tokens remain.
    pub description: String,
    /// Editor projection: description words only, and metadata tokens in source order.
    pub edit: TodoItemEdit,
    /// Project names without the leading `+`, in source order, duplicates kept.
    pub projects: Vec<String>,
    /// Context names without the leading `@`, in source order, duplicates kept.
    pub contexts: Vec<String>,
    /// Every `key:value` token as a pair, in source order, duplicates kept.
    /// Use [`TodoItem::metadata_value`] for the effective (last-wins) value.
    pub metadata: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TodoItemEdit {
    pub description: String,
    pub metadata: Vec<String>,
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
    /// The decoded source text, unchanged (including any BOM).
    pub source: String,
    /// Every physical line in order, including blank ones, with its line ending.
    pub lines: Vec<SourceLine>,
    pub items: Vec<TodoItem>,
    pub skipped: Vec<SkippedLine>,
}

/// One physical line of the source. `text` equals the parsed `raw` (a BOM stays on line 1,
/// and a lone trailing `\r` without `\n` stays in `text` with ending `None`, as in TS).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLine {
    pub line_number: u32,
    pub text: String,
    pub ending: LineEnding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    CrLf,
    None,
}

impl TodoFile {
    pub fn has_bom(&self) -> bool {
        self.source.starts_with('\u{feff}')
    }

    pub fn has_final_newline(&self) -> bool {
        self.source.ends_with('\n')
    }
}

/// The Todo-file summary counts shown in the status bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TodoFileSummary {
    pub total: usize,
    pub open: usize,
    pub completed: usize,
    pub skipped: usize,
}

/// Due-date category relative to the local `today`, as in `todo-due.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DueCategory {
    Overdue,
    Today,
    Upcoming,
    None,
    Invalid,
}

pub fn parse_todo_text(path: PathBuf, text: &str) -> TodoFile {
    let mut file = TodoFile {
        path,
        source: text.to_owned(),
        lines: Vec::new(),
        items: Vec::new(),
        skipped: Vec::new(),
    };
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    let count = lines.len();
    for (index, line) in lines.into_iter().enumerate() {
        let terminated = index < count - 1 || text.ends_with('\n');
        let (raw, ending) = match line.strip_suffix('\r') {
            Some(stripped) if terminated => (stripped, LineEnding::CrLf),
            _ if terminated => (line, LineEnding::Lf),
            _ => (line, LineEnding::None),
        };
        let line_number = (index + 1) as u32;
        file.lines.push(SourceLine {
            line_number,
            text: raw.to_owned(),
            ending,
        });
        if raw.trim().is_empty() {
            continue;
        }
        match parse_line(line_number, raw) {
            Ok(item) => file.items.push(item),
            Err(reason) => file.skipped.push(SkippedLine {
                line_number,
                raw: raw.to_owned(),
                reason: reason.to_owned(),
            }),
        }
    }
    file
}

pub fn read_todo_file(path: &Path) -> Result<TodoFile, CoreError> {
    let bytes = std::fs::read(path).map_err(|source| CoreError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let text = String::from_utf8(bytes).map_err(|_| CoreError::InvalidUtf8 {
        path: path.to_path_buf(),
    })?;
    Ok(parse_todo_text(path.to_path_buf(), &text))
}

/// Consumes a leading date token from `rest`: `Ok(None)` when the first token is not
/// date-shaped, an error when it is date-shaped but not a calendar date.
fn consume_date(rest: &mut &str) -> Result<Option<TodoDate>, &'static str> {
    let token = rest.split(char::is_whitespace).next().unwrap_or("");
    if !is_date_shaped(token) {
        return Ok(None);
    }
    let date = TodoDate::parse(token).ok_or(INVALID_DATE)?;
    let after = &rest[token.len()..];
    let mut chars = after.chars();
    *rest = match chars.next() {
        Some(c) if c.is_whitespace() => chars.as_str(),
        _ => after,
    };
    Ok(Some(date))
}

fn parse_priority(rest: &mut &str) -> Option<char> {
    let b = rest.as_bytes();
    if b.len() >= 4 && b[0] == b'(' && b[1].is_ascii_uppercase() && b[2] == b')' && b[3] == b' ' {
        let priority = b[1] as char;
        *rest = &rest[4..];
        Some(priority)
    } else {
        None
    }
}

fn metadata_pair(token: &str) -> Option<(&str, &str)> {
    if let Some((key, value)) = token.split_once(':') {
        if !key.is_empty() && !value.is_empty() && !value.contains(':') {
            return Some((key, value));
        }
    }
    token.strip_prefix("board:").map(|value| ("board", value))
}

fn parse_line(line_number: u32, raw: &str) -> Result<TodoItem, &'static str> {
    let mut rest = raw;
    let completed = rest.starts_with("x ");
    if completed {
        rest = &rest[2..];
    }
    let completion_date = if completed {
        consume_date(&mut rest)?
    } else {
        None
    };
    let priority = parse_priority(&mut rest);
    let creation_date = consume_date(&mut rest)?;

    let mut projects = Vec::new();
    let mut contexts = Vec::new();
    let mut metadata = Vec::new();
    let mut words = Vec::new();
    let mut metadata_tokens = Vec::new();
    for token in rest.split(char::is_whitespace).filter(|t| !t.is_empty()) {
        if let Some(project) = token.strip_prefix('+').filter(|p| !p.is_empty()) {
            projects.push(project.to_owned());
        } else if let Some(context) = token.strip_prefix('@').filter(|c| !c.is_empty()) {
            contexts.push(context.to_owned());
        } else if let Some((key, value)) = metadata_pair(token) {
            metadata_tokens.push(token.to_owned());
            metadata.push((key.to_owned(), value.to_owned()));
        } else {
            words.push(token);
        }
    }
    let plain = words.join(" ");
    let description = if !plain.is_empty() {
        plain.clone()
    } else if !rest.trim().is_empty() {
        rest.trim().to_owned()
    } else {
        raw.trim().to_owned()
    };
    Ok(TodoItem {
        line_number,
        raw: raw.to_owned(),
        completed,
        priority,
        creation_date,
        completion_date,
        description,
        edit: TodoItemEdit {
            description: plain,
            metadata: metadata_tokens,
        },
        projects,
        contexts,
        metadata,
    })
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
    /// The effective value of a metadata key (the last occurrence in the line).
    pub fn metadata_value(&self, key: &str) -> Option<&str> {
        self.metadata
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    /// The effective `due:` value when it is a valid calendar date.
    pub fn due_date(&self) -> Option<TodoDate> {
        self.metadata_value("due").and_then(TodoDate::parse)
    }

    /// Categorizes the effective `due:` value against the local `today`.
    pub fn due_category(&self, today: TodoDate) -> DueCategory {
        match (self.metadata_value("due"), self.due_date()) {
            (None, _) => DueCategory::None,
            (Some(_), None) => DueCategory::Invalid,
            (_, Some(due)) if due < today => DueCategory::Overdue,
            (_, Some(due)) if due == today => DueCategory::Today,
            _ => DueCategory::Upcoming,
        }
    }
}
