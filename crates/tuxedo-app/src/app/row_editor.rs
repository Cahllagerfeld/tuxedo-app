//! In-place editing of a List-view row as its todo.txt line, the keyboard row cursor, and the
//! date helper shared by quick add and the row editor.
//!
//! One edit session at a time lives in [`ListView`]: its target (Workspace, physical line, and
//! expected raw text), the projected row it occupies, and its line input, created once when the
//! edit starts and dropped when it ends. The virtualized list only renders that input in the
//! row's fixed-height slot; it never creates state. Enter saves through the queue, Escape (after
//! closing any open panel) and a click elsewhere cancel without saving.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::assets::IconName;
use gpui_kit::base::Popup;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::calendar::{Calendar, CalendarEvent, CalendarState, Date};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, Icon, Selectable, Sizable, WindowExt as _};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{LineDate, TodoDate, TodoItem, TodoLine, TodoTarget};

use super::list_view::ListView;
use super::TuxedoApp;
use crate::command_queue::{Command, TodoCommand};
use crate::completion_field::{self, CompletionKey, Offer, OnAccept};
use crate::theme::{hex, Palette, MONO_FONT};
use crate::todo_commands::{self, local_today, Replied, Reply};
use crate::todo_line_ui::{self, DateHelper, LineField};
use crate::todo_projection::Row;
use crate::todo_row::ROW_HEIGHT;

actions!(todo_list, [CursorUp, CursorDown, EditRow, ToggleRow]);

/// The List view's keys, active while the list (not a text field) has focus. `N` focuses quick
/// add like Cmd-N.
pub fn bind_keys(cx: &mut App) {
    const LIST: Option<&str> = Some("TodoList && !Input");
    cx.bind_keys([
        KeyBinding::new("up", CursorUp, LIST),
        KeyBinding::new("down", CursorDown, LIST),
        KeyBinding::new("enter", EditRow, LIST),
        KeyBinding::new("e", EditRow, LIST),
        KeyBinding::new("space", ToggleRow, LIST),
        KeyBinding::new("x", ToggleRow, LIST),
        KeyBinding::new("n", super::QuickAdd, LIST),
    ]);
}

/// Which line input an action addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LineKind {
    QuickAdd,
    Row,
}

/// The one row being edited.
pub(super) struct EditLine {
    pub(super) target: TodoTarget,
    original: TodoItem,
    /// The projected row the editor occupies until it ends.
    pub(super) row: usize,
    pub(super) field: LineField,
    _subscriptions: [Subscription; 2],
}

/// How a row edit ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EditExit {
    /// Saved, or cancelled with Escape: the list takes focus back.
    Keyboard,
    /// A click elsewhere: its destination keeps focus.
    Click,
    /// The item changed or left the list, or another Workspace is shown.
    Invalidated,
}

/// Where last frame's editing row and its popups landed: a click there is not "elsewhere" for
/// the row editor. Cleared each frame, so a row scrolled out of the list guards nothing.
#[derive(Clone, Default)]
pub(super) struct Guards {
    pub(super) row: Rc<Cell<Option<Bounds<Pixels>>>>,
    pub(super) panel: Rc<Cell<Option<Bounds<Pixels>>>>,
    pub(super) date: Rc<Cell<Option<Bounds<Pixels>>>>,
}

impl Guards {
    pub(super) fn clear(&self) {
        self.row.set(None);
        self.panel.set(None);
        self.date.set(None);
    }

    fn contain(&self, position: Point<Pixels>) -> bool {
        [&self.row, &self.panel, &self.date]
            .into_iter()
            .any(|cell| cell.get().is_some_and(|b| b.contains(&position)))
    }
}

/// What the virtualized list needs to draw the editing row, captured each frame.
#[derive(Clone)]
pub(super) struct RowEdit {
    pub(super) row: usize,
    input: Entity<InputState>,
    error: Option<&'static str>,
    panel: Option<(Vec<Offer>, usize)>,
    date: Option<(Entity<CalendarState>, LineDate)>,
    saving: bool,
    app: WeakEntity<TuxedoApp>,
    guards: Guards,
}

impl ListView {
    pub(super) fn line_field_mut(&mut self, kind: LineKind) -> Option<&mut LineField> {
        match kind {
            LineKind::QuickAdd => Some(&mut self.quick_add),
            LineKind::Row => self.editing.as_mut().map(|edit| &mut edit.field),
        }
    }

    /// Starts editing the item at projected row `row`, ending any other row's edit. Quick add
    /// keeps its text.
    pub(super) fn start_edit(
        app: &mut TuxedoApp,
        row: usize,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let Some(Row::Item(index)) = app.list_view.projection.rows().get(row).copied() else {
            return;
        };
        let model = app.session.read(cx);
        let (Some(selected), Some(revision)) = (model.selected(), model.revision()) else {
            return;
        };
        let Some(item) = selected.file.items.get(index).cloned() else {
            return;
        };
        let target = todo_commands::target(selected, revision, &item);
        let raw = item.raw.clone();
        let input = cx.new(|cx| InputState::new(window, cx).default_value(raw));
        let changed = cx.observe(&input, |app, _, cx| {
            if let Some(edit) = app.list_view.editing.as_mut() {
                edit.field.changed(cx);
            }
            cx.notify();
        });
        // The one save path: Enter the open panel did not take reaches the field.
        let enter = cx.subscribe_in(&input, window, |app, _, event: &InputEvent, window, cx| {
            if let InputEvent::PressEnter { .. } = event {
                ListView::save_edit(app, window, cx);
            }
        });
        input.update(cx, |state, cx| {
            let end = state.value().len();
            state.focus(window, cx);
            state.set_selected_range(end..end, cx);
        });
        let mut field = LineField::new(input, cx);
        // The line opens as it is; autocomplete waits for the first edit.
        field.completion.dismiss();
        let this = &mut app.list_view;
        this.end_edit(EditExit::Invalidated, cx);
        this.set_cursor(Some(row));
        this.editing = Some(EditLine {
            target,
            original: item,
            row,
            field,
            _subscriptions: [changed, enter],
        });
        cx.notify();
    }

    /// Enter in the row editor: validates the line and replaces the item's line through the
    /// queue. A refused line shows why under the row and stays.
    fn save_edit(app: &mut TuxedoApp, window: &mut Window, cx: &mut Context<TuxedoApp>) {
        let Some(edit) = app.list_view.editing.as_mut() else {
            return;
        };
        if edit.field.reply.is_some() || edit.field.composing(window, cx) {
            return;
        }
        let text = edit.field.submitted(cx);
        let line = match TodoLine::edit_of(&text, &edit.original) {
            Ok(line) => line,
            Err(message) => {
                edit.field.error = Some(message);
                return cx.notify();
            }
        };
        let reply = Reply::default();
        let command = Command::Todo(TodoCommand::Edit {
            target: edit.target.clone(),
            line: Box::new(line),
            reply: reply.clone(),
        });
        edit.field.set_saving(Some(reply), cx);
        app.session
            .update(cx, |model, cx| model.enqueue(command, cx));
        cx.notify();
    }

    /// The one cleanup for every way a row edit ends (saved, cancelled from the keyboard or by
    /// a click elsewhere, or invalidated): drops the session with its input, subscriptions, and
    /// reply. Once focus has settled, the list takes focus back after a keyboard exit, or when
    /// the removed input still holds it (a click elsewhere otherwise keeps its destination's
    /// focus), and gpui-component's registration of the removed input is released.
    pub(super) fn end_edit(&mut self, exit: EditExit, cx: &mut Context<TuxedoApp>) {
        let Some(edit) = self.editing.take() else {
            return;
        };
        let input_focus = edit.field.input.read(cx).focus_handle(cx);
        drop(edit);
        let (list, window) = (self.list_focus.clone(), self.window);
        cx.defer(move |cx| {
            window
                .update(cx, |_, window, cx| {
                    if exit == EditExit::Keyboard || input_focus.is_focused(window) {
                        window.focus(&list, cx);
                    }
                    window.focused_input(cx);
                })
                .ok();
        });
        cx.notify();
    }

    /// A mouse down anywhere in the window, before its target sees it: outside the editing row
    /// and its popups it ends the row edit without saving, also while the row is scrolled out
    /// of the list.
    pub(super) fn outside_click(&mut self, position: Point<Pixels>, cx: &mut Context<TuxedoApp>) {
        if self.editing.is_some() && !self.guards.contain(position) {
            self.end_edit(EditExit::Click, cx);
        }
    }

    /// Follows the row edit after the session changed: its own outcome ends it (saved, an edit
    /// conflict, an uncertain write) or keeps the text (nothing written). Without a pending
    /// save it follows refreshes of its item, and ends when another Workspace is shown or the
    /// item's line changed or left the list.
    pub(super) fn follow_edit(&mut self, app_cx: &mut Context<TuxedoApp>, model: EditContext) {
        let Some(edit) = self.editing.as_mut() else {
            return;
        };
        if let Some(reply) = &edit.field.reply {
            match reply.get() {
                None => return,
                Some(Replied::Failed) => edit.field.set_saving(None, app_cx),
                Some(Replied::Applied | Replied::Uncertain | Replied::Conflict) => {
                    return self.end_edit(EditExit::Keyboard, app_cx);
                }
            }
        }
        let rows = self.projection.rows();
        let still = model.workspace_id.as_deref() == Some(edit.target.workspace_id.as_str());
        let row = rows.iter().position(|row| match *row {
            Row::Item(index) => model.items.get(index).is_some_and(|(line, raw)| {
                *line == edit.target.line_number && *raw == edit.target.expected_raw
            }),
            Row::Header { .. } => false,
        });
        match (still, row, model.revision) {
            (true, Some(row), Some(revision)) => {
                edit.row = row;
                if !model.switching {
                    edit.target.revision = revision;
                }
            }
            _ => self.end_edit(EditExit::Invalidated, app_cx),
        }
    }

    /// What the editing row draws this frame.
    pub(super) fn row_edit(&self, window: &Window, cx: &Context<TuxedoApp>) -> Option<RowEdit> {
        let edit = self.editing.as_ref()?;
        Some(RowEdit {
            row: edit.row,
            input: edit.field.input.clone(),
            error: edit.field.error,
            panel: edit
                .field
                .panel(&self.line_facets, local_today(), window, cx),
            date: edit
                .field
                .date
                .as_ref()
                .map(|d| (d.calendar.clone(), d.target)),
            saving: edit.field.reply.is_some(),
            app: cx.entity().downgrade(),
            guards: self.guards.clone(),
        })
    }

    /// Opens or closes a line's date helper, on its Due date target.
    pub(super) fn toggle_date(
        app: &mut TuxedoApp,
        kind: LineKind,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let open = app
            .list_view
            .line_field_mut(kind)
            .is_some_and(|field| field.date.is_some());
        if open {
            if let Some(field) = app.list_view.line_field_mut(kind) {
                field.date = None;
            }
            return cx.notify();
        }
        let calendar = cx.new(|cx| CalendarState::new(window, cx));
        let selected = cx.subscribe_in(
            &calendar,
            window,
            move |app, _, event: &CalendarEvent, window, cx| {
                if let CalendarEvent::Selected(Date::Single(Some(day))) = event {
                    let day = TodoDate::parse(&day.format("%Y-%m-%d").to_string());
                    if let Some(day) = day {
                        ListView::pick_date(app, kind, day, window, cx);
                    }
                }
            },
        );
        if let Some(field) = app.list_view.line_field_mut(kind) {
            field.date = Some(DateHelper {
                target: LineDate::Due,
                calendar,
                _selected: selected,
            });
        }
        cx.notify();
    }

    fn set_date_target(
        app: &mut TuxedoApp,
        kind: LineKind,
        target: LineDate,
        cx: &mut Context<TuxedoApp>,
    ) {
        if let Some(date) = app
            .list_view
            .line_field_mut(kind)
            .and_then(|field| field.date.as_mut())
        {
            date.target = target;
        }
        cx.notify();
    }

    /// Writes the chosen date into the line at its target and closes the helper.
    pub(super) fn pick_date(
        app: &mut TuxedoApp,
        kind: LineKind,
        date: TodoDate,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let Some(field) = app.list_view.line_field_mut(kind) else {
            return;
        };
        if field.reply.is_some() {
            return;
        }
        let Some(helper) = field.date.take() else {
            return;
        };
        // A refusal (such as a Creation date the parser would read as the Completion date)
        // shows like any other, and the line stays as it was.
        if let Err(message) = field.set_date(helper.target, date, window, cx) {
            field.error = Some(message);
        }
        cx.notify();
    }

    /// A key in a line input: the autocomplete panel first, then the date helper; then Escape
    /// clears quick add or cancels the row edit.
    pub(super) fn on_line_key(
        app: &mut TuxedoApp,
        kind: LineKind,
        key: CompletionKey,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) -> bool {
        let today = local_today();
        let this = &mut app.list_view;
        let facets = this.line_facets.clone();
        let Some(field) = this.line_field_mut(kind) else {
            return false;
        };
        // Keys during an IME composition belong to it: Escape there only ends the composition.
        if field.composing(window, cx) {
            return false;
        }
        // While saving the line is read-only; Escape neither clears nor cancels it.
        if field.reply.is_some() {
            return key == CompletionKey::Close;
        }
        if field.key(key, &facets, today, window, cx) {
            cx.notify();
            return true;
        }
        if key != CompletionKey::Close {
            return false;
        }
        if field.date.take().is_some() {
            cx.notify();
            return true;
        }
        match kind {
            LineKind::Row => app.list_view.end_edit(EditExit::Keyboard, cx),
            LineKind::QuickAdd => field
                .input
                .update(cx, |state, cx| state.replace_all("", window, cx)),
        }
        true
    }

    /// Moves the row cursor to the next (or previous) Todo item, skipping group headers, and
    /// scrolls it into view.
    pub(super) fn move_cursor(&mut self, down: bool, cx: &mut Context<TuxedoApp>) {
        let rows = self.projection.rows();
        let items = |mut range: Box<dyn Iterator<Item = usize>>| {
            range.find(|&row| matches!(rows[row], Row::Item(_)))
        };
        let next = match (self.cursor, down) {
            (None, true) => items(Box::new(0..rows.len())),
            (None, false) => items(Box::new((0..rows.len()).rev())),
            (Some(at), true) => items(Box::new(at + 1..rows.len())),
            (Some(at), false) => items(Box::new((0..at.min(rows.len())).rev())),
        };
        if let Some(row) = next.or(self.cursor) {
            self.set_cursor(Some(row));
            self.scroll.scroll_to_item(row, ScrollStrategy::Nearest);
        }
        cx.notify();
    }

    /// Space / X: completes or reopens the item under the row cursor.
    pub(super) fn toggle_cursor(app: &mut TuxedoApp, cx: &mut Context<TuxedoApp>) {
        let rows = app.list_view.projection.rows();
        let Some(Row::Item(index)) = app.list_view.cursor.and_then(|row| rows.get(row).copied())
        else {
            return;
        };
        let model = app.session.read(cx);
        let (Some(selected), Some(revision)) = (model.selected(), model.revision()) else {
            return;
        };
        let Some(item) = selected.file.items.get(index) else {
            return;
        };
        let command = Command::Todo(TodoCommand::Complete {
            target: todo_commands::target(selected, revision, item),
            completed: !item.completed,
        });
        app.session
            .update(cx, |model, cx| model.enqueue(command, cx));
    }

    /// Screenshot mode: edits the row of physical line `<line>`; `!<text>` replaces its text,
    /// and a trailing `⏎` saves.
    #[cfg(feature = "screenshot")]
    pub(super) fn edit_for_screenshot(
        app: &mut TuxedoApp,
        spec: &str,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let (line, text) = match spec.split_once('!') {
            Some((line, text)) => (line, Some(text)),
            None => (spec, None),
        };
        let line: u32 = line.parse().unwrap_or(0);
        let items = app
            .session
            .read(cx)
            .selected()
            .map(|s| s.file.items.clone());
        let rows = app.list_view.projection.rows();
        let row = rows.iter().position(|row| match *row {
            Row::Item(index) => items
                .as_ref()
                .and_then(|items| items.get(index))
                .is_some_and(|item| item.line_number == line),
            Row::Header { .. } => false,
        });
        let Some(row) = row else {
            return eprintln!("tuxedo: line {line} is not a shown row");
        };
        app.list_view
            .scroll
            .scroll_to_item(row, ScrollStrategy::Center);
        Self::start_edit(app, row, window, cx);
        let Some(text) = text else {
            return;
        };
        let (text, save) = match text.strip_suffix('⏎') {
            Some(text) => (text, true),
            None => (text, false),
        };
        if let Some(edit) = app.list_view.editing.as_mut() {
            edit.field.input.update(cx, |state, cx| {
                state.replace_all(text.to_owned(), window, cx);
            });
            // As typing would have, before Enter.
            edit.field.changed(cx);
        }
        if save {
            Self::save_edit(app, window, cx);
        }
    }

    /// Screenshot mode: opens the date helper of the edited row (else quick add).
    #[cfg(feature = "screenshot")]
    pub(super) fn date_for_screenshot(
        app: &mut TuxedoApp,
        target: &str,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let kind = if app.list_view.editing.is_some() {
            LineKind::Row
        } else {
            LineKind::QuickAdd
        };
        Self::toggle_date(app, kind, window, cx);
        let target = match target {
            "t" => LineDate::ShowFrom,
            "creation" => LineDate::Creation,
            _ => LineDate::Due,
        };
        Self::set_date_target(app, kind, target, cx);
    }

    /// Puts the row cursor on `row`, remembering its item's physical line.
    pub(super) fn set_cursor(&mut self, row: Option<usize>) {
        let rows = self.projection.rows();
        self.cursor = row;
        self.cursor_line = row.and_then(|row| match rows.get(row) {
            Some(Row::Item(index)) => self.item_lines.get(*index).copied(),
            _ => None,
        });
    }

    /// After the rows changed: the cursor stays on its item when it is still shown, else moves
    /// to the nearest item (forward first), never a group header; none left clears it.
    pub(super) fn restore_cursor(&mut self) {
        let Some(at) = self.cursor else {
            return;
        };
        let rows = self.projection.rows();
        let line_of = |row: usize| match rows[row] {
            Row::Item(index) => self.item_lines.get(index).copied(),
            Row::Header { .. } => None,
        };
        let same = self
            .cursor_line
            .and_then(|line| (0..rows.len()).find(|&row| line_of(row) == Some(line)));
        let nearest = || {
            let at = at.min(rows.len());
            (at..rows.len())
                .chain((0..at).rev())
                .find(|&row| matches!(rows[row], Row::Item(_)))
        };
        let row = same.or_else(nearest);
        self.set_cursor(row);
    }
}

/// The session data [`ListView::follow_edit`] checks the edit against.
pub(super) struct EditContext {
    pub(super) workspace_id: Option<String>,
    pub(super) revision: Option<u64>,
    pub(super) switching: bool,
    /// Each Todo item's physical line and raw text, by item index.
    pub(super) items: Vec<(u32, String)>,
}

impl RowEdit {
    /// The editing row: the line input in the row's fixed-height slot, the date helper button,
    /// and the autocomplete panel or the refusal anchored below the input.
    pub(super) fn render(&self, p: &'static Palette) -> AnyElement {
        let app = self.app.clone();
        let on_accept: OnAccept = {
            let app = app.clone();
            Rc::new(move |index, window, cx| {
                app.update(cx, |app, cx| {
                    let this = &mut app.list_view;
                    let facets = this.line_facets.clone();
                    if let Some(field) = this.line_field_mut(LineKind::Row) {
                        field.accept(index, &facets, local_today(), window, cx);
                    }
                    cx.notify();
                })
                .ok();
            })
        };
        let error = self
            .error
            .map(|error| error_bubble(error, p).into_any_element());
        let field = Input::new(&self.input)
            .readonly(self.saving)
            .small()
            .focus_bordered(false)
            .aria_label("Edit Todo item")
            .font_family(MONO_FONT)
            .text_sm()
            .when(self.saving, |input| {
                input.suffix(
                    div()
                        .text_xs()
                        .text_color(hex(p.muted_foreground))
                        .child("Saving…"),
                )
            });
        let field = completion_field::render_with(
            "row-edit",
            field,
            self.panel.as_ref().map(|(o, h)| (o.as_slice(), *h)),
            error,
            on_accept,
            Some(self.guards.panel.clone()),
            p,
        );
        let field = completion_field::capture_keys(
            div().flex_1().min_w_0().child(field),
            app.clone(),
            |app: &mut TuxedoApp, key, window, cx| {
                ListView::on_line_key(app, LineKind::Row, key, window, cx)
            },
        );
        let row_bounds = self.guards.row.clone();
        h_flex()
            .id(("todo-edit-row", self.row))
            .relative()
            .when(cfg!(test), |row| {
                row.debug_selector(|| "todo-edit-row".into())
            })
            .h(px(ROW_HEIGHT))
            .w_full()
            .px_2()
            .gap_1()
            .border_b_1()
            .border_color(hex(p.border).opacity(0.5))
            .bg(hex(p.primary).opacity(0.06))
            // Where the row is this frame, for `ListView::outside_click`.
            .child(
                canvas(
                    move |bounds, _, _| row_bounds.set(Some(bounds)),
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(field)
            .child(date_button(
                "row-date",
                LineKind::Row,
                self.date.as_ref(),
                self.app.clone(),
                self.guards.date.clone(),
                p,
            ))
            .into_any_element()
    }
}

/// A refusal anchored under the row editor, so the row keeps its height.
fn error_bubble(error: &'static str, p: &Palette) -> impl IntoElement {
    h_flex()
        .id("todo-edit-error")
        .gap_1p5()
        .px_2()
        .py_1()
        .rounded(px(6.))
        .border_1()
        .border_color(hex(p.destructive).opacity(0.4))
        .bg(hex(p.popover))
        .shadow_md()
        .text_xs()
        .text_color(hex(p.destructive))
        .child(
            Icon::new(IconName::TriangleAlert)
                .size_3p5()
                .flex_shrink_0(),
        )
        .child(error)
}

/// The calendar button of a line input and, while open, its date helper: which date to set
/// (Due, Show from, Creation), quick dates, and a calendar.
pub(super) fn date_button(
    id: &'static str,
    kind: LineKind,
    open: Option<&(Entity<CalendarState>, LineDate)>,
    app: WeakEntity<TuxedoApp>,
    bounds: Rc<Cell<Option<Bounds<Pixels>>>>,
    p: &'static Palette,
) -> Popup {
    let toggle = {
        let app = app.clone();
        move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
            app.update(cx, |app, cx| ListView::toggle_date(app, kind, window, cx))
                .ok();
        }
    };
    let button = Button::new(SharedString::from(format!("{id}-button")))
        .ghost()
        .xsmall()
        .icon(Icon::new(IconName::Calendar))
        .tooltip("Set a date")
        .accessibility_label("Set a date")
        .selected(open.is_some())
        // Keeps focus in the line input, so its caret and keys survive.
        .on_mouse_down(MouseButton::Left, |_, window, _| window.prevent_default())
        .on_click(toggle);
    let panel = open.map(|(calendar, target)| {
        let today = local_today();
        let target_button = |label: &'static str, which: LineDate| {
            let app = app.clone();
            Button::new(SharedString::from(format!("{id}-target-{label}")))
                .ghost()
                .xsmall()
                .label(label)
                .selected(*target == which)
                .when(*target == which, |b| b.bg(hex(p.background)).shadow_xs())
                .on_mouse_down(MouseButton::Left, |_, window, _| window.prevent_default())
                .on_click(move |_, _, cx| {
                    app.update(cx, |app, cx| {
                        ListView::set_date_target(app, kind, which, cx)
                    })
                    .ok();
                })
        };
        let quick = |label: &'static str, date: TodoDate| {
            let app = app.clone();
            Button::new(SharedString::from(format!("{id}-quick-{label}")))
                .outline()
                .xsmall()
                .label(label)
                .on_mouse_down(MouseButton::Left, |_, window, _| window.prevent_default())
                .on_click(move |_, window, cx| {
                    app.update(cx, |app, cx| {
                        ListView::pick_date(app, kind, date, window, cx)
                    })
                    .ok();
                })
        };
        v_flex()
            .id(SharedString::from(format!("{id}-panel")))
            .when(cfg!(test), |panel| {
                panel.debug_selector(move || format!("{id}-panel"))
            })
            // The calendar would take focus on a click; the line input keeps it, so its keys
            // (Escape closes the helper) and the List view's (which need the list focused)
            // stay where they belong.
            .capture_any_mouse_down(|_, window, _| window.prevent_default())
            .p_2()
            .gap_2()
            .rounded(px(8.))
            .border_1()
            .border_color(hex(p.border))
            .bg(hex(p.popover))
            .shadow_lg()
            .child(
                h_flex()
                    .p_0p5()
                    .gap_0p5()
                    .rounded(px(7.))
                    .bg(hex(p.muted))
                    .child(target_button("Due", LineDate::Due))
                    .child(target_button("Show from", LineDate::ShowFrom))
                    .child(target_button("Creation", LineDate::Creation)),
            )
            .child(
                h_flex()
                    .gap_1()
                    .child(quick("Today", today))
                    .child(quick("Tomorrow", todo_line_ui::date_after(today, 1)))
                    .child(quick("Next Monday", todo_line_ui::next_monday(today))),
            )
            .child(
                div()
                    .when(cfg!(test), |d| {
                        d.debug_selector(move || format!("{id}-calendar"))
                    })
                    .child(Calendar::new(calendar).small()),
            )
    });
    Popup::new(SharedString::from(format!("{id}-popup")), button)
        .anchor(Anchor::TopRight)
        .offset(px(4.))
        .on_position(move |position, _| bounds.set(Some(position.bounds)))
        .when_some(panel, |popup, panel| popup.content(panel))
}
