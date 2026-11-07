//! List view: the main pane's states (loading, unavailable, empty), the Todo item list, and the
//! status bar. Rows themselves render in `todo_row`.

use gpui_kit::assets::IconName;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::Icon;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use tuxedo_core::{
    query_with_condition, query_with_condition_at, query_word_at, todo_facets, CompletionView,
    Facets, QueryCondition, TodoDate, TodoLine, WorkspaceSnapshot,
};

use super::TuxedoApp;
use crate::command_queue::{Command, TodoCommand};
use crate::completion_field::{self, Completion, CompletionKey, OnAccept};
use crate::model::{SessionModel, SessionState};
use crate::query_ui::{self, FilterEdit, OnEdit, Suggestion};
use crate::saved_views_ui;
use crate::theme::{hex, Palette};
use crate::todo_commands::{self, local_today, Replied, Reply};
use crate::todo_line_ui::LineField;
use crate::todo_projection::{locale_compare, Row, TodoProjection};
use crate::todo_row::{self, ROW_HEIGHT};

use super::row_editor::{
    self, CursorDown, CursorUp, EditContext, EditLine, EditRow, Guards, LineKind, RowEdit,
    ToggleRow,
};

/// Below this window width the query bar drops its shortcut hint and button label, so the
/// field keeps room beside an open sidebar, and rows show one token and a count.
const COMPACT_WINDOW_WIDTH: f32 = 960.;

/// How often the List view checks whether the local date changed.
const DATE_POLL: Duration = Duration::from_secs(60);

pub const QUICK_ADD_PLACEHOLDER: &str = "Add a Todo item: Buy milk +Home @store due:2026-11-10";

/// List-view-local UI state: the projection of the selected Todo file into displayed rows,
/// with its query, sort, and grouping, the query field's autocomplete, and the quick add line.
pub(super) struct ListView {
    pub(super) projection: TodoProjection,
    query: Entity<InputState>,
    completion: Completion,
    /// Quick add: a new Todo item typed as a todo.txt line.
    pub(super) quick_add: LineField,
    /// The row being edited in place, if any.
    pub(super) editing: Option<EditLine>,
    /// The whole Todo file's Projects, Contexts, and Priorities, which line autocomplete offers.
    pub(super) line_facets: Facets,
    /// The list itself takes focus for the keyboard row cursor.
    pub(super) list_focus: FocusHandle,
    pub(super) scroll: UniformListScrollHandle,
    /// The projected row under the keyboard cursor, and its item's physical line.
    pub(super) cursor: Option<usize>,
    pub(super) cursor_line: Option<u32>,
    /// Each Todo item's physical line, by item index, for the cursor's identity.
    pub(super) item_lines: Rc<[u32]>,
    pub(super) guards: Guards,
    /// The fields live in the window; set them there when an edit elsewhere changes them.
    pub(super) window: AnyWindowHandle,
    _subscriptions: [Subscription; 4],
    /// Recomputes the projection when the local date changes.
    _date_watch: Task<()>,
}

impl ListView {
    pub(super) fn new(window: &mut Window, cx: &mut Context<TuxedoApp>) -> Self {
        // Screenshot mode: `TUXEDO_WIDTH=<px>` narrows the window, e.g. to its 640 px minimum.
        #[cfg(feature = "screenshot")]
        if let Some(width) = std::env::var("TUXEDO_WIDTH")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
        {
            window.resize(size(px(width), window.viewport_size().height));
        }
        let query = cx.new(|cx| InputState::new(window, cx).placeholder(query_ui::PLACEHOLDER));
        // Any edit, caret move, or focus change: take the text verbatim and whether the caret
        // ends the focused field, which makes a final condition word a prefix while typed.
        let changed = cx.observe_in(&query, window, |app, _, window, cx| {
            if app.list_view.query_changed(window, cx) {
                app.session_changed(cx);
            } else {
                // A caret move can change the word autocomplete completes.
                cx.notify();
            }
        });
        let focus = cx.subscribe_in(&query, window, |app, _, event: &InputEvent, window, cx| {
            if matches!(event, InputEvent::Focus | InputEvent::Blur)
                && app.list_view.query_changed(window, cx)
            {
                app.session_changed(cx);
            }
        });
        let quick_add = cx.new(|cx| InputState::new(window, cx).placeholder(QUICK_ADD_PLACEHOLDER));
        let quick_changed = cx.observe(&quick_add, |app, _, cx| {
            app.list_view.quick_add.changed(cx);
            cx.notify();
        });
        // The one submit path: Enter the open panel did not take reaches the field.
        let quick_enter = cx.subscribe_in(
            &quick_add,
            window,
            |app, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    ListView::submit_quick_add(app, window, cx);
                }
            },
        );
        let date_watch = cx.spawn(async move |app, cx| loop {
            cx.background_executor().timer(DATE_POLL).await;
            let changed = app.update(cx, |app, cx| {
                if app.list_view.projection.today() != local_today() {
                    app.session_changed(cx);
                }
            });
            if changed.is_err() {
                break;
            }
        });
        Self {
            projection: TodoProjection::new(local_today()),
            query,
            completion: Completion::default(),
            quick_add: LineField::new(quick_add, cx),
            editing: None,
            line_facets: Facets::default(),
            list_focus: cx.focus_handle(),
            scroll: UniformListScrollHandle::new(),
            cursor: None,
            cursor_line: None,
            item_lines: Rc::from([]),
            guards: Guards::default(),
            window: window.window_handle(),
            _subscriptions: [changed, focus, quick_changed, quick_enter],
            _date_watch: date_watch,
        }
    }

    /// Follows the field: a changed text reopens autocomplete and reparses; a changed typing
    /// state (caret at the end of the focused field) only re-evaluates the last word. Returns
    /// whether the projection needs recomputing.
    fn query_changed(&mut self, window: &Window, cx: &App) -> bool {
        let state = self.query.read(cx);
        let text = state.value().to_string();
        let typing = state.focus_handle(cx).is_focused(window)
            && state.selected_range() == (text.len()..text.len());
        let edited = text != self.projection.query();
        if !edited && typing == self.projection.typing() {
            return false;
        }
        if edited {
            self.completion.edited();
            self.projection.set_query(text);
        }
        self.projection.set_typing(typing);
        true
    }

    /// Recomputes the displayed rows after accepted session data, a query edit, or the local
    /// date changes. A different Workspace clears the query; the same one keeps it.
    pub(super) fn reproject(&mut self, selected: Option<&WorkspaceSnapshot>, today: TodoDate) {
        self.projection.sync(selected, today);
        self.line_facets = selected.map_or_else(Facets::default, |s| {
            todo_facets(&s.file, CompletionView::All, locale_compare)
        });
        self.item_lines = selected.map_or_else(
            || Rc::from([]),
            |s| s.file.items.iter().map(|item| item.line_number).collect(),
        );
        self.restore_cursor();
    }

    /// Cmd-N: puts the caret in the quick add line.
    pub(super) fn focus_quick_add(&self, window: &mut Window, cx: &mut Context<TuxedoApp>) {
        self.quick_add
            .input
            .update(cx, |state, cx| state.focus(window, cx));
    }

    /// Enter in quick add: validates the typed line and appends it to the shown Workspace's
    /// Todo file. A refused line shows why under the field; nothing is queued while the last
    /// line still saves.
    fn submit_quick_add(app: &mut TuxedoApp, window: &mut Window, cx: &mut Context<TuxedoApp>) {
        let field = &mut app.list_view.quick_add;
        if field.reply.is_some() || field.composing(window, cx) {
            return;
        }
        let text = field.submitted(cx);
        if text.trim().is_empty() {
            return;
        }
        let model = app.session.read(cx);
        let (Some(selected), Some(revision)) = (model.selected(), model.revision()) else {
            return;
        };
        let line = match TodoLine::new_item(&text, local_today()) {
            Ok(line) => line,
            Err(message) => {
                field.error = Some(message);
                return cx.notify();
            }
        };
        let reply = Reply::default();
        let command = Command::Todo(TodoCommand::Create {
            workspace_id: selected.workspace.id.clone(),
            revision,
            line: Box::new(line),
            reply: reply.clone(),
        });
        field.set_saving(Some(reply), cx);
        app.session
            .update(cx, |model, cx| model.enqueue(command, cx));
        cx.notify();
    }

    /// Follows the line inputs' own commands: a saved (or possibly saved) quick add line
    /// empties its field, which keeps focus; a refused or failed one keeps its text.
    pub(super) fn follow_replies(
        &mut self,
        session: &Entity<SessionModel>,
        cx: &mut Context<TuxedoApp>,
    ) {
        if self.editing.is_some() {
            let model = session.read(cx);
            let context = EditContext {
                workspace_id: model.selected().map(|s| s.workspace.id.clone()),
                revision: model.revision(),
                switching: model.pending().is_some(),
                items: model.selected().map_or_else(Vec::new, |s| {
                    s.file
                        .items
                        .iter()
                        .map(|item| (item.line_number, item.raw.clone()))
                        .collect()
                }),
            };
            self.follow_edit(cx, context);
        }
        let replied = self.quick_add.reply.as_ref().and_then(Reply::get);
        let Some(replied) = replied else {
            return;
        };
        // The field stayed read-only while saving, so its text is still the submitted line.
        self.quick_add.set_saving(None, cx);
        if matches!(replied, Replied::Applied | Replied::Uncertain) {
            let input = self.quick_add.input.clone();
            let window = self.window;
            cx.defer(move |cx| {
                window
                    .update(cx, |_, window, cx| {
                        input.update(cx, |state, cx| state.replace_all("", window, cx))
                    })
                    .ok();
            });
        }
    }

    /// Screenshot mode: types `text` into quick add, caret at the end; a trailing `⏎` submits.
    #[cfg(feature = "screenshot")]
    pub(super) fn type_quick_add(
        app: &mut TuxedoApp,
        text: &str,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let (text, submit) = match text.strip_suffix('⏎') {
            Some(text) => (text, true),
            None => (text, false),
        };
        app.list_view.quick_add.input.update(cx, |state, cx| {
            state.focus(window, cx);
            state.replace_all(text.to_owned(), window, cx);
        });
        if submit {
            Self::submit_quick_add(app, window, cx);
        }
    }

    #[cfg(test)]
    pub(super) fn quick_add_text(&self, cx: &App) -> String {
        self.quick_add.text(cx)
    }

    /// Shows the projection's query in the field after an edit elsewhere (Overview, Add
    /// filter, Clear, a Workspace change) rewrote it. Setting the field emits no change.
    pub(super) fn sync_query_field(&self, cx: &mut Context<TuxedoApp>) {
        let wanted = self.projection.query().to_owned();
        if self.query.read(cx).value().as_ref() == wanted {
            return;
        }
        let query = self.query.clone();
        let window = self.window;
        cx.defer(move |cx| {
            window
                .update(cx, |_, window, cx| {
                    query.update(cx, |state, cx| state.set_value(wanted, window, cx))
                })
                .ok();
        });
    }

    #[cfg(test)]
    pub(super) fn query_text(&self, cx: &App) -> String {
        self.query.read(cx).value().to_string()
    }

    /// The open popover's highlighted row.
    #[cfg(test)]
    pub(super) fn highlighted_row(&self, window: &Window, cx: &App) -> Option<usize> {
        let (word, offered) = self.popover(window, cx)?;
        Some(self.highlighted(&word, offered.len()))
    }

    #[cfg(test)]
    pub(super) fn query_state(&self) -> &Entity<InputState> {
        &self.query
    }

    #[cfg(test)]
    pub(super) fn apply_for_test(
        app: &mut TuxedoApp,
        edit: FilterEdit,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        Self::apply(app, edit, window, cx);
    }

    /// Cmd-F: puts the caret in the query field.
    pub(super) fn focus_query(&self, window: &mut Window, cx: &mut Context<TuxedoApp>) {
        self.query.update(cx, |state, cx| state.focus(window, cx));
    }

    /// Applies a control's edit. Query edits (Overview, Add filter, Clear) rewrite the field
    /// with `replace_all`, which keeps them in its undo history; the field's change then
    /// applies the query like typing does. Sort and grouping apply directly.
    fn apply(
        app: &mut TuxedoApp,
        edit: FilterEdit,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let this = &mut app.list_view;
        let current = this.projection.query();
        let next = match edit {
            FilterEdit::Completion(view) => {
                query_with_condition(current, &QueryCondition::Completion(view))
            }
            FilterEdit::Add(condition) => query_with_condition(current, &condition),
            FilterEdit::Clear => String::new(),
            FilterEdit::Sort(sort) => {
                this.projection.set_sort(sort);
                return app.session_changed(cx);
            }
            FilterEdit::Grouped(grouped) => {
                this.projection.set_grouped(grouped);
                return app.session_changed(cx);
            }
        };
        this.query
            .update(cx, |state, cx| state.replace_all(next, window, cx));
    }

    /// The projection, while the selected Workspace has Todo items to filter.
    pub(super) fn projection(
        &self,
        selected: Option<&WorkspaceSnapshot>,
    ) -> Option<&TodoProjection> {
        selected.filter(|s| !s.file.items.is_empty())?;
        Some(&self.projection)
    }

    /// The word at the caret and what it can complete to, while the field has focus and the
    /// popover was not dismissed.
    fn popover(&self, window: &Window, cx: &App) -> Option<(Range<usize>, Vec<Suggestion>)> {
        let state = self.query.read(cx);
        if self.completion.dismissed() || !state.focus_handle(cx).is_focused(window) {
            return None;
        }
        let text = state.value();
        let caret = state.cursor();
        let word = query_word_at(&text, caret)?;
        let offered = query_ui::suggestions(&text[word.start..caret], &self.projection);
        (!offered.is_empty()).then_some((word, offered))
    }

    /// The highlighted row of the popover open on `word`, offering `len` suggestions.
    fn highlighted(&self, word: &Range<usize>, len: usize) -> usize {
        self.completion.highlighted(word, len)
    }

    /// Handles a popover key; `false` lets it through to the field while the popover is closed.
    fn on_popover_key(
        app: &mut TuxedoApp,
        key: CompletionKey,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) -> bool {
        let Some((word, offered)) = app.list_view.popover(window, cx) else {
            return false;
        };
        if let Some(index) = app.list_view.completion.key(key, word, offered.len()) {
            Self::accept(app, index, window, cx);
        }
        cx.notify();
        true
    }

    /// Puts suggestion `index` in place of the word at the caret, with the same rewrite
    /// rules as Overview and Add filter (`is:completed` drops `pri:` and `due:`), and leaves
    /// the caret after it. `replace_all` keeps the field's undo history.
    fn accept(app: &mut TuxedoApp, index: usize, window: &mut Window, cx: &mut Context<TuxedoApp>) {
        let Some((word, mut offered)) = app.list_view.popover(window, cx) else {
            return;
        };
        if index >= offered.len() {
            return;
        }
        let condition = offered.swap_remove(index).condition;
        let query = app.list_view.query.clone();
        let text = query.read(cx).value().to_string();
        let (next, caret) = query_with_condition_at(&text, word, &condition);
        query.update(cx, |state, cx| {
            state.replace_all(next, window, cx);
            state.set_selected_range(caret..caret, cx);
            state.focus(window, cx);
        });
        if app.list_view.query_changed(window, cx) {
            app.session_changed(cx);
        }
    }

    /// The query bar above the list: field, Add filter, error hint, readout, Sort and Group.
    fn render_query_bar(
        &self,
        session: &Entity<SessionModel>,
        selected: Option<&WorkspaceSnapshot>,
        window: &Window,
        p: &'static Palette,
        cx: &Context<TuxedoApp>,
    ) -> Option<AnyElement> {
        let selected = selected.filter(|s| !s.file.items.is_empty())?;
        let on_edit = on_edit(cx);
        let popover = self.popover(window, cx);
        let app = cx.entity().downgrade();
        let on_accept: OnAccept = Rc::new(move |index, window, cx| {
            app.update(cx, |app, cx| ListView::accept(app, index, window, cx))
                .ok();
        });
        let field = query_ui::render_field_row(
            &self.query,
            &self.projection,
            popover
                .as_ref()
                .map(|(word, offered)| (offered.as_slice(), self.highlighted(word, offered.len()))),
            on_accept,
            &on_edit,
            window.viewport_size().width < px(COMPACT_WINDOW_WIDTH),
            p,
        );
        // Capture phase: the popover sees these keys before the field, only while open.
        let field = completion_field::capture_keys(
            field,
            cx.entity().downgrade(),
            ListView::on_popover_key,
        );
        let error = self
            .projection
            .error()
            .map(|error| query_ui::render_error(self.projection.query(), error, p));
        Some(
            v_flex()
                .flex_shrink_0()
                .px_4()
                .pt_3()
                .pb_2()
                .gap_2()
                .border_b_1()
                .border_color(hex(p.border))
                .child(field)
                .children(error)
                .child(
                    // Wraps the Show deferred and Save view actions below the readout when
                    // the pane is too narrow for both, as at the 640 px minimum window width.
                    h_flex()
                        .items_start()
                        .flex_wrap()
                        .gap_x_3()
                        .gap_y_1()
                        .child(
                            div()
                                .flex_grow(1.)
                                .flex_shrink(1.)
                                .flex_basis(px(360.))
                                .min_w_0()
                                .child(query_ui::render_readout_row(
                                    &self.projection,
                                    self.projection.sort(selected),
                                    &on_edit,
                                    p,
                                )),
                        )
                        .child(saved_views_ui::render_toolbar(
                            session.clone(),
                            selected,
                            &self.projection,
                            p,
                            cx,
                        )),
                )
                .into_any_element(),
        )
    }

    /// The quick add line under the query bar, with its autocomplete panel and the reason
    /// its last line was refused.
    fn render_quick_add(
        &self,
        window: &Window,
        p: &'static Palette,
        cx: &Context<TuxedoApp>,
    ) -> AnyElement {
        let panel = self
            .quick_add
            .panel(&self.line_facets, local_today(), window, cx);
        let app = cx.entity().downgrade();
        let on_accept: OnAccept = Rc::new(move |index, window, cx| {
            app.update(cx, |app, cx| {
                let this = &mut app.list_view;
                this.quick_add
                    .accept(index, &this.line_facets, local_today(), window, cx);
                cx.notify();
            })
            .ok();
        });
        let saving = self.quick_add.reply.is_some();
        // Read-only while saving; the element applies this to the state on every frame.
        let field = Input::new(&self.quick_add.input)
            .readonly(saving)
            .aria_label("Quick add")
            .prefix(Icon::new(IconName::Plus).size_4())
            .suffix(
                div()
                    .text_xs()
                    .text_color(hex(p.muted_foreground))
                    .child(if saving { "Adding…" } else { "⌘N" }),
            );
        let field = completion_field::render(
            "quick-add",
            field,
            panel
                .as_ref()
                .map(|(offers, row)| (offers.as_slice(), *row)),
            on_accept,
            p,
        );
        let field = completion_field::capture_keys(
            div().flex_1().min_w_0().child(field),
            cx.entity().downgrade(),
            |app: &mut TuxedoApp, key, window, cx| {
                ListView::on_line_key(app, LineKind::QuickAdd, key, window, cx)
            },
        );
        let date = self
            .quick_add
            .date
            .as_ref()
            .map(|d| (d.calendar.clone(), d.target));
        let field = h_flex().gap_1().child(field).child(row_editor::date_button(
            "quick-add-date",
            LineKind::QuickAdd,
            date.as_ref(),
            cx.entity().downgrade(),
            Rc::new(std::cell::Cell::new(None)),
            p,
        ));
        v_flex()
            .flex_shrink_0()
            .px_4()
            .py_2()
            .gap_1()
            .border_b_1()
            .border_color(hex(p.border))
            .child(field)
            .children(
                self.quick_add
                    .error
                    .map(|error| line_error("quick-add-error", error, p)),
            )
            .into_any_element()
    }

    /// The list's focus target and key context for the row cursor keys.
    fn render_list_shell(&self, list: AnyElement, cx: &Context<TuxedoApp>) -> AnyElement {
        div()
            .id("todo-list-shell")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .key_context("TodoList")
            .track_focus(&self.list_focus)
            // Row actions run only while the list itself has focus, never from a field or a
            // popup inside it.
            .on_action(cx.listener(|app, _: &CursorUp, window, cx| {
                if app.list_view.list_focus.is_focused(window) {
                    app.list_view.move_cursor(false, cx)
                }
            }))
            .on_action(cx.listener(|app, _: &CursorDown, window, cx| {
                if app.list_view.list_focus.is_focused(window) {
                    app.list_view.move_cursor(true, cx)
                }
            }))
            .on_action(cx.listener(|app, _: &EditRow, window, cx| {
                let row = app.list_view.cursor;
                if let Some(row) = row.filter(|_| app.list_view.list_focus.is_focused(window)) {
                    ListView::start_edit(app, row, window, cx);
                }
            }))
            .on_action(cx.listener(|app, _: &ToggleRow, window, cx| {
                if app.list_view.list_focus.is_focused(window) {
                    ListView::toggle_cursor(app, cx)
                }
            }))
            .child(list)
            .into_any_element()
    }

    pub(super) fn render(
        &self,
        session: &Entity<SessionModel>,
        window: &Window,
        p: &'static Palette,
        cx: &Context<TuxedoApp>,
    ) -> AnyElement {
        // Each frame's popups record where they land again.
        self.guards.clear();
        let model = session.read(cx);
        let body = match (model.state(), model.selected()) {
            (SessionState::Restoring, _) => message(
                "Loading workspaces…",
                Some("Restoring your Workspace session.".into()),
                p,
            ),
            (SessionState::Unavailable(reason), _) => alert("Workspaces unavailable", reason, p),
            (SessionState::Ready(_), None) => match model.warning() {
                Some(warning) => alert("Workspace unavailable", warning, p),
                None if model.workspaces().is_empty() => message(
                    "No workspace open",
                    Some(
                        "No saved workspaces yet. Create one in Tuxedo to see its Todo items here."
                            .into(),
                    ),
                    p,
                ),
                None => message(
                    "No workspace open",
                    Some("Choose a Workspace in the sidebar to open its Todo file.".into()),
                    p,
                ),
            },
            (SessionState::Ready(_), Some(selected)) if selected.file.items.is_empty() => v_flex()
                .flex_1()
                .items_center()
                .child(message(
                    "No valid Todo items",
                    Some(
                        "This Todo file did not contain any parsed Todo items. Add one above."
                            .into(),
                    ),
                    p,
                ))
                .into_any_element(),
            (SessionState::Ready(_), Some(_)) if self.projection.shown() == 0 => {
                query_ui::render_no_matches(&self.projection, &on_edit(cx), p)
            }
            (SessionState::Ready(_), Some(selected)) => self.render_list_shell(
                render_list(
                    session.clone(),
                    &selected.workspace.id,
                    self.projection.rows(),
                    ListRows {
                        edit: self.row_edit(window, cx),
                        cursor: self.cursor.filter(|_| self.list_focus.is_focused(window)),
                        app: cx.entity().downgrade(),
                        scroll: self.scroll.clone(),
                    },
                    local_today(),
                    p,
                ),
                cx,
            ),
        };

        v_flex()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .children(self.render_query_bar(session, model.selected(), window, p, cx))
            .when(model.selected().is_some(), |main| {
                main.child(self.render_quick_add(window, p, cx))
            })
            .child(body)
            .when_some(model.selected(), |main, selected| {
                main.child(render_status_bar(selected, p))
            })
            .into_any_element()
    }
}

/// What rows need from the List view each frame: the editing row, the keyboard cursor (while
/// the list has focus), and the view for row clicks.
struct ListRows {
    edit: Option<RowEdit>,
    cursor: Option<usize>,
    app: WeakEntity<TuxedoApp>,
    scroll: UniformListScrollHandle,
}

/// Rows read the Todo items through the session handle, so nothing is cloned per frame.
/// The element id is scoped to the Workspace so each one gets its own scroll state. The
/// editing row draws its retained input in the row's own fixed-height slot.
fn render_list(
    session: Entity<SessionModel>,
    workspace_id: &str,
    rows: Rc<[Row]>,
    list: ListRows,
    today: TodoDate,
    p: &'static Palette,
) -> AnyElement {
    let scroll = list.scroll.clone();
    uniform_list(
        SharedString::from(format!("todo-list:{workspace_id}")),
        rows.len(),
        move |range, window, cx| {
            let compact = window.viewport_size().width < px(COMPACT_WINDOW_WIDTH);
            let model = session.read(cx);
            let (Some(selected), Some(revision)) = (model.selected(), model.revision()) else {
                return Vec::new();
            };
            range
                .filter_map(|row| {
                    let index = match *rows.get(row)? {
                        Row::Header { kind, count } => {
                            return Some(query_ui::render_group_header(kind, count, p));
                        }
                        Row::Item(index) => index,
                    };
                    if let Some(edit) = list.edit.as_ref().filter(|edit| edit.row == row) {
                        return Some(edit.render(p));
                    }
                    let item = selected.file.items.get(index)?;
                    let command = Command::Todo(TodoCommand::Complete {
                        target: todo_commands::target(selected, revision, item),
                        completed: !item.completed,
                    });
                    let toggle = session.clone();
                    let on_toggle = move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                        // The row's double-click-to-edit must not see checkbox clicks.
                        cx.stop_propagation();
                        toggle.update(cx, |model, cx| model.enqueue(command.clone(), cx));
                    };
                    let rendered = todo_row::render(index, item, today, compact, on_toggle, p);
                    Some(row_shell(
                        row,
                        rendered,
                        list.cursor == Some(row),
                        &list.app,
                        p,
                    ))
                })
                .collect()
        },
    )
    .track_scroll(&scroll)
    .flex_1()
    .min_h(px(ROW_HEIGHT))
    .into_any_element()
}

/// A row's click target: a click puts the keyboard cursor on it and focuses the list, and a
/// double-click (outside the checkbox) edits it in place.
fn row_shell(
    row: usize,
    rendered: AnyElement,
    cursor: bool,
    app: &WeakEntity<TuxedoApp>,
    p: &Palette,
) -> AnyElement {
    let (select, edit) = (app.clone(), app.clone());
    div()
        .id(("todo-row-shell", row))
        .when(cursor, |shell| shell.bg(hex(p.primary).opacity(0.08)))
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            select
                .update(cx, |app, cx| {
                    app.list_view.set_cursor(Some(row));
                    window.focus(&app.list_view.list_focus, cx);
                    cx.notify();
                })
                .ok();
        })
        .on_click(move |event, window, cx| {
            if event.click_count() == 2 {
                edit.update(cx, |app, cx| ListView::start_edit(app, row, window, cx))
                    .ok();
            }
        })
        .child(rendered)
        .into_any_element()
}

/// Applies a Saved view: its Query replaces the field's text, as one step of its undo history,
/// and applies like typing does.
pub(super) fn on_apply_query(cx: &Context<TuxedoApp>) -> saved_views_ui::OnApply {
    let app = cx.entity().downgrade();
    Rc::new(move |query, window, cx| {
        app.update(cx, |app, cx| {
            app.list_view
                .query
                .update(cx, |state, cx| state.replace_all(query, window, cx))
        })
        .ok();
    })
}

/// Routes a query control's edit to the List view, then recomputes the projection.
pub(super) fn on_edit(cx: &Context<TuxedoApp>) -> OnEdit {
    let app = cx.entity().downgrade();
    Rc::new(move |edit, window, cx| {
        app.update(cx, |app, cx| ListView::apply(app, edit, window, cx))
            .ok();
    })
}

/// Why a typed line was refused.
fn line_error(id: &'static str, error: &str, p: &Palette) -> impl IntoElement {
    h_flex()
        .id(id)
        .gap_1p5()
        .text_xs()
        .text_color(hex(p.destructive))
        .child(
            Icon::new(IconName::TriangleAlert)
                .size_3p5()
                .flex_shrink_0(),
        )
        .child(error.to_owned())
}

fn render_status_bar(selected: &WorkspaceSnapshot, p: &Palette) -> impl IntoElement {
    let summary = selected.summary;
    let file_name = selected
        .file
        .path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut parts = vec![
        format!("Workspace: {}", selected.workspace.name),
        format!("Todo file: {file_name}"),
        format!("{} parsed", summary.total),
        format!("{} completed", summary.completed),
        format!("{} pending", summary.open),
    ];
    if summary.skipped > 0 {
        let plural = if summary.skipped == 1 { "" } else { "s" };
        parts.push(format!("{} skipped line{plural}", summary.skipped));
    }
    h_flex()
        .h_8()
        .flex_shrink_0()
        .px_4()
        .gap_2()
        .overflow_hidden()
        .border_t_1()
        .border_color(hex(p.border))
        .bg(hex(p.background))
        .text_size(px(11.))
        .text_color(hex(p.muted_foreground))
        .child(div().truncate().child(parts.join("  ·  ")))
}

fn message(title: &'static str, description: Option<SharedString>, p: &Palette) -> AnyElement {
    v_flex()
        .flex_1()
        .items_center()
        .justify_center()
        .gap_2()
        .p_6()
        .child(
            Icon::new(IconName::FileText)
                .size_6()
                .text_color(hex(p.muted_foreground)),
        )
        .child(div().text_lg().font_weight(FontWeight::MEDIUM).child(title))
        .children(description.map(|d| div().text_sm().text_color(hex(p.muted_foreground)).child(d)))
        .into_any_element()
}

fn alert(title: &'static str, description: &str, p: &Palette) -> AnyElement {
    v_flex()
        .flex_1()
        .items_center()
        .justify_center()
        .p_6()
        .child(
            v_flex()
                .max_w(px(480.))
                .gap_1()
                .p_4()
                .rounded(px(10.))
                .border_1()
                .border_color(hex(p.border))
                .child(
                    h_flex()
                        .gap_2()
                        .text_color(hex(p.destructive))
                        .child(Icon::new(IconName::TriangleAlert).size_4())
                        .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(title)),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(hex(p.muted_foreground))
                        .child(description.to_owned()),
                ),
        )
        .into_any_element()
}

#[cfg(test)]
mod tests {
    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{
        point, px, AppContext as _, Entity, EntityInputHandler as _, Modifiers, MouseButton,
        MouseDownEvent, MouseUpEvent, Pixels, Point, ScrollDelta, ScrollEvent, TestAppContext,
        VisualTestContext,
    };
    use tuxedo_core::CompletionView;

    use super::super::row_editor::LineKind;
    use super::ListView;
    use crate::query_ui::FilterEdit;
    use gpui_kit::base::Root;

    use super::super::TuxedoApp;
    use crate::command_queue::Command;
    use crate::model::tests::catalogue;
    use crate::model::SessionModel;
    use crate::todo_commands::local_today;

    /// The app in a window whose root hosts dialogs, showing Workspace A with `contents`.
    fn app_window<'a>(
        name: &str,
        contents: &str,
        cx: &'a mut TestAppContext,
    ) -> (
        Entity<TuxedoApp>,
        std::path::PathBuf,
        &'a mut VisualTestContext,
    ) {
        cx.update(gpui_kit::init);
        cx.update(crate::app::bind_keys);
        let path = catalogue(name);
        let todo = path.with_file_name("A.txt");
        std::fs::write(&todo, contents).unwrap();
        let session = cx.new(|cx| SessionModel::restore_from(Some(path), cx));
        let mut app = None;
        let (_, cx) = cx.add_window_view(|window, cx| {
            crate::theme::init(window, cx);
            let view = cx.new(|cx| TuxedoApp::with_session(session.clone(), window, cx));
            app = Some(view.clone());
            Root::new(view, window, cx)
        });
        cx.run_until_parked();
        (app.unwrap(), todo, cx)
    }

    #[gpui::test]
    fn quick_add_appends_the_typed_line_and_keeps_a_refused_one(cx: &mut TestAppContext) {
        let (app, todo, cx) = app_window("quick-add", "First +Home\n", cx);
        let text = |cx: &mut VisualTestContext| {
            app.read_with(cx, |app, cx| app.list_view.quick_add_text(cx))
        };

        // Cmd-N from a text field types nothing and moves nowhere; from the window it focuses
        // quick add. Autocomplete offers the file's Project, and Tab takes it.
        cx.simulate_keystrokes("cmd-f cmd-n");
        cx.simulate_input("x");
        assert_eq!(text(cx), "");
        app.update_in(cx, |app, window, cx| window.focus(&app.focus_handle, cx));
        cx.simulate_keystrokes("cmd-n");
        cx.simulate_input("Buy milk +H");
        cx.simulate_keystrokes("tab");
        cx.simulate_input("due:2026-11-10");
        assert_eq!(text(cx), "Buy milk +Home due:2026-11-10");

        // Enter appends the line with today's Creation date; the field empties.
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        let today = local_today();
        assert_eq!(
            std::fs::read_to_string(&todo).unwrap(),
            format!("First +Home\n{today} Buy milk +Home due:2026-11-10\n")
        );
        assert_eq!(text(cx), "");

        // The space autocomplete leaves for a next word is not part of the saved line.
        cx.simulate_input("Call +H");
        cx.simulate_keystrokes("tab");
        assert_eq!(text(cx), "Call +Home ");
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        let last = std::fs::read_to_string(&todo).unwrap();
        assert!(last.ends_with(&format!("{today} Call +Home\n")), "{last:?}");

        // A refused line stays with its reason and writes nothing; Escape clears the field.
        cx.simulate_input("2026-02-30 Bad");
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        let error = app.read_with(cx, |app, _| app.list_view.quick_add.error);
        assert_eq!(error, Some("Use a valid date in YYYY-MM-DD format."));
        assert_eq!(text(cx), "2026-02-30 Bad");
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        assert_eq!(text(cx), "");
        assert_eq!(std::fs::read_to_string(&todo).unwrap().lines().count(), 3);

        // Escape during an IME composition only ends the composition; the draft stays.
        cx.simulate_input("Draft ");
        app.update_in(cx, |app, window, cx| {
            app.list_view.quick_add.input.update(cx, |state, cx| {
                state.replace_and_mark_text_in_range(None, "か", None, window, cx)
            })
        });
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        assert!(text(cx).starts_with("Draft "), "{:?}", text(cx));

        // While the save waits behind another command the line is read-only, so its reply
        // can never clear text typed after submitting.
        cx.simulate_keystrokes("cmd-a backspace");
        cx.simulate_input("Held line");
        let session = app.read_with(cx, |app, _| app.session.clone());
        session.update(cx, |model, cx| model.enqueue(Command::Held, cx));
        cx.simulate_keystrokes("enter");
        cx.simulate_input(" more");
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        assert_eq!(text(cx), "Held line");
    }

    fn double_click(position: Point<Pixels>, cx: &mut VisualTestContext) {
        for click_count in [1, 2] {
            let (button, modifiers) = (MouseButton::Left, Modifiers::default());
            cx.simulate_event(MouseDownEvent {
                button,
                position,
                modifiers,
                click_count,
                first_mouse: false,
            });
            cx.simulate_event(MouseUpEvent {
                button,
                position,
                modifiers,
                click_count,
            });
        }
        cx.run_until_parked();
    }

    #[gpui::test]
    fn a_row_edits_in_place_as_its_line_and_escape_restores_it(cx: &mut TestAppContext) {
        // Enough rows that the list virtualizes and scrolls.
        let filler: String = (3..=60).map(|n| format!("Filler {n}\r\n")).collect();
        let initial = format!("First\r\nSecond\r\n{filler}");
        let (app, todo, cx) = app_window("row-edit", &initial, cx);
        let disk = || std::fs::read_to_string(&todo).unwrap();
        let editing = |cx: &mut VisualTestContext| {
            app.read_with(cx, |app, cx| {
                let edit = app.list_view.editing.as_ref()?;
                Some((edit.row, edit.field.text(cx)))
            })
        };
        let row_point = |index: usize, cx: &mut VisualTestContext| {
            cx.debug_bounds(Box::leak(format!("todo-checkbox-{index}").into_boxed_str()))
                .unwrap()
                .center()
                + point(px(200.), px(0.))
        };

        // The checkbox completes; it never starts an edit.
        let checkbox = cx.debug_bounds("todo-checkbox-1").unwrap().center();
        double_click(checkbox, cx);
        assert_eq!(editing(cx), None);
        std::fs::write(&todo, &initial).unwrap();
        cx.run_until_parked();

        // Double-click the rest of the row: it becomes its exact raw line, in its own slot.
        double_click(row_point(0, cx), cx);
        assert_eq!(editing(cx), Some((0, "First".to_owned())));
        assert!(cx.debug_bounds("todo-edit-row").is_some());
        let input = app.read_with(cx, |app, _| {
            app.list_view
                .editing
                .as_ref()
                .unwrap()
                .field
                .input
                .downgrade()
        });

        // Escape restores the row, writes nothing, and releases the input entirely.
        cx.simulate_input(" changed");
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        assert_eq!(editing(cx), None);
        assert_eq!(disk(), initial);
        assert!(
            input.upgrade().is_none(),
            "the ended edit's input is released"
        );

        // From the keyboard (the cancelled row keeps the cursor): Down and E edit the next row,
        // Up and Enter the first.
        cx.simulate_keystrokes("down e");
        assert_eq!(editing(cx), Some((1, "Second".to_owned())));
        cx.simulate_keystrokes("escape up enter");
        assert_eq!(editing(cx), Some((0, "First".to_owned())));
        cx.simulate_keystrokes("escape down enter");
        assert_eq!(editing(cx), Some((1, "Second".to_owned())));

        // A click in the date helper's calendar leaves focus in the line: Space types (it does
        // not complete the item), the first Escape closes only the helper.
        app.update_in(cx, |app, window, cx| {
            ListView::toggle_date(app, LineKind::Row, window, cx)
        });
        cx.run_until_parked();
        let calendar = cx.debug_bounds("row-date-calendar").unwrap();
        cx.simulate_click(calendar.origin + point(px(4.), px(4.)), Modifiers::none());
        cx.run_until_parked();
        let (helper, focused) = app.update_in(cx, |app, window, cx| {
            let field = &app.list_view.editing.as_ref().unwrap().field;
            (field.date.is_some(), field.focused(window, cx))
        });
        assert!(helper && focused, "the calendar never takes focus");
        cx.simulate_keystrokes("space");
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        let helper = app.read_with(cx, |app, _| {
            app.list_view
                .editing
                .as_ref()
                .map(|edit| edit.field.date.is_some())
        });
        assert_eq!(helper, Some(false));
        assert_eq!(editing(cx), Some((1, "Second ".to_owned())));
        assert_eq!(disk(), initial, "nothing completed or saved");

        // Enter replaces only that line, keeping its ending.
        cx.simulate_input("+Home due:2026-11-10");
        cx.simulate_keystrokes("enter");
        cx.run_until_parked();
        assert_eq!(editing(cx), None);
        assert_eq!(
            disk(),
            format!("First\r\nSecond +Home due:2026-11-10\r\n{filler}")
        );
        let undo = app.read_with(cx, |app, cx| {
            app.session.read(cx).undo_label().map(str::to_owned)
        });
        assert_eq!(undo.as_deref(), Some("Undo edit"));

        // Scrolled out of view, the editing row still ends on a click elsewhere, unsaved.
        double_click(row_point(0, cx), cx);
        cx.simulate_input(" draft");
        let position = row_point(3, cx);
        cx.simulate_event(ScrollEvent {
            position,
            delta: ScrollDelta::Pixels(point(px(0.), px(-1500.))),
            ..Default::default()
        });
        cx.run_until_parked();
        assert!(cx.debug_bounds("todo-edit-row").is_none(), "scrolled out");
        let elsewhere = row_point(55, cx);
        cx.simulate_click(elsewhere, Modifiers::none());
        cx.run_until_parked();
        assert_eq!(editing(cx), None);
        assert!(disk().starts_with("First\r\n"));
    }

    #[gpui::test]
    fn the_row_cursor_never_rests_on_a_group_header(cx: &mut TestAppContext) {
        let today = local_today();
        let contents = format!("A due:{today}\nB due:{today}\nC due:2099-01-01\n");
        let (app, _todo, cx) = app_window("grouped-cursor", &contents, cx);
        for edit in [
            FilterEdit::Completion(CompletionView::Open),
            FilterEdit::Grouped(true),
        ] {
            app.update_in(cx, |app, window, cx| {
                ListView::apply_for_test(app, edit, window, cx)
            });
            cx.run_until_parked();
        }
        // Today, A, B, Upcoming, C: the cursor on B, then Space completes B, which leaves the
        // open view; the Upcoming header takes its row, and the cursor moves on to C.
        app.update_in(cx, |app, window, cx| {
            window.focus(&app.list_view.list_focus, cx)
        });
        cx.simulate_keystrokes("down down");
        let cursor = app.read_with(cx, |app, _| app.list_view.cursor);
        assert_eq!(cursor, Some(2));
        cx.simulate_keystrokes("space");
        cx.run_until_parked();
        let (cursor, line) = app.read_with(cx, |app, _| {
            (app.list_view.cursor, app.list_view.cursor_line)
        });
        assert_eq!((cursor, line), (Some(3), Some(3)), "on C, line 3");
    }
}
