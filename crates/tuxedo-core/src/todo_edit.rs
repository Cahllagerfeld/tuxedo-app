//! Todo-item creation and editing as todo.txt lines, with the rules of
//! `packages/backend/src/create-todo.ts` and `editTodo` in `todo-operations.ts` that still apply
//! to a typed line.
//!
//! A Todo item is a line of text: quick add appends a typed line and in-place editing replaces
//! one. [`TodoLine::new_item`] and [`TodoLine::edit_of`] validate the typed text; only a
//! validated line reaches [`WorkspaceSession::prepare_create_line`] and
//! [`WorkspaceSession::prepare_edit_line`], whose requests run through
//! [`crate::TodoWriteRequest::execute`] like every other Todo-file command.

use std::ops::Range;
use std::path::{Path, PathBuf};

use crate::recurrence::{plan_recurring_completion, GENERATION_MARKER};
use crate::todo::{creation_date_offset, priority_offset};
use crate::todo_write::{ending_str, replace_line};
use crate::{
    parse_todo_text, CoreError, TodoDate, TodoFile, TodoItem, TodoTarget, WorkspaceSession,
};

const EMPTY: &str = "Type a Todo item.";
const ONE_LINE: &str = "A Todo item is one line.";
const INVALID_DATE: &str = "Use a valid date in YYYY-MM-DD format.";
const NO_DESCRIPTION: &str = "Add a description besides Projects, Contexts, and metadata.";
const COMPLETION_DATE_REQUIRED: &str =
    "A completed Todo item keeps its Completion date: x YYYY-MM-DD.";
const CREATION_NEEDS_COMPLETION: &str =
    "Add the Completion date first: the date right after x is the Completion date.";

/// A validated todo.txt line for a new Todo item or an edit of one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoLine {
    raw: String,
    item: TodoItem,
    /// Which rules validated the line: editing keeps legacy completed forms.
    editing: bool,
}

/// The typed text as the line to write, byte for byte: one line, not blank. Trailing whitespace
/// stays too, since it can be syntax (`(A) ` and `x ` are incomplete prefixes, not text).
fn typed_line(typed: &str) -> Result<&str, &'static str> {
    if typed.contains(['\n', '\r']) {
        return Err(ONE_LINE);
    }
    if typed.trim().is_empty() {
        return Err(EMPTY);
    }
    Ok(typed)
}

/// Parses one line as a Todo item that has a plain description.
fn parse_item(raw: &str) -> Result<TodoItem, &'static str> {
    let file = parse_todo_text(PathBuf::new(), raw);
    if !file.skipped.is_empty() {
        return Err(INVALID_DATE);
    }
    let item = file.items.into_iter().next().ok_or(EMPTY)?;
    if item.edit.description.is_empty() {
        return Err(NO_DESCRIPTION);
    }
    Ok(item)
}

impl TodoLine {
    /// A new Todo item typed as `typed`. Without a Creation date it gets `today`'s where the
    /// parser reads one (after `x`, the Completion date, and the Priority), as Electron's
    /// creation does; nothing else is rewritten. A completed item needs its Completion date.
    pub fn new_item(typed: &str, today: TodoDate) -> Result<Self, &'static str> {
        let line = typed_line(typed)?;
        let item = parse_item(line)?;
        if item.completed && item.completion_date.is_none() {
            return Err(COMPLETION_DATE_REQUIRED);
        }
        let mut raw = line.to_owned();
        if item.creation_date.is_none() {
            raw.insert_str(creation_date_offset(line), &format!("{today} "));
        }
        let item = parse_item(&raw)?;
        Ok(Self {
            raw,
            item,
            editing: false,
        })
    }

    /// `original` edited to `typed`, kept as typed (trailing whitespace dropped; text equal to
    /// the original line keeps it byte for byte).
    /// An item that becomes completed needs a Completion date, and a recorded one cannot be
    /// removed while the item stays completed; legacy completed items without one stay
    /// editable.
    pub fn edit_of(typed: &str, original: &TodoItem) -> Result<Self, &'static str> {
        let raw = if typed == original.raw {
            typed.to_owned()
        } else {
            typed_line(typed)?.to_owned()
        };
        let item = parse_item(&raw)?;
        let dateless = item.completed && item.completion_date.is_none();
        if dateless && (!original.completed || original.completion_date.is_some()) {
            return Err(COMPLETION_DATE_REQUIRED);
        }
        Ok(Self {
            raw,
            item,
            editing: true,
        })
    }

    /// The line that will be written.
    pub fn raw(&self) -> &str {
        &self.raw
    }

    /// The Priority a recurring successor takes: the leading one, else a one-letter `pri:`.
    fn saved_priority(&self) -> Option<char> {
        self.item.priority.or_else(|| {
            let value = self.item.metadata_value("pri")?;
            let mut chars = value.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii_uppercase() => Some(c),
                _ => None,
            }
        })
    }
}

/// Which date of a typed line the date helper sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineDate {
    /// The effective `due:` token.
    Due,
    /// The effective `t:` token.
    ShowFrom,
    Creation,
}

/// The whitespace-delimited word the caret at byte `caret` is in or directly after, for
/// autocomplete; `None` on whitespace.
pub fn line_word_at(line: &str, caret: usize) -> Option<Range<usize>> {
    word_spans(line)
        .into_iter()
        .find(|word| word.start < caret && caret <= word.end)
}

/// The byte ranges of `line`'s whitespace-delimited words.
fn word_spans(line: &str) -> Vec<Range<usize>> {
    let mut spans = Vec::new();
    let mut start = None;
    for (i, c) in line.char_indices() {
        match (c.is_whitespace(), start) {
            (true, Some(s)) => {
                spans.push(s..i);
                start = None;
            }
            (false, None) => start = Some(i),
            _ => {}
        }
    }
    spans.extend(start.map(|s| s..line.len()));
    spans
}

/// `line` with the word at `word` removed and the Priority set to `priority` (`pri:A` written
/// in a Todo line is the Priority `(A)`), where the parser reads it: after `x` and the
/// Completion date of a completed line. Returns the line and the caret where the word was.
pub fn line_with_priority(line: &str, word: Range<usize>, priority: char) -> (String, usize) {
    let rest = line[word.end..].trim_start();
    let mut out = format!("{}{rest}", &line[..word.start]);
    let at = priority_offset(&out);
    let existing = matches!(
        out.as_bytes().get(at..at + 4),
        Some([b'(', c, b')', b' ']) if c.is_ascii_uppercase()
    );
    let token = format!("({priority}) ");
    if existing {
        out.replace_range(at..at + 4, &token);
    } else {
        out.insert_str(at, &token);
    }
    let shift = if existing || word.start < at { 0 } else { 4 };
    (out, word.start + shift)
}

/// `line` with one date set by the date helper: the last `due:` or `t:` token gets the new
/// value in place (or a token is appended), and the Creation date is replaced or inserted where
/// the parser reads it (after `x`, its Completion date, and the Priority). A Creation date is
/// refused where the parser would read it as something else: on a line that does not parse, and
/// after a bare `x`, where a first date is the Completion date.
pub fn line_with_date(
    line: &str,
    target: LineDate,
    date: TodoDate,
) -> Result<String, &'static str> {
    let key = match target {
        LineDate::Due => "due:",
        LineDate::ShowFrom => "t:",
        LineDate::Creation => return line_with_creation_date(line, date),
    };
    let last = word_spans(line)
        .into_iter()
        .rfind(|word| line[word.clone()].starts_with(key));
    Ok(match last {
        Some(word) => {
            let mut out = line.to_owned();
            out.replace_range(word.start + key.len()..word.end, date.as_str());
            out
        }
        None if line.is_empty() || line.ends_with(char::is_whitespace) => {
            format!("{line}{key}{date}")
        }
        None => format!("{line} {key}{date}"),
    })
}

fn line_with_creation_date(line: &str, date: TodoDate) -> Result<String, &'static str> {
    let parse = |raw: &str| {
        let file = parse_todo_text(PathBuf::new(), raw);
        file.items
            .into_iter()
            .next()
            .filter(|_| file.skipped.is_empty())
    };
    let item = parse(line).ok_or(INVALID_DATE)?;
    if item.completed && item.completion_date.is_none() {
        return Err(CREATION_NEEDS_COMPLETION);
    }
    let mut out = line.to_owned();
    let offset = creation_date_offset(line);
    if item.creation_date.is_some() {
        out.replace_range(offset..offset + 10, date.as_str());
    } else {
        let separator = if offset == line.len() { "" } else { " " };
        out.insert_str(offset, &format!("{date}{separator}"));
    }
    // Only the Creation date may change.
    let after = parse(&out).ok_or(INVALID_DATE)?;
    let kept = after.completed == item.completed
        && after.completion_date == item.completion_date
        && after.priority == item.priority
        && after.creation_date == Some(date);
    if kept {
        Ok(out)
    } else {
        Err(CREATION_NEEDS_COMPLETION)
    }
}

/// The edited line for `item`: the app-owned successor-generated marker survives even when the
/// typed line dropped it.
fn edit_line(item: &TodoItem, line: &TodoLine) -> String {
    let marker = format!("{GENERATION_MARKER}:");
    let kept = line
        .item
        .metadata
        .iter()
        .any(|(k, _)| k == GENERATION_MARKER);
    if kept || !item.metadata.iter().any(|(k, _)| k == GENERATION_MARKER) {
        return line.raw.clone();
    }
    std::iter::once(line.raw.as_str())
        .chain(
            item.edit
                .metadata
                .iter()
                .filter(|t| t.starts_with(&marker))
                .map(String::as_str),
        )
        .collect::<Vec<_>>()
        .join(" ")
}

/// `appendTodoLine`: appends one physical line, keeping every byte and the file's first line
/// ending (LF when it has none).
fn append_line(file: &TodoFile, raw: &str) -> String {
    let source = &file.source;
    if source.is_empty() {
        return raw.to_owned();
    }
    let newline = file
        .lines
        .first()
        .map(|line| ending_str(line.ending))
        .filter(|e| !e.is_empty())
        .unwrap_or("\n");
    if source.ends_with('\n') {
        format!("{source}{raw}{newline}")
    } else {
        format!("{source}{newline}{raw}")
    }
}

/// A Todo-item editor command, planned against the file read in the background step.
#[derive(Debug, Clone)]
pub(crate) enum EditorChange {
    /// Appends when the file still holds exactly the confirmed contents.
    Create {
        expected: String,
        line: TodoLine,
        hidden: Option<String>,
    },
    /// Replaces the target's line when it still holds the expected raw text.
    Edit {
        target: TodoTarget,
        line: TodoLine,
        today: TodoDate,
        hidden: Option<String>,
    },
}

/// What an editor command does to the current file.
pub(crate) enum EditorPlan {
    Conflict(&'static str),
    Write {
        contents: String,
        notice: Option<String>,
    },
}

impl EditorChange {
    pub(crate) fn undo_label(&self) -> &'static str {
        match self {
            Self::Create { .. } => "Undo creation",
            Self::Edit { .. } => "Undo edit",
        }
    }

    pub(crate) fn plan(&self, file: &TodoFile) -> Result<EditorPlan, &'static str> {
        match self {
            Self::Create {
                expected,
                line,
                hidden,
            } => Ok(if file.source == *expected {
                EditorPlan::Write {
                    contents: append_line(file, line.raw()),
                    notice: hidden.clone(),
                }
            } else {
                EditorPlan::Conflict("The Todo file changed on disk. Review its current contents.")
            }),
            Self::Edit {
                target,
                line,
                today,
                hidden,
            } => {
                let item = file
                    .items
                    .iter()
                    .find(|item| item.line_number == target.line_number)
                    .filter(|item| item.raw == target.expected_raw);
                let Some(item) = item else {
                    return Ok(EditorPlan::Conflict(
                        "The Todo item changed on disk. Review its current contents.",
                    ));
                };
                let fields = &line.item;
                if fields.completed
                    && fields.completion_date.is_none()
                    && (!item.completed || item.completion_date.is_some())
                {
                    return Err(COMPLETION_DATE_REQUIRED);
                }
                let raw = edit_line(item, line);
                let (raw, notice) = if fields.completed && !item.completed {
                    // The successor takes the saved Priority, not the source line's.
                    let source = TodoItem {
                        priority: line.saved_priority(),
                        ..item.clone()
                    };
                    let index = item.line_number as usize - 1;
                    let ending = ending_str(file.lines[index].ending);
                    let first = file.lines.first().map(|l| ending_str(l.ending));
                    let plan = plan_recurring_completion(
                        &source,
                        raw,
                        *today,
                        ending,
                        first.filter(|e| !e.is_empty()),
                    )?;
                    (plan.raw, plan.notice)
                } else {
                    (raw, hidden.clone())
                };
                Ok(EditorPlan::Write {
                    contents: replace_line(file, item.line_number, &raw),
                    notice,
                })
            }
        }
    }
}

fn invalid(message: &str) -> CoreError {
    CoreError::InvalidCommand {
        message: message.to_owned(),
    }
}

impl WorkspaceSession {
    /// Why a saved open item will not be listed: a future Show from date while the Workspace's
    /// Show deferred preference is off.
    fn hidden_notice(&self, line: &TodoLine, today: TodoDate) -> Option<String> {
        let show_deferred = self
            .selected
            .as_ref()
            .and_then(|s| s.workspace.show_deferred)
            .unwrap_or(false);
        let show_from = line
            .item
            .metadata_value("t")
            .and_then(TodoDate::parse)
            .filter(|d| *d > today);
        match show_from {
            Some(date) if !show_deferred && !line.item.completed => Some(format!(
                "Hidden until Show from {date}. Use Show deferred to see it."
            )),
            _ => None,
        }
    }

    /// Foreground step of Todo-item creation: appends `line` to the selected Workspace's Todo
    /// file as long as the file still holds the contents confirmed at `revision`. Refuses
    /// another Workspace or an older revision as [`CoreError::StaleCommand`]. A future Show
    /// from date the person would not see is reported in the result's notice. Performs no I/O.
    pub fn prepare_create_line(
        &self,
        catalogue_path: &Path,
        workspace_id: &str,
        revision: u64,
        line: TodoLine,
        today: TodoDate,
    ) -> Result<crate::TodoWriteRequest, CoreError> {
        if line.editing {
            return Err(invalid("Invalid Todo item."));
        }
        let expected = self
            .selected
            .as_ref()
            .map(|s| s.file.source.clone())
            .unwrap_or_default();
        let hidden = self.hidden_notice(&line, today);
        let change = EditorChange::Create {
            expected,
            line,
            hidden,
        };
        self.prepare_editor_write(catalogue_path, workspace_id, revision, change)
    }

    /// Foreground step of Todo-item editing: replaces only the target's physical line with
    /// `line`, keeping its position and line ending. Completing an open item this way generates
    /// a recurring successor dated `today`. Performs no I/O.
    pub fn prepare_edit_line(
        &self,
        catalogue_path: &Path,
        target: TodoTarget,
        line: TodoLine,
        today: TodoDate,
    ) -> Result<crate::TodoWriteRequest, CoreError> {
        let expected = parse_todo_text(PathBuf::new(), &target.expected_raw);
        if !line.editing
            || expected.items.len() != 1
            || !expected.skipped.is_empty()
            || target.expected_raw.contains('\n')
        {
            return Err(invalid("Invalid Todo item target."));
        }
        let (workspace_id, revision) = (target.workspace_id.clone(), target.revision);
        let hidden = self.hidden_notice(&line, today);
        let change = EditorChange::Edit {
            target,
            line,
            today,
            hidden,
        };
        self.prepare_editor_write(catalogue_path, &workspace_id, revision, change)
    }
}
