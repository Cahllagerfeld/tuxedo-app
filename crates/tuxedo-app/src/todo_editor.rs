//! The shared Todo-item editor: one gpui-kit dialog for a new Todo item and for editing an
//! existing one, with the Electron editor's fields (`TodoEditorDialog.svelte`). The draft and its
//! validation live in `tuxedo_core::TodoDraft`; this module owns the inputs, shows each field's
//! error inline, and enqueues a Todo command only once the draft is valid. Outcomes (conflicts,
//! failures, notices) arrive through the app's notifications like every other command's; the
//! editor also hears its own command's outcome and closes only once it is saved, keeping the draft
//! after a failure or a creation conflict, as in Electron.
//!
//! The editor is bound to the Workspace and revision shown when it opened. It closes when another
//! Workspace is shown and never retargets its change to it.

use std::cell::Cell;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::dialog::{DialogAction, DialogClose, DialogFooter};
use gpui_kit::component::input::{Enter, Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, Disableable, Sizable, WindowExt as _};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{
    validate_metadata_token, validate_tag, DraftField, FieldError, PriorityChoice, RepeatUnit,
    TodoDate, TodoDraft, TodoItem, TodoTarget,
};

use crate::command_queue::{Command, TodoCommand};
use crate::model::SessionModel;
use crate::theme::{hex, Palette, MONO_FONT};
use crate::todo_commands::{local_today, Replied, Reply};

actions!(tuxedo, [NewTodoItem]);

const INVALID_DATE: &str = "Use a valid date in YYYY-MM-DD format.";
const DATE_PLACEHOLDER: &str = "YYYY-MM-DD";

/// Opens the editor for a new Todo item in the displayed Workspace.
pub fn open_new(session: Entity<SessionModel>, window: &mut Window, cx: &mut App) {
    open(session, None, window, cx);
}

/// Screenshot mode's `TUXEDO_EDITOR`: `new`, or the physical line of the item to edit; a
/// `!<description>` suffix types that description and saves once, showing any errors.
#[cfg(feature = "screenshot")]
pub fn open_for_screenshot(
    session: Entity<SessionModel>,
    spec: &str,
    window: &mut Window,
    cx: &mut App,
) {
    let (spec, typed) = match spec.split_once('!') {
        Some((spec, typed)) => (spec, Some(typed.to_owned())),
        None => (spec, None),
    };
    let item = match spec {
        "new" => None,
        line => {
            let line: u32 = line.parse().unwrap_or(0);
            let selected = session.read(cx).selected();
            let item = selected.and_then(|s| s.file.items.iter().find(|i| i.line_number == line));
            let Some(item) = item.cloned() else {
                eprintln!("tuxedo: no Todo item on line {line}");
                return;
            };
            Some(item)
        }
    };
    let Some(editor) = open(session, item, window, cx) else {
        return;
    };
    if let Some(typed) = typed {
        editor.update(cx, |editor, cx| {
            editor
                .description
                .update(cx, |s, cx| s.set_value(typed.clone(), window, cx));
            editor.draft.description = typed;
            editor.submit(window, cx);
        });
    }
}

/// Opens the editor for `item` of the displayed Workspace.
pub fn open_edit(
    session: Entity<SessionModel>,
    item: &TodoItem,
    window: &mut Window,
    cx: &mut App,
) {
    open(session, Some(item.clone()), window, cx);
}

fn open(
    session: Entity<SessionModel>,
    item: Option<TodoItem>,
    window: &mut Window,
    cx: &mut App,
) -> Option<Entity<TodoEditor>> {
    session.read(cx).selected()?;
    let editing = item.is_some();
    let editor = cx.new(|cx| TodoEditor::new(session, item, window, cx));
    let description = editor.read(cx).description.clone();
    // `open_dialog` focuses the dialog shell; focus the description once, on the first build.
    let initial_focus = Cell::new(true);
    let opened = editor.clone();
    window.open_dialog(cx, move |dialog, window, cx| {
        if initial_focus.replace(false) {
            description.update(cx, |input, cx| input.focus(window, cx));
        }
        let submit = editor.clone();
        let saving = editor.read(cx).reply.is_some();
        dialog
            .title(if editing {
                "Edit Todo item"
            } else {
                "New Todo item"
            })
            .w(px(600.))
            .child(editor.clone())
            .footer(
                DialogFooter::new()
                    .child(DialogClose::new().trigger(|button| button.label("Cancel")))
                    .child(DialogAction::new().child(
                        Button::new("save-todo").primary().disabled(saving).label(
                            match (editing, saving) {
                                (true, false) => "Save changes",
                                (true, true) => "Saving…",
                                (false, false) => "Add Todo item",
                                (false, true) => "Adding…",
                            },
                        ),
                    )),
            )
            // Esc, Cancel, the close button: the editor stops following the session at once,
            // so while this dialog animates out it cannot close a newer one.
            .on_close({
                let editor = editor.clone();
                move |_, _, cx| editor.update(cx, |editor, _| editor.dismissed())
            })
            // The dialog stays open; the editor closes it once its change is saved.
            .on_ok(move |_, window, cx| {
                submit.update(cx, |editor, cx| editor.submit(window, cx));
                false
            })
    });
    Some(opened)
}

/// The editor's text inputs; each routes its edits to [`TodoEditor::changed`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    Description,
    Projects,
    Contexts,
    OtherPriority,
    Due,
    ShowFrom,
    CreationDate,
    RepeatInterval,
    CompletionDate,
    Metadata,
}

/// A tag list's typed entry and why its last entry was refused.
struct TagInput {
    input: Entity<InputState>,
    error: Option<&'static str>,
}

struct TodoEditor {
    session: Entity<SessionModel>,
    /// The Workspace shown when the editor opened; its change never goes anywhere else.
    workspace_id: String,
    /// The revision the change is admitted against; follows refreshes of the same Workspace.
    revision: u64,
    /// The queued change's outcome, while saving.
    reply: Option<Reply>,
    /// The Todo item being edited; `None` for a new one.
    item: Option<TodoItem>,
    /// "Workspace · todo.txt", the Todo file the editor writes.
    target_label: String,
    draft: TodoDraft,
    today: TodoDate,
    description: Entity<InputState>,
    projects: TagInput,
    contexts: TagInput,
    metadata: TagInput,
    other_priority: Entity<InputState>,
    /// The Priority picker's Other letter input is shown.
    other: bool,
    due: Entity<InputState>,
    show_from: Entity<InputState>,
    creation_date: Entity<InputState>,
    completion_date: Entity<InputState>,
    repeat_interval: Entity<InputState>,
    /// Typed Due date / Show from text that is not a date; their Metadata is left unchanged.
    due_error: bool,
    show_from_error: bool,
    /// Field errors from the last validation; refreshed on every edit after a submission.
    errors: Vec<FieldError>,
    submitted: bool,
    /// Follows the session for this editor's outcome and Workspace; dropped on dismissal.
    session_watch: Option<Subscription>,
    /// The dialog was dismissed or closed by the editor; it never closes a dialog again.
    closed: bool,
    _subscriptions: Vec<Subscription>,
}

impl TodoEditor {
    fn new(
        session: Entity<SessionModel>,
        item: Option<TodoItem>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let today = local_today();
        let draft = match &item {
            Some(item) => TodoDraft::from_item(item),
            None => TodoDraft::new_item(today),
        };
        let target_label = session
            .read(cx)
            .selected()
            .map(|s| {
                let file = s
                    .file
                    .path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy();
                format!("{} · {file}", s.workspace.name)
            })
            .unwrap_or_default();
        let (workspace_id, revision) = {
            let model = session.read(cx);
            let id = model.selected().map(|s| s.workspace.id.clone());
            (id.unwrap_or_default(), model.revision().unwrap_or_default())
        };
        let session_watch = cx.observe_in(&session, window, |editor, _, window, cx| {
            editor.session_changed(window, cx)
        });
        let mut subscriptions = Vec::new();
        let mut input = |field: Field, value: String, placeholder: &str, cx: &mut Context<Self>| {
            let state = cx.new(|cx| {
                InputState::new(window, cx)
                    .placeholder(placeholder.to_owned())
                    .default_value(value)
            });
            subscriptions.push(cx.subscribe_in(
                &state,
                window,
                move |editor, _, event: &InputEvent, _, cx| {
                    if matches!(event, InputEvent::Change) {
                        editor.changed(field, cx)
                    }
                },
            ));
            state
        };
        let date = |d: Option<TodoDate>| d.map(|d| d.to_string()).unwrap_or_default();
        let other = matches!(
            draft.priority,
            PriorityChoice::Letter(c) if !matches!(c, 'A' | 'B' | 'C')
        );
        let other_letter = match draft.priority {
            PriorityChoice::Letter(c) if other => c.to_string(),
            _ => String::new(),
        };
        let editor_fields = (
            input(
                Field::Description,
                draft.description.clone(),
                "What needs doing?",
                cx,
            ),
            input(
                Field::Projects,
                String::new(),
                "Add a Project, then Enter",
                cx,
            ),
            input(
                Field::Contexts,
                String::new(),
                "Add a Context, then Enter",
                cx,
            ),
            input(
                Field::Metadata,
                String::new(),
                "Add key:value, then Enter",
                cx,
            ),
            input(Field::OtherPriority, other_letter, "D–Z", cx),
            input(Field::Due, date(draft.due_date()), DATE_PLACEHOLDER, cx),
            input(
                Field::ShowFrom,
                date(draft.show_from()),
                DATE_PLACEHOLDER,
                cx,
            ),
            input(
                Field::CreationDate,
                draft.creation_date.clone(),
                DATE_PLACEHOLDER,
                cx,
            ),
            input(
                Field::CompletionDate,
                draft.completion_date.clone(),
                DATE_PLACEHOLDER,
                cx,
            ),
            input(
                Field::RepeatInterval,
                draft.repeat_interval.clone(),
                "1",
                cx,
            ),
        );
        let (description, projects, contexts, metadata, other_priority) = (
            editor_fields.0,
            editor_fields.1,
            editor_fields.2,
            editor_fields.3,
            editor_fields.4,
        );
        let (due, show_from, creation_date, completion_date, repeat_interval) = (
            editor_fields.5,
            editor_fields.6,
            editor_fields.7,
            editor_fields.8,
            editor_fields.9,
        );
        let tag = |input| TagInput { input, error: None };
        Self {
            session,
            workspace_id,
            revision,
            reply: None,
            item,
            target_label,
            draft,
            today,
            description,
            projects: tag(projects),
            contexts: tag(contexts),
            metadata: tag(metadata),
            other_priority,
            other,
            due,
            show_from,
            creation_date,
            completion_date,
            repeat_interval,
            due_error: false,
            show_from_error: false,
            errors: Vec::new(),
            submitted: false,
            session_watch: Some(session_watch),
            closed: false,
            _subscriptions: subscriptions,
        }
    }

    fn text(input: &Entity<InputState>, cx: &App) -> String {
        input.read(cx).value().to_string()
    }

    /// Follows one input's edit into the draft.
    fn changed(&mut self, field: Field, cx: &mut Context<Self>) {
        if self.saving() {
            return;
        }
        let date_text = |input: &Entity<InputState>, cx: &App| {
            let text = Self::text(input, cx);
            let text = text.trim();
            match text {
                "" => Ok(None),
                text => TodoDate::parse(text).map(Some).ok_or(()),
            }
        };
        match field {
            Field::Description => self.draft.description = Self::text(&self.description, cx),
            Field::Projects => self.projects.error = None,
            Field::Contexts => self.contexts.error = None,
            Field::Metadata => self.metadata.error = None,
            Field::OtherPriority => {
                let letter = Self::text(&self.other_priority, cx).to_uppercase();
                let mut chars = letter.chars();
                self.draft.priority = match (chars.next(), chars.next()) {
                    (Some(c @ 'D'..='Z'), None) => PriorityChoice::Letter(c),
                    _ => PriorityChoice::Incomplete,
                };
            }
            Field::Due => match date_text(&self.due, cx) {
                Ok(date) => {
                    self.due_error = false;
                    self.draft.set_due_date(date);
                }
                Err(()) => self.due_error = true,
            },
            Field::ShowFrom => match date_text(&self.show_from, cx) {
                Ok(date) => {
                    self.show_from_error = false;
                    self.draft.set_show_from(date);
                }
                Err(()) => self.show_from_error = true,
            },
            Field::CreationDate => {
                self.draft.creation_date = Self::text(&self.creation_date, cx).trim().to_owned()
            }
            Field::CompletionDate => {
                self.draft.completion_date = Self::text(&self.completion_date, cx).trim().to_owned()
            }
            Field::RepeatInterval => {
                let interval = Self::text(&self.repeat_interval, cx);
                self.draft.set_repeat(&interval, self.draft.repeat_unit);
            }
        }
        self.revalidate();
        cx.notify();
    }

    /// The editor's one Enter handler, ahead of the inputs and the dialog: Enter in a tag input
    /// with typed text commits that tag; anywhere else it saves. Either way exactly once.
    fn on_enter(&mut self, _: &Enter, window: &mut Window, cx: &mut Context<Self>) {
        cx.stop_propagation();
        if self.saving() {
            return;
        }
        let typed = [Field::Projects, Field::Contexts, Field::Metadata]
            .into_iter()
            .find(|field| {
                let input = &self.tag_input(*field).expect("tag field").input;
                input.read(cx).focus_handle(cx).is_focused(window)
                    && !Self::text(input, cx).trim().is_empty()
            });
        match typed {
            Some(field) => {
                self.commit_tag(field, window, cx);
                cx.notify();
            }
            None => self.submit(window, cx),
        }
    }

    fn tag_input(&self, field: Field) -> Option<&TagInput> {
        match field {
            Field::Projects => Some(&self.projects),
            Field::Contexts => Some(&self.contexts),
            Field::Metadata => Some(&self.metadata),
            _ => None,
        }
    }

    /// Adds the typed tag to its list, or shows why it cannot be added. `true` when the input is
    /// empty afterwards.
    fn commit_tag(&mut self, field: Field, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.saving() {
            return false;
        }
        let Some(tag) = self.tag_input(field) else {
            return true;
        };
        let input = tag.input.clone();
        let typed = Self::text(&input, cx);
        if typed.trim().is_empty() {
            return true;
        }
        let result = match field {
            Field::Projects => validate_tag(&typed, &self.draft.projects, '+', false)
                .map(|v| self.draft.projects.push(v)),
            Field::Contexts => validate_tag(&typed, &self.draft.contexts, '@', false)
                .map(|v| self.draft.contexts.push(v)),
            _ => validate_metadata_token(&typed).map(|token| {
                let mut metadata = self.draft.metadata.clone();
                metadata.push(token);
                self.set_metadata(metadata, window, cx);
            }),
        };
        let error = result.err();
        match field {
            Field::Projects => self.projects.error = error,
            Field::Contexts => self.contexts.error = error,
            _ => self.metadata.error = error,
        }
        if error.is_none() {
            input.update(cx, |state, cx| state.set_value("", window, cx));
            self.revalidate();
        }
        error.is_none()
    }

    /// Replaces the Metadata list. A Due date, Show from or Repeat field shows its new value
    /// only when that key's tokens changed; otherwise its typed text (valid or not) stays.
    fn set_metadata(&mut self, metadata: Vec<String>, window: &mut Window, cx: &mut Context<Self>) {
        let tokens = |m: &[String], key: &str| -> Vec<String> {
            m.iter().filter(|t| t.starts_with(key)).cloned().collect()
        };
        let before = std::mem::take(&mut self.draft.metadata);
        self.draft.metadata = before.clone();
        self.draft.set_metadata(metadata);
        let changed = |key| tokens(&before, key) != tokens(&self.draft.metadata, key);
        let (due, show_from, rec) = (changed("due:"), changed("t:"), changed("rec:"));
        let date = |d: Option<TodoDate>| d.map(|d| d.to_string()).unwrap_or_default();
        if due {
            let value = date(self.draft.due_date());
            self.due.update(cx, |s, cx| s.set_value(value, window, cx));
            self.due_error = false;
        }
        if show_from {
            let value = date(self.draft.show_from());
            self.show_from
                .update(cx, |s, cx| s.set_value(value, window, cx));
            self.show_from_error = false;
        }
        if rec {
            let interval = self.draft.repeat_interval.clone();
            self.repeat_interval
                .update(cx, |s, cx| s.set_value(interval, window, cx));
        }
    }

    fn remove_tag(
        &mut self,
        field: Field,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.saving() {
            return;
        }
        match field {
            Field::Projects => drop(self.draft.projects.remove(index)),
            Field::Contexts => drop(self.draft.contexts.remove(index)),
            _ => {
                let mut metadata = self.draft.metadata.clone();
                metadata.remove(index);
                self.set_metadata(metadata, window, cx);
            }
        }
        self.revalidate();
        cx.notify();
    }

    fn set_priority(
        &mut self,
        choice: Option<PriorityChoice>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.saving() {
            return;
        }
        match choice {
            Some(choice) => {
                self.other = false;
                self.draft.priority = choice;
            }
            // Other: a letter from D to Z, typed into its own input.
            None if !self.other => {
                self.other = true;
                self.draft.priority = PriorityChoice::Incomplete;
                self.other_priority.update(cx, |s, cx| {
                    s.set_value("", window, cx);
                    s.focus(window, cx);
                });
            }
            None => {}
        }
        self.revalidate();
        cx.notify();
    }

    fn set_repeat_unit(&mut self, unit: RepeatUnit, cx: &mut Context<Self>) {
        if self.saving() {
            return;
        }
        let interval = self.draft.repeat_interval.clone();
        self.draft.set_repeat(&interval, unit);
        self.revalidate();
        cx.notify();
    }

    fn set_completed(&mut self, completed: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.saving() {
            return;
        }
        self.draft.set_completed(completed, self.today);
        let date = self.draft.completion_date.clone();
        self.completion_date
            .update(cx, |s, cx| s.set_value(date, window, cx));
        self.revalidate();
        cx.notify();
    }

    /// After a submission, errors follow every edit so a fixed field clears its message.
    fn revalidate(&mut self) {
        if self.submitted {
            self.errors = self.validation().err().unwrap_or_default();
        }
    }

    fn validation(&self) -> Result<tuxedo_core::TodoFields, Vec<FieldError>> {
        match &self.item {
            Some(item) => self.draft.validate_edit(item),
            None => self.draft.validate(false),
        }
    }

    /// Validates and enqueues the change against the Workspace and revision the editor is bound
    /// to; nothing is queued while the draft is invalid or a save is already in flight.
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.reply.is_some() {
            return;
        }
        self.submitted = true;
        // Typed but uncommitted tags are saved too, as in Electron; a refused one blocks saving.
        // Every list commits (or shows its error), not only up to the first refusal.
        let mut committed = true;
        for field in [Field::Projects, Field::Contexts, Field::Metadata] {
            committed &= self.commit_tag(field, window, cx);
        }
        let fields = self.validation();
        self.errors = fields.as_ref().err().cloned().unwrap_or_default();
        let blocked = self.due_error || self.show_from_error || !committed;
        cx.notify();
        let Some(fields) = fields.ok().filter(|_| !blocked) else {
            return;
        };
        let reply = Reply::default();
        let workspace_id = self.workspace_id.clone();
        let revision = self.revision;
        let command = match &self.item {
            Some(item) => TodoCommand::Edit {
                target: TodoTarget {
                    workspace_id,
                    revision,
                    line_number: item.line_number,
                    expected_raw: item.raw.clone(),
                },
                fields,
                reply: reply.clone(),
            },
            None => TodoCommand::Create {
                workspace_id,
                revision,
                fields,
                reply: reply.clone(),
            },
        };
        self.reply = Some(reply);
        self.session
            .update(cx, |model, cx| model.enqueue(Command::Todo(command), cx));
    }

    /// While a save is in flight every control is disabled and nothing edits the draft, so what
    /// was saved is what the person sees.
    fn saving(&self) -> bool {
        self.reply.is_some()
    }

    /// The dialog went away (dismissed by the person, or closed by the editor): stop following
    /// the session. Idempotent.
    fn dismissed(&mut self) {
        self.closed = true;
        self.session_watch = None;
    }

    /// Closes this editor's dialog once. Only an editor whose dialog is still showing calls this;
    /// the dialog is modal, so it is the window's newest dialog.
    fn close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.closed {
            return;
        }
        self.dismissed();
        window.close_dialog(cx);
    }

    /// Follows the session: another Workspace shown closes the editor; the outcome of its own
    /// change closes it (saved, an edit conflict, an uncertain write) or keeps the draft (nothing
    /// written, a creation conflict); otherwise it follows refreshes of its Workspace.
    fn session_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let model = self.session.read(cx);
        let shown = model.selected().map(|s| s.workspace.id.as_str());
        if shown != Some(self.workspace_id.as_str()) {
            return self.close(window, cx);
        }
        let (revision, switching) = (model.revision(), model.pending().is_some());
        let replied = match &self.reply {
            Some(reply) => match reply.get() {
                Some(replied) => Some(replied),
                None => return,
            },
            None => None,
        };
        match replied {
            Some(Replied::Applied | Replied::Uncertain) => return self.close(window, cx),
            Some(Replied::Conflict) if self.item.is_some() => return self.close(window, cx),
            Some(_) => self.reply = None,
            None => {}
        }
        if !switching {
            self.revision = revision.unwrap_or(self.revision);
        }
        cx.notify();
    }

    fn error(&self, field: DraftField) -> Option<&'static str> {
        self.errors
            .iter()
            .find(|e| e.field == field)
            .map(|e| e.message)
    }
}

impl Render for TodoEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let saving = self.saving();
        let p = Palette::current(cx);
        let submitted = self.submitted;
        let draft = &self.draft;
        let show_from_token = draft.show_from_token();
        let notes = {
            let mut notes = Vec::new();
            if let Some(token) = show_from_token.filter(|_| draft.show_from().is_none()) {
                if !self.show_from_error {
                    notes.push(format!(
                        "Unsupported Show from value: {token}. Kept in Metadata until changed or cleared."
                    ));
                }
            }
            if let (Some(show), Some(due)) = (draft.show_from(), draft.due_date()) {
                if show > due {
                    notes.push(
                        "Show from is after Due date. This Todo item will stay deferred past its deadline."
                            .to_owned(),
                    );
                }
            }
            notes
        };
        let date_error = |bad: bool| (bad && submitted).then_some(INVALID_DATE);
        let priority = self.render_priority(p, cx);
        let repeat = self.render_repeat(p, cx);
        let completed = self.item.is_some().then(|| {
            Checkbox::new("todo-completed")
                .label("Completed")
                .checked(self.draft.completed)
                .disabled(saving)
                .on_click(cx.listener(|editor, checked: &bool, window, cx| {
                    editor.set_completed(*checked, window, cx)
                }))
        });
        v_flex()
            .id("todo-editor")
            .capture_action(cx.listener(Self::on_enter))
            .max_h(px(560.))
            .overflow_y_scroll()
            .gap_3()
            .text_sm()
            .child(
                div()
                    .text_color(hex(p.muted_foreground))
                    .child(self.target_label.clone()),
            )
            .child(field(
                "Description",
                Input::new(&self.description).disabled(saving),
                self.error(DraftField::Description),
                p,
            ))
            .child(columns(
                self.render_tags(Field::Projects, "+Projects", '+', window, p, cx),
                self.render_tags(Field::Contexts, "@Contexts", '@', window, p, cx),
            ))
            .child(columns(
                field("Priority", priority, self.error(DraftField::Priority), p),
                field(
                    "Due date",
                    Input::new(&self.due).disabled(saving).cleanable(true),
                    date_error(self.due_error),
                    p,
                ),
            ))
            .child(columns(
                field(
                    "Show from",
                    Input::new(&self.show_from).disabled(saving).cleanable(true),
                    date_error(self.show_from_error),
                    p,
                )
                .children(notes.into_iter().map(|note| note_text(note, p))),
                field(
                    "Creation date",
                    Input::new(&self.creation_date).disabled(saving).cleanable(true),
                    self.error(DraftField::CreationDate),
                    p,
                ),
            ))
            .child(
                field("Repeat", repeat, self.error(DraftField::RepeatInterval), p).when(
                    draft.repeat_unit == RepeatUnit::Unsupported,
                    |f| {
                        f.child(note_text(
                            format!(
                                "Unsupported Repeat value: {}. Kept in Metadata until changed or turned off.",
                                draft.repeat_token().unwrap_or_default()
                            ),
                            p,
                        ))
                    },
                ),
            )
            .children(completed)
            .when(self.draft.completed, |form| {
                form.child(field(
                    "Completion date",
                    Input::new(&self.completion_date).disabled(saving),
                    self.error(DraftField::CompletionDate),
                    p,
                ))
            })
            .child(self.render_tags(Field::Metadata, "Metadata", ' ', window, p, cx))
    }
}

impl TodoEditor {
    fn render_priority(&self, p: &Palette, cx: &mut Context<Self>) -> impl IntoElement {
        let saving = self.saving();
        let current = self.draft.priority;
        let choices = [
            ("None", Some(PriorityChoice::None)),
            ("A", Some(PriorityChoice::Letter('A'))),
            ("B", Some(PriorityChoice::Letter('B'))),
            ("C", Some(PriorityChoice::Letter('C'))),
            ("Other", None),
        ];
        let buttons =
            choices.into_iter().map(|(label, choice)| {
                let selected = match choice {
                    Some(choice) => !self.other && current == choice,
                    None => self.other,
                };
                let color = match choice {
                    Some(PriorityChoice::Letter(letter)) => Some(p.priority(letter).1),
                    _ => None,
                };
                segment(format!("todo-priority-{label}"), label, selected)
                    .disabled(self.saving())
                    .when_some(color, |b, color| b.text_color(color))
                    .on_click(cx.listener(move |editor, _, window, cx| {
                        editor.set_priority(choice, window, cx)
                    }))
            });
        v_flex()
            .gap_1p5()
            .child(h_flex().gap_1().children(buttons))
            .when(self.other, |col| {
                col.child(
                    div()
                        .w(px(72.))
                        .child(Input::new(&self.other_priority).disabled(saving).small()),
                )
            })
    }

    fn render_repeat(&self, _p: &Palette, cx: &mut Context<Self>) -> impl IntoElement {
        let saving = self.saving();
        let unit = self.draft.repeat_unit;
        let units = [
            ("Off", RepeatUnit::Off),
            ("Days", RepeatUnit::Day),
            ("Weeks", RepeatUnit::Week),
            ("Months", RepeatUnit::Month),
            ("Years", RepeatUnit::Year),
        ];
        let buttons = units.into_iter().map(|(label, value)| {
            segment(format!("todo-repeat-{label}"), label, unit == value)
                .disabled(self.saving())
                .on_click(cx.listener(move |editor, _, _, cx| editor.set_repeat_unit(value, cx)))
        });
        let interval = !matches!(unit, RepeatUnit::Off | RepeatUnit::Unsupported);
        h_flex()
            .gap_2()
            .child(h_flex().gap_1().children(buttons))
            .when(interval, |row| {
                row.child(
                    h_flex().gap_1p5().child("every").child(
                        div()
                            .w(px(64.))
                            .child(Input::new(&self.repeat_interval).disabled(saving).small()),
                    ),
                )
            })
    }

    fn render_tags(
        &self,
        field_kind: Field,
        label: &'static str,
        prefix: char,
        _window: &mut Window,
        p: &Palette,
        cx: &mut Context<Self>,
    ) -> Div {
        let saving = self.saving();
        let (values, tag, draft_field) = match field_kind {
            Field::Projects => (&self.draft.projects, &self.projects, DraftField::Projects),
            Field::Contexts => (&self.draft.contexts, &self.contexts, DraftField::Contexts),
            _ => (&self.draft.metadata, &self.metadata, DraftField::Metadata),
        };
        let chips = values.iter().enumerate().map(|(index, value)| {
            let text = if prefix == ' ' {
                value.clone()
            } else {
                format!("{prefix}{value}")
            };
            h_flex()
                .gap_0p5()
                .pl_2()
                .pr_0p5()
                .h_6()
                .rounded(px(6.))
                .bg(hex(p.muted))
                .font_family(MONO_FONT)
                .text_xs()
                .child(text.clone())
                .child(
                    Button::new((SharedString::from(format!("remove-{label}")), index))
                        .ghost()
                        .xsmall()
                        .disabled(self.saving())
                        .icon(IconName::X)
                        .tooltip(format!("Remove {text}"))
                        .on_click(cx.listener(move |editor, _, window, cx| {
                            editor.remove_tag(field_kind, index, window, cx)
                        })),
                )
        });
        let error = tag.error.or(self.error(draft_field));
        field(
            label,
            v_flex()
                .gap_1p5()
                .when(!values.is_empty(), |col| {
                    col.child(h_flex().flex_wrap().gap_1().children(chips))
                })
                .child(Input::new(&tag.input).disabled(saving)),
            error,
            p,
        )
    }
}

/// A selectable segment of a picker (Priority, Repeat).
fn segment(id: String, label: &'static str, selected: bool) -> Button {
    let button = Button::new(SharedString::from(id))
        .small()
        .label(label)
        .toggled(selected);
    if selected {
        button.secondary()
    } else {
        button.outline()
    }
}

fn field(label: &'static str, control: impl IntoElement, error: Option<&str>, p: &Palette) -> Div {
    v_flex()
        .gap_1p5()
        .min_w_0()
        .child(
            div()
                .font_weight(FontWeight::MEDIUM)
                .text_color(hex(p.foreground))
                .child(label),
        )
        .child(control)
        .when_some(error, |f, error| {
            f.child(div().text_color(hex(p.destructive)).child(error.to_owned()))
        })
}

fn note_text(note: String, p: &Palette) -> Div {
    div()
        .text_xs()
        .text_color(hex(p.muted_foreground))
        .child(note)
}

fn columns(left: Div, right: Div) -> Div {
    h_flex()
        .items_start()
        .gap_4()
        .child(left.flex_1())
        .child(right.flex_1())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{div, AppContext as _, Entity, IntoElement, TestAppContext, VisualTestContext};
    use gpui_kit::base::Root;
    use gpui_kit::component::WindowExt as _;

    use super::{open, Field, TodoEditor};
    use crate::command_queue::OutcomeKind;
    use crate::model::tests::{catalogue, C};
    use crate::model::SessionModel;
    use crate::todo_commands::local_today;

    struct Blank;

    impl gpui::Render for Blank {
        fn render(
            &mut self,
            _: &mut gpui::Window,
            _: &mut gpui::Context<Self>,
        ) -> impl IntoElement {
            div()
        }
    }

    /// Workspace A (shown) with `contents`, in a window whose root hosts dialogs. Command outcomes
    /// stay in the model, since no app view presents them.
    fn window<'a>(
        name: &str,
        contents: &str,
        cx: &'a mut TestAppContext,
    ) -> (Entity<SessionModel>, PathBuf, &'a mut VisualTestContext) {
        cx.update(gpui_kit::init);
        let path = catalogue(name);
        let todo = path.with_file_name("A.txt");
        std::fs::write(&todo, contents).unwrap();
        let session = cx.new(|cx| SessionModel::restore_from(Some(path), cx));
        cx.run_until_parked();
        let (_, cx) = cx.add_window_view(|window, cx| {
            crate::theme::init(window, cx);
            let blank = cx.new(|_| Blank);
            Root::new(blank, window, cx)
        });
        (session, todo, cx)
    }

    fn open_new(session: &Entity<SessionModel>, cx: &mut VisualTestContext) -> Entity<TodoEditor> {
        let editor = cx.update(|window, cx| open(session.clone(), None, window, cx));
        cx.run_until_parked();
        editor.unwrap()
    }

    fn type_into(
        editor: &Entity<TodoEditor>,
        input: impl Fn(&TodoEditor) -> &Entity<gpui_kit::component::input::InputState>,
        text: &str,
        cx: &mut VisualTestContext,
    ) {
        cx.update(|window, cx| {
            let input = input(editor.read(cx)).clone();
            input.update(cx, |state, cx| state.focus(window, cx));
        });
        cx.simulate_input(text);
    }

    fn dialog_open(cx: &mut VisualTestContext) -> bool {
        cx.update(|window, cx| window.has_active_dialog(cx))
    }

    fn kinds(session: &Entity<SessionModel>, cx: &mut VisualTestContext) -> Vec<OutcomeKind> {
        cx.update(|_, cx| {
            session.update(cx, |m, _| {
                m.take_outcomes().into_iter().map(|o| o.kind).collect()
            })
        })
    }

    #[gpui::test]
    fn enter_commits_a_typed_tag_and_otherwise_saves_exactly_once(cx: &mut TestAppContext) {
        let (session, todo, cx) = window("editor-enter", "First\n", cx);
        let editor = open_new(&session, cx);

        // The form is already valid: a submission would save, so only routing keeps it open.
        type_into(&editor, |e| &e.description, "Plan", cx);
        type_into(&editor, |e| &e.projects.input, "Work", cx);
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        let projects = cx.update(|_, cx| editor.read(cx).draft.projects.clone());
        assert_eq!(projects, ["Work"]);
        assert_eq!(std::fs::read_to_string(&todo).unwrap(), "First\n");
        assert!(
            kinds(&session, cx).is_empty(),
            "a committed tag queues nothing"
        );
        assert!(dialog_open(cx), "a committed tag does not save");

        type_into(&editor, |e| &e.description, "", cx);
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            format!("First\n{} Plan +Work\n", local_today())
        );
        assert_eq!(kinds(&session, cx), [OutcomeKind::Applied]);
        assert!(!dialog_open(cx), "a saved change closes the editor");
    }

    #[gpui::test]
    fn the_draft_cannot_change_while_its_save_is_in_flight(cx: &mut TestAppContext) {
        use tuxedo_core::{PriorityChoice, RepeatUnit};
        let (session, todo, cx) = window("editor-held", "First\n", cx);
        let editor = open_new(&session, cx);
        type_into(&editor, |e| &e.description, "Plan", cx);
        type_into(&editor, |e| &e.contexts.input, "home", cx);
        cx.simulate_keystrokes("enter");
        // The save is admitted; its write waits on the background executor until the test parks.
        cx.update(|window, cx| {
            editor.update(cx, |e, cx| {
                e.submit(window, cx);
                let before = e.draft.clone();
                e.set_priority(Some(PriorityChoice::Letter('A')), window, cx);
                e.set_repeat_unit(RepeatUnit::Week, cx);
                e.remove_tag(Field::Contexts, 0, window, cx);
                e.metadata
                    .input
                    .update(cx, |s, cx| s.set_value("late:edit", window, cx));
                assert!(!e.commit_tag(Field::Metadata, window, cx));
                e.changed(Field::Description, cx);
                assert_eq!(
                    e.draft, before,
                    "nothing edits the draft while it is saving"
                );
            })
        });
        cx.run_until_parked();
        assert_eq!(kinds(&session, cx), [OutcomeKind::Applied]);
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            format!("First\n{} Plan @home\n", local_today())
        );
        assert!(!dialog_open(cx));
    }

    #[gpui::test]
    fn a_dismissed_editor_never_closes_a_newer_one(cx: &mut TestAppContext) {
        let (session, _, cx) = window("editor-dismissed", "First\n", cx);
        // Motion on: a closed dialog stays mounted, with its editor, while it animates out.
        cx.update(|_, cx| cx.set_reduce_motion(false));
        let first = open_new(&session, cx);
        type_into(&first, |e| &e.description, "Plan", cx);
        cx.update(|window, cx| first.update(cx, |e, cx| e.submit(window, cx)));
        // Escape dismisses it while its save is in flight; the save still completes.
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        assert!(!dialog_open(cx));
        assert_eq!(kinds(&session, cx), [OutcomeKind::Applied]);

        let _second = open_new(&session, cx);
        assert!(dialog_open(cx));
        cx.update(|_, cx| session.update(cx, |_, cx| cx.notify()));
        cx.run_until_parked();
        assert!(
            dialog_open(cx),
            "the first editor's outcome does not close the second"
        );
    }

    #[gpui::test]
    fn a_creation_conflict_keeps_the_draft_until_an_explicit_retry(cx: &mut TestAppContext) {
        let (session, todo, cx) = window("editor-conflict", "First\n", cx);
        let editor = open_new(&session, cx);
        type_into(&editor, |e| &e.description, "Plan", cx);
        type_into(&editor, |e| &e.projects.input, "Work", cx);
        cx.simulate_keystrokes("enter");
        std::fs::write(&todo, "Changed elsewhere\n").unwrap();

        type_into(&editor, |e| &e.description, "", cx);
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        assert_eq!(kinds(&session, cx), [OutcomeKind::Conflict]);
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            "Changed elsewhere\n"
        );
        assert!(dialog_open(cx), "a creation conflict keeps the editor open");
        let draft = cx.update(|_, cx| editor.read(cx).draft.clone());
        assert_eq!(
            (draft.description.as_str(), draft.projects.as_slice()),
            ("Plan", &["Work".to_owned()][..])
        );
        cx.run_until_parked();
        assert!(
            kinds(&session, cx).is_empty(),
            "nothing is retried on its own"
        );

        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        assert_eq!(kinds(&session, cx), [OutcomeKind::Applied]);
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            format!("Changed elsewhere\n{} Plan +Work\n", local_today())
        );
        assert!(!dialog_open(cx));
    }

    #[gpui::test]
    fn clearing_a_recorded_completion_date_is_reported_on_its_field(cx: &mut TestAppContext) {
        use tuxedo_core::DraftField;
        let (session, todo, cx) = window("editor-completion", "x 2026-10-09 Old\n", cx);
        let item = cx.update(|_, cx| session.read(cx).selected().unwrap().file.items[0].clone());
        let editor = cx
            .update(|window, cx| open(session.clone(), Some(item), window, cx))
            .unwrap();
        cx.run_until_parked();
        type_into(&editor, |e| &e.completion_date, "", cx);
        cx.simulate_keystrokes("cmd-a backspace enter");
        cx.run_until_parked();

        let error = cx.update(|_, cx| editor.read(cx).error(DraftField::CompletionDate));
        assert_eq!(
            error,
            Some("Choose a Completion date for a completed Todo item.")
        );
        assert!(kinds(&session, cx).is_empty(), "nothing is queued");
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            "x 2026-10-09 Old\n"
        );
        assert!(dialog_open(cx));
    }

    #[gpui::test]
    fn a_failed_save_keeps_the_draft_and_a_retry_saves_once(cx: &mut TestAppContext) {
        use std::os::unix::fs::PermissionsExt as _;
        let (session, todo, cx) = window("editor-failure", "First\n", cx);
        let dir = todo.parent().unwrap().to_path_buf();
        let mode = |bits| std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(bits));
        let editor = open_new(&session, cx);
        type_into(&editor, |e| &e.description, "Plan", cx);

        // No temporary file can be created beside the Todo file: nothing is written.
        mode(0o500).unwrap();
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        mode(0o700).unwrap();
        assert_eq!(kinds(&session, cx), [OutcomeKind::Failed]);
        assert!(dialog_open(cx), "a failed save keeps the editor open");
        let description = cx.update(|_, cx| editor.read(cx).draft.description.clone());
        assert_eq!(description, "Plan");

        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        assert_eq!(kinds(&session, cx), [OutcomeKind::Applied]);
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            format!("First\n{} Plan\n", local_today())
        );
        assert!(!dialog_open(cx));
    }

    #[gpui::test]
    fn a_save_never_retargets_to_a_workspace_shown_after_opening(cx: &mut TestAppContext) {
        let (session, todo, cx) = window("editor-switch", "First\n", cx);
        let other = todo.with_file_name("C.txt");
        let before = std::fs::read_to_string(&other).unwrap();
        // The switch is admitted, but its load waits on the background executor, which runs only
        // when the test parks: A is still shown when the editor opens.
        cx.update(|_, cx| session.update(cx, |m, cx| m.select(C, cx)));
        let editor = open_new_unparked(&session, cx);
        cx.run_until_parked();
        assert!(
            !dialog_open(cx),
            "showing another Workspace closes the editor"
        );

        // Even a save from the stale editor stays bound to A, where it is refused as stale.
        cx.update(|window, cx| {
            editor.update(cx, |editor, cx| {
                editor.draft.description = "Plan".into();
                editor.submit(window, cx);
            })
        });
        cx.run_until_parked();
        assert_eq!(std::fs::read_to_string(&todo).unwrap(), "First\n");
        assert_eq!(std::fs::read_to_string(&other).unwrap(), before);
        assert_eq!(
            kinds(&session, cx),
            [OutcomeKind::Applied, OutcomeKind::Failed]
        );
    }

    fn open_new_unparked(
        session: &Entity<SessionModel>,
        cx: &mut VisualTestContext,
    ) -> Entity<TodoEditor> {
        cx.update(|window, cx| open(session.clone(), None, window, cx))
            .unwrap()
    }

    #[gpui::test]
    fn an_invalid_date_keeps_blocking_when_pending_metadata_commits(cx: &mut TestAppContext) {
        let (session, todo, cx) = window("editor-dates", "First\n", cx);
        type DateInput = fn(&TodoEditor) -> &Entity<gpui_kit::component::input::InputState>;
        let cases: [(&str, DateInput); 2] =
            [("Due date", |e| &e.due), ("Show from", |e| &e.show_from)];
        for (label, date) in cases {
            let editor = open_new(&session, cx);
            type_into(&editor, |e| &e.description, "Plan", cx);
            type_into(&editor, date, "2026-02-30", cx);
            type_into(&editor, |e| &e.metadata.input, "custom:keep", cx);
            cx.update(|window, cx| editor.update(cx, |e, cx| e.submit(window, cx)));
            cx.run_until_parked();

            assert_eq!(
                std::fs::read_to_string(&todo).unwrap(),
                "First\n",
                "{label}"
            );
            let (metadata, typed) = cx.update(|_, cx| {
                let editor = editor.read(cx);
                (
                    editor.draft.metadata.clone(),
                    date(editor).read(cx).value().to_string(),
                )
            });
            assert_eq!(
                metadata,
                ["custom:keep"],
                "{label}: pending Metadata commits"
            );
            assert_eq!(typed, "2026-02-30", "{label}: the invalid text stays");
            assert!(dialog_open(cx), "{label}");
            assert!(
                kinds(&session, cx).is_empty(),
                "{label}: nothing was queued"
            );
            cx.update(|window, cx| window.close_dialog(cx));
            cx.run_until_parked();
        }
    }
}
