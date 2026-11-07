//! Todo-item creation and editing through the shared Todo-item editor, with parity to
//! `packages/backend/src/create-todo.ts`, `editTodo` in `todo-operations.ts`, the form rules in
//! `packages/contracts/src/todo-creation.ts`, and the field handling of `TodoEditorDialog.svelte`.
//!
//! A [`TodoDraft`] holds the editor's values as typed; [`TodoDraft::validate`] turns it into
//! [`TodoFields`] or field errors with the Electron messages. Only validated fields reach
//! [`WorkspaceSession::prepare_create`] and [`WorkspaceSession::prepare_edit`], whose requests run
//! through [`crate::TodoWriteRequest::execute`] like every other Todo-file command.

use std::path::{Path, PathBuf};

use crate::date::is_date_shaped;
use crate::recurrence::{normalize_description, plan_recurring_completion, GENERATION_MARKER};
use crate::todo_write::{ending_str, replace_line};
use crate::{
    js_trim, parse_todo_text, CoreError, TodoDate, TodoFile, TodoItem, TodoTarget, WorkspaceSession,
};

const INVALID_DATE: &str = "Use a valid date in YYYY-MM-DD format.";
const INVALID_PRIORITY: &str = "Choose None, A, B, C, or enter one letter from D to Z.";
const DESCRIPTION_TOKENS: &str = "Use the Project, Context, and Metadata inputs for these tokens.";
const COMPLETION_DATE_REQUIRED: &str = "Choose a Completion date for a completed Todo item.";
const INVALID_INTERVAL: &str = "Enter a positive whole-number interval.";

/// The editor field a validation message belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DraftField {
    Description,
    Projects,
    Contexts,
    Priority,
    CreationDate,
    CompletionDate,
    Metadata,
    RepeatInterval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldError {
    pub field: DraftField,
    pub message: &'static str,
}

/// The Priority picker: None, a letter, or "Other" before a valid D–Z letter was entered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PriorityChoice {
    #[default]
    None,
    Letter(char),
    Incomplete,
}

/// The Repeat control. `Unsupported` marks a `rec:` value the controls cannot show; it stays in
/// Metadata until changed or turned off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RepeatUnit {
    #[default]
    Off,
    Unsupported,
    Day,
    Week,
    Month,
    Year,
}

impl RepeatUnit {
    fn suffix(self) -> Option<char> {
        match self {
            Self::Day => Some('d'),
            Self::Week => Some('w'),
            Self::Month => Some('m'),
            Self::Year => Some('y'),
            Self::Off | Self::Unsupported => None,
        }
    }
}

/// The editor's values as typed. Dates are text (empty means none); Due date, Show from and
/// Repeat live in `metadata` as their `due:`, `t:` and `rec:` tokens, as in the Electron editor.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TodoDraft {
    pub description: String,
    pub projects: Vec<String>,
    pub contexts: Vec<String>,
    pub priority: PriorityChoice,
    pub creation_date: String,
    pub completed: bool,
    pub completion_date: String,
    pub metadata: Vec<String>,
    pub repeat_interval: String,
    pub repeat_unit: RepeatUnit,
}

impl TodoDraft {
    /// A new Todo item's defaults: open, created `today`, no Repeat.
    pub fn new_item(today: TodoDate) -> Self {
        let mut draft = Self {
            creation_date: today.to_string(),
            ..Self::default()
        };
        draft.sync_repeat();
        draft
    }

    /// An existing Todo item's values. Repeated Projects and Contexts appear once.
    pub fn from_item(item: &TodoItem) -> Self {
        let mut draft = Self {
            description: item.edit.description.clone(),
            projects: unique(&item.projects),
            contexts: unique(&item.contexts),
            priority: item
                .priority
                .map_or(PriorityChoice::None, PriorityChoice::Letter),
            creation_date: item
                .creation_date
                .map(|d| d.to_string())
                .unwrap_or_default(),
            completed: item.completed,
            completion_date: item
                .completion_date
                .map(|d| d.to_string())
                .unwrap_or_default(),
            metadata: item.edit.metadata.clone(),
            ..Self::default()
        };
        draft.sync_repeat();
        draft
    }

    fn last_value(&self, key: &str) -> Option<&str> {
        let prefix = format!("{key}:");
        self.metadata
            .iter()
            .rev()
            .find_map(|token| token.strip_prefix(prefix.as_str()))
    }

    /// The effective `due:` value when it is a valid date; a malformed value stays in Metadata.
    pub fn due_date(&self) -> Option<TodoDate> {
        self.last_value("due").and_then(TodoDate::parse)
    }

    /// The effective `t:` value, valid or not.
    pub fn show_from_token(&self) -> Option<&str> {
        self.last_value("t")
    }

    /// The effective `t:` value when it is a valid date.
    pub fn show_from(&self) -> Option<TodoDate> {
        self.show_from_token().and_then(TodoDate::parse)
    }

    /// The effective `rec:` value, valid or not.
    pub fn repeat_token(&self) -> Option<&str> {
        self.last_value("rec")
    }

    /// Replaces every `due:` token with `due:<date>`, or removes them all.
    pub fn set_due_date(&mut self, date: Option<TodoDate>) {
        self.replace_tokens("due", date.map(|d| d.to_string()));
    }

    /// Replaces every `t:` token with `t:<date>`, or removes them all.
    pub fn set_show_from(&mut self, date: Option<TodoDate>) {
        self.replace_tokens("t", date.map(|d| d.to_string()));
    }

    fn replace_tokens(&mut self, key: &str, value: Option<String>) {
        let prefix = format!("{key}:");
        self.metadata.retain(|token| !token.starts_with(&prefix));
        if let Some(value) = value {
            self.metadata.push(format!("{prefix}{value}"));
        }
    }

    /// Replaces the Metadata list; Repeat follows when the `rec:` tokens changed.
    pub fn set_metadata(&mut self, metadata: Vec<String>) {
        let rules = |m: &[String]| -> Vec<String> {
            m.iter()
                .filter(|t| t.starts_with("rec:"))
                .cloned()
                .collect()
        };
        let changed = rules(&metadata) != rules(&self.metadata);
        self.metadata = metadata;
        if changed {
            self.sync_repeat();
        }
    }

    /// Sets the Repeat controls; Metadata gets the rule only when it is valid (or Off removes it).
    pub fn set_repeat(&mut self, interval: &str, unit: RepeatUnit) {
        self.repeat_interval = interval.to_owned();
        self.repeat_unit = unit;
        let rule = unit.suffix().map(|suffix| format!("{interval}{suffix}"));
        if matches!(&rule, Some(rule) if !is_repeat_rule(rule)) || unit == RepeatUnit::Unsupported {
            return;
        }
        self.replace_tokens("rec", rule);
    }

    /// Checks or unchecks Completed; checking keeps a chosen Completion date or uses `today`.
    pub fn set_completed(&mut self, completed: bool, today: TodoDate) {
        self.completed = completed;
        self.completion_date = match completed {
            true if !self.completion_date.is_empty() => std::mem::take(&mut self.completion_date),
            true => today.to_string(),
            false => String::new(),
        };
    }

    fn sync_repeat(&mut self) {
        let value = self.repeat_token().map(str::to_owned);
        (self.repeat_interval, self.repeat_unit) = match value {
            Some(rule) if is_repeat_rule(&rule) => {
                let (interval, unit) = rule.split_at(rule.len() - 1);
                let unit = match unit {
                    "d" => RepeatUnit::Day,
                    "w" => RepeatUnit::Week,
                    "m" => RepeatUnit::Month,
                    _ => RepeatUnit::Year,
                };
                (interval.to_owned(), unit)
            }
            Some(_) => ("1".to_owned(), RepeatUnit::Unsupported),
            None => ("1".to_owned(), RepeatUnit::Off),
        };
    }

    /// Validates the draft for a new Todo item (`editing == false`) or an edit, returning the
    /// fields to save or every field error. Cross-field rules run only once each field is valid.
    pub fn validate(&self, editing: bool) -> Result<TodoFields, Vec<FieldError>> {
        let mut errors = Vec::new();
        let mut error = |field, message| errors.push(FieldError { field, message });
        if contains_todo_token(&self.description) {
            error(DraftField::Description, DESCRIPTION_TOKENS);
        }
        for (field, tags) in [
            (DraftField::Projects, &self.projects),
            (DraftField::Contexts, &self.contexts),
        ] {
            if let Some(message) = tags_issue(tags) {
                error(field, message);
            }
        }
        let priority = match self.priority {
            PriorityChoice::None => None,
            PriorityChoice::Letter(c) if c.is_ascii_uppercase() => Some(c),
            _ => {
                error(DraftField::Priority, INVALID_PRIORITY);
                None
            }
        };
        let mut date = |field, value: &str| match value {
            "" => None,
            value => TodoDate::parse(value).or_else(|| {
                error(field, INVALID_DATE);
                None
            }),
        };
        let creation_date = date(DraftField::CreationDate, &self.creation_date);
        let completion_date = date(DraftField::CompletionDate, &self.completion_date);
        if let Some(message) = self.metadata.iter().find_map(|t| metadata_issue(t)) {
            error(DraftField::Metadata, message);
        }
        if !errors.is_empty() {
            return Err(errors);
        }
        let fields = TodoFields {
            description: normalize_description(&self.description),
            projects: self.projects.clone(),
            contexts: self.contexts.clone(),
            priority,
            creation_date,
            completed: self.completed,
            completion_date,
            metadata: self.metadata.clone(),
            editing,
        };
        let mut errors = fields.issues();
        if self
            .repeat_unit
            .suffix()
            .is_some_and(|suffix| !is_repeat_rule(&format!("{}{suffix}", self.repeat_interval)))
        {
            errors.push(FieldError {
                field: DraftField::RepeatInterval,
                message: INVALID_INTERVAL,
            });
        }
        if errors.is_empty() {
            Ok(fields)
        } else {
            Err(errors)
        }
    }
}

/// Validated editor values: description normalized, dates and Priority parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoFields {
    description: String,
    projects: Vec<String>,
    contexts: Vec<String>,
    priority: Option<char>,
    creation_date: Option<TodoDate>,
    completed: bool,
    completion_date: Option<TodoDate>,
    metadata: Vec<String>,
    /// Which rules validated these fields: editing allows legacy completed forms.
    editing: bool,
}

impl TodoFields {
    pub fn completed(&self) -> bool {
        self.completed
    }

    /// The `t:` value when valid, for the "hidden until Show from" notice.
    pub fn show_from(&self) -> Option<TodoDate> {
        self.metadata
            .iter()
            .rev()
            .find_map(|t| t.strip_prefix("t:"))
            .and_then(TodoDate::parse)
    }

    /// `todoCreationIssues`: the cross-field rules.
    fn issues(&self) -> Vec<FieldError> {
        let mut errors = Vec::new();
        let mut error = |field, message| errors.push(FieldError { field, message });
        let (editing, completed, priority) = (self.editing, self.completed, self.priority);
        if completed
            && self.completion_date.is_none()
            && (!editing || (self.creation_date.is_some() && priority.is_none()))
        {
            error(DraftField::CompletionDate, COMPLETION_DATE_REQUIRED);
        }
        if !completed && self.completion_date.is_some() {
            error(
                DraftField::CompletionDate,
                "Only completed Todo items have a Completion date.",
            );
        }
        if !editing
            && completed
            && priority.is_some()
            && self.metadata.iter().any(|t| t.starts_with("pri:"))
        {
            error(
                DraftField::Metadata,
                "Remove pri Metadata or clear Priority; Priority is saved as pri Metadata on completion.",
            );
        }
        let description = self.description.as_str();
        let followed_by_tokens = !self.projects.is_empty()
            || !self.contexts.is_empty()
            || !self.metadata.is_empty()
            || (completed && priority.is_some());
        let leading = format!("{description}{}", if followed_by_tokens { " " } else { "" });
        if description.is_empty()
            && self.projects.is_empty()
            && self.contexts.is_empty()
            && self.metadata.is_empty()
            && priority.is_none()
            && self.creation_date.is_none()
            && !completed
        {
            error(
                DraftField::Description,
                "Enter a Description or another Todo-item value.",
            );
        }
        // Prefix-looking text would be parsed as structured fields when dates are omitted.
        let date_prefix = description.get(..10).is_some_and(is_date_shaped)
            && matches!(description.as_bytes().get(10), None | Some(b' '));
        let priority_prefix = {
            let b = leading.as_bytes();
            b.len() >= 4
                && b[0] == b'('
                && b[1].is_ascii_uppercase()
                && b[2] == b')'
                && b[3] == b' '
        };
        if self.creation_date.is_none()
            && (date_prefix
                || ((priority.is_none() || (completed && !editing)) && priority_prefix)
                || (!completed && priority.is_none() && leading.starts_with("x ")))
        {
            error(
                DraftField::Description,
                "Use the Priority, date, and Completed controls for leading Todo markers.",
            );
        }
        errors
    }
}

/// `TodoTag` and uniqueness for a whole list.
fn tags_issue(tags: &[String]) -> Option<&'static str> {
    if tags.iter().any(|tag| !is_tag(tag)) {
        return Some("Todo tags must be trimmed and must not contain whitespace");
    }
    let unique = tags
        .iter()
        .enumerate()
        .all(|(i, tag)| !tags[..i].contains(tag));
    (!unique).then_some("Todo tags must be unique")
}

/// JavaScript's `\s`: Unicode White_Space without U+0085, plus U+FEFF.
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

fn is_tag(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(|c| is_js_space(c) || c.is_whitespace())
}

/// Validates a Project or Context typed into its tag input (`validateTag` in the editor): a
/// typed leading `prefix` is dropped, but not from a chosen suggestion, whose name is exact.
pub fn validate_tag(
    value: &str,
    tags: &[String],
    prefix: char,
    from_suggestion: bool,
) -> Result<String, &'static str> {
    let trimmed = js_trim(value);
    let clean = match trimmed.strip_prefix(prefix) {
        Some(rest) if !from_suggestion => rest,
        _ => trimmed,
    };
    if !is_tag(clean) {
        return Err("Use a tag name without spaces.");
    }
    if tags.iter().any(|tag| tag == clean) {
        return Err("That tag is already selected.");
    }
    Ok(clean.to_owned())
}

/// Validates one typed Metadata token (`TodoMetadata`), returning it trimmed.
pub fn validate_metadata_token(value: &str) -> Result<String, &'static str> {
    let clean = js_trim(value);
    metadata_issue(clean).map_or_else(|| Ok(clean.to_owned()), Err)
}

/// `TodoMetadata`: `key:value` without whitespace or extra colons, or `board:` with any value.
fn metadata_issue(value: &str) -> Option<&'static str> {
    let part = |s: &str| {
        !s.is_empty()
            && !s
                .chars()
                .any(|c| c == ':' || is_js_space(c) || c.is_whitespace())
    };
    let pair = value
        .split_once(':')
        .is_some_and(|(key, rest)| part(key) && part(rest));
    let board = value
        .strip_prefix("board:")
        .is_some_and(|rest| !rest.chars().any(char::is_whitespace));
    if !pair && !board {
        Some("Use key:value without spaces or extra colons.")
    } else if value.starts_with(['+', '@']) {
        Some("Metadata keys must not start with + or @.")
    } else {
        None
    }
}

/// `containsTodoToken`: description text the parser would read as a Project, Context or
/// Metadata token.
fn contains_todo_token(value: &str) -> bool {
    normalize_description(value).split(' ').any(|token| {
        let tag = token.len() > 1
            && token.starts_with(['+', '@'])
            && !token[1..].chars().any(is_js_space);
        let pair = token.split_once(':').is_some_and(|(key, value)| {
            let part = |s: &str| !s.is_empty() && !s.chars().any(|c| c == ':' || c.is_whitespace());
            part(key) && part(value)
        });
        token.starts_with("board:") || tag || pair
    })
}

/// `TodoRepeatRule`: `^[1-9][0-9]*[dwmy]$`.
fn is_repeat_rule(rule: &str) -> bool {
    let b = rule.as_bytes();
    b.len() >= 2
        && matches!(b[b.len() - 1], b'd' | b'w' | b'm' | b'y')
        && (b'1'..=b'9').contains(&b[0])
        && b[1..b.len() - 1].iter().all(u8::is_ascii_digit)
}

fn unique(values: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(values.len());
    for value in values {
        if !out.contains(value) {
            out.push(value.clone());
        }
    }
    out
}

/// `createTodoLine`: the canonical line for `fields` (Priority, dates, description, Projects,
/// Contexts, then Metadata; a completed item keeps its Priority as trailing `pri:` Metadata).
pub(crate) fn create_line(fields: &TodoFields) -> String {
    let completed = fields.completed;
    let priority = fields.priority.map(|p| format!("({p})"));
    let mut parts: Vec<String> = Vec::new();
    if completed {
        parts.push("x".to_owned());
        parts.extend(fields.completion_date.map(|d| d.to_string()));
    } else {
        parts.extend(priority.clone());
    }
    parts.extend(fields.creation_date.map(|d| d.to_string()));
    parts.push(fields.description.clone());
    parts.extend(fields.projects.iter().map(|p| format!("+{p}")));
    parts.extend(fields.contexts.iter().map(|c| format!("@{c}")));
    parts.extend(fields.metadata.iter().cloned());
    if let (true, Some(p)) = (completed, fields.priority) {
        parts.push(format!("pri:{p}"));
    }
    parts.retain(|part| !part.is_empty());
    let line = parts.join(" ");
    let bare = (completed && line == "x") || (!completed && priority.as_deref() == Some(&*line));
    if bare {
        format!("{line} ")
    } else {
        line
    }
}

/// The edited line for `item`: the app-owned successor-generated marker survives even when the
/// draft dropped it, and a completed item with a Priority keeps the legacy `x <date> (A)` form.
pub(crate) fn edit_line(item: &TodoItem, fields: &TodoFields) -> String {
    let marker = format!("{GENERATION_MARKER}:");
    let mut metadata: Vec<String> = fields
        .metadata
        .iter()
        .filter(|t| !t.starts_with(&marker))
        .cloned()
        .collect();
    if item.metadata.iter().any(|(k, _)| k == GENERATION_MARKER) {
        metadata.extend(
            item.edit
                .metadata
                .iter()
                .filter(|t| t.starts_with(&marker))
                .cloned(),
        );
    }
    let saved = TodoFields {
        metadata,
        ..fields.clone()
    };
    if !(fields.completed && fields.priority.is_some()) {
        return create_line(&saved);
    }
    let open = create_line(&TodoFields {
        completed: false,
        completion_date: None,
        ..saved
    });
    ["x".to_owned()]
        .into_iter()
        .chain(fields.completion_date.map(|d| d.to_string()))
        .chain([open])
        .filter(|part| !part.is_empty())
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
        fields: TodoFields,
        hidden: Option<String>,
    },
    /// Replaces the target's line when it still holds the expected raw text.
    Edit {
        target: TodoTarget,
        fields: TodoFields,
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
                fields,
                hidden,
            } => Ok(if file.source == *expected {
                EditorPlan::Write {
                    contents: append_line(file, &create_line(fields)),
                    notice: hidden.clone(),
                }
            } else {
                EditorPlan::Conflict("The Todo file changed on disk. Review its current contents.")
            }),
            Self::Edit {
                target,
                fields,
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
                if fields.completed
                    && item.completion_date.is_some()
                    && fields.completion_date.is_none()
                {
                    return Err(COMPLETION_DATE_REQUIRED);
                }
                let raw = edit_line(item, fields);
                let (raw, notice) = if fields.completed && !item.completed {
                    // The successor takes the saved Priority, not the source line's.
                    let source = TodoItem {
                        priority: fields.priority,
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
    fn hidden_notice(&self, fields: &TodoFields, today: TodoDate) -> Option<String> {
        let show_deferred = self
            .selected
            .as_ref()
            .and_then(|s| s.workspace.show_deferred)
            .unwrap_or(false);
        let show_from = fields.show_from().filter(|d| *d > today);
        match show_from {
            Some(date) if !show_deferred && !fields.completed => Some(format!(
                "Hidden until Show from {date}. Use Show deferred to see it."
            )),
            _ => None,
        }
    }

    /// Foreground step of Todo-item creation: appends `fields` to the selected Workspace's Todo
    /// file as long as the file still holds the contents confirmed at `revision`. Refuses another
    /// Workspace or an older revision as [`CoreError::StaleCommand`]. A future Show from date the person would
    /// not see is reported in the result's notice. Performs no I/O.
    pub fn prepare_create(
        &self,
        catalogue_path: &Path,
        workspace_id: &str,
        revision: u64,
        fields: TodoFields,
        today: TodoDate,
    ) -> Result<crate::TodoWriteRequest, CoreError> {
        if fields.editing {
            return Err(invalid("Invalid Todo item."));
        }
        let expected = self
            .selected
            .as_ref()
            .map(|s| s.file.source.clone())
            .unwrap_or_default();
        let hidden = self.hidden_notice(&fields, today);
        let change = EditorChange::Create {
            expected,
            fields,
            hidden,
        };
        self.prepare_editor_write(catalogue_path, workspace_id, revision, change)
    }

    /// Foreground step of Todo-item editing: replaces only the target's physical line, keeping
    /// its position and line ending. Completing an open item through the editor generates a
    /// recurring successor dated `today`. Performs no I/O.
    pub fn prepare_edit(
        &self,
        catalogue_path: &Path,
        target: TodoTarget,
        fields: TodoFields,
        today: TodoDate,
    ) -> Result<crate::TodoWriteRequest, CoreError> {
        let expected = parse_todo_text(PathBuf::new(), &target.expected_raw);
        if !fields.editing
            || expected.items.len() != 1
            || !expected.skipped.is_empty()
            || target.expected_raw.contains('\n')
        {
            return Err(invalid("Invalid Todo item target."));
        }
        let (workspace_id, revision) = (target.workspace_id.clone(), target.revision);
        let hidden = self.hidden_notice(&fields, today);
        let change = EditorChange::Edit {
            target,
            fields,
            today,
            hidden,
        };
        self.prepare_editor_write(catalogue_path, &workspace_id, revision, change)
    }
}
