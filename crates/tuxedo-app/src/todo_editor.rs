//! The shared Todo-item editor: one gpui-kit dialog for a new Todo item and for editing an
//! existing one, with the Electron editor's fields (`TodoEditorDialog.svelte`). The draft and its
//! validation live in `tuxedo_core::TodoDraft`; this module owns the inputs, shows each field's
//! error inline, and enqueues a Todo command only once the draft is valid. Outcomes (conflicts,
//! failures, notices) arrive through the app's notifications like every other command's.

use std::cell::Cell;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::dialog::{DialogAction, DialogClose, DialogFooter};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, Sizable, WindowExt as _};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{
    validate_metadata_token, validate_tag, DraftField, FieldError, PriorityChoice, RepeatUnit,
    TodoDate, TodoDraft, TodoItem, TodoTarget,
};

use crate::command_queue::{Command, TodoCommand};
use crate::model::SessionModel;
use crate::theme::{hex, Palette, MONO_FONT};
use crate::todo_commands::local_today;

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
                    .child(
                        DialogAction::new().child(Button::new("save-todo").primary().label(
                            if editing {
                                "Save changes"
                            } else {
                                "Add Todo item"
                            },
                        )),
                    ),
            )
            .on_ok(move |_, window, cx| submit.update(cx, |editor, cx| editor.submit(window, cx)))
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
                move |editor, _, event: &InputEvent, window, cx| match event {
                    InputEvent::Change => editor.changed(field, cx),
                    InputEvent::PressEnter { .. } => editor.enter(field, window, cx),
                    _ => {}
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
            _subscriptions: subscriptions,
        }
    }

    fn text(input: &Entity<InputState>, cx: &App) -> String {
        input.read(cx).value().to_string()
    }

    /// Follows one input's edit into the draft.
    fn changed(&mut self, field: Field, cx: &mut Context<Self>) {
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

    /// Enter commits a typed tag; anywhere else (or in an empty tag input) it saves.
    fn enter(&mut self, field: Field, window: &mut Window, cx: &mut Context<Self>) {
        let tag_field = matches!(field, Field::Projects | Field::Contexts | Field::Metadata);
        let typed = self
            .tag_input(field)
            .is_some_and(|t| !Self::text(&t.input, cx).trim().is_empty());
        if tag_field && typed {
            self.commit_tag(field, window, cx);
            cx.notify();
            return;
        }
        if self.submit(window, cx) {
            window.close_dialog(cx);
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

    /// Replaces the Metadata list and shows its effective Due date and Show from in their fields.
    fn set_metadata(&mut self, metadata: Vec<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.draft.set_metadata(metadata);
        let date = |d: Option<TodoDate>| d.map(|d| d.to_string()).unwrap_or_default();
        let (due, show_from) = (date(self.draft.due_date()), date(self.draft.show_from()));
        let interval = self.draft.repeat_interval.clone();
        self.due.update(cx, |s, cx| s.set_value(due, window, cx));
        self.show_from
            .update(cx, |s, cx| s.set_value(show_from, window, cx));
        self.repeat_interval
            .update(cx, |s, cx| s.set_value(interval, window, cx));
        (self.due_error, self.show_from_error) = (false, false);
    }

    fn remove_tag(
        &mut self,
        field: Field,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
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
        let interval = self.draft.repeat_interval.clone();
        self.draft.set_repeat(&interval, unit);
        self.revalidate();
        cx.notify();
    }

    fn set_completed(&mut self, completed: bool, window: &mut Window, cx: &mut Context<Self>) {
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
        self.draft.validate(self.item.is_some())
    }

    /// Validates and enqueues the change. `false` keeps the dialog open to show what is wrong;
    /// nothing is written while the draft is invalid.
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
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
        let Some(fields) = fields.ok().filter(|_| !blocked) else {
            cx.notify();
            return false;
        };
        let model = self.session.read(cx);
        let (Some(selected), Some(revision)) = (model.selected(), model.revision()) else {
            return true;
        };
        let workspace_id = selected.workspace.id.clone();
        let command = match &self.item {
            Some(item) => TodoCommand::Edit {
                target: TodoTarget {
                    workspace_id,
                    revision,
                    line_number: item.line_number,
                    expected_raw: item.raw.clone(),
                },
                fields,
            },
            None => TodoCommand::Create {
                workspace_id,
                revision,
                fields,
            },
        };
        self.session
            .update(cx, |model, cx| model.enqueue(Command::Todo(command), cx));
        true
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
                .on_click(cx.listener(|editor, checked: &bool, window, cx| {
                    editor.set_completed(*checked, window, cx)
                }))
        });
        v_flex()
            .id("todo-editor")
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
                Input::new(&self.description),
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
                    Input::new(&self.due).cleanable(true),
                    date_error(self.due_error),
                    p,
                ),
            ))
            .child(columns(
                field(
                    "Show from",
                    Input::new(&self.show_from).cleanable(true),
                    date_error(self.show_from_error),
                    p,
                )
                .children(notes.into_iter().map(|note| note_text(note, p))),
                field(
                    "Creation date",
                    Input::new(&self.creation_date).cleanable(true),
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
                    Input::new(&self.completion_date),
                    self.error(DraftField::CompletionDate),
                    p,
                ))
            })
            .child(self.render_tags(Field::Metadata, "Metadata", ' ', window, p, cx))
    }
}

impl TodoEditor {
    fn render_priority(&self, p: &Palette, cx: &mut Context<Self>) -> impl IntoElement {
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
                        .child(Input::new(&self.other_priority).small()),
                )
            })
    }

    fn render_repeat(&self, _p: &Palette, cx: &mut Context<Self>) -> impl IntoElement {
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
                            .child(Input::new(&self.repeat_interval).small()),
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
                .child(Input::new(&tag.input)),
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
