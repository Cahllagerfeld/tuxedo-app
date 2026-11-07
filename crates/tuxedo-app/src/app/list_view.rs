//! List view: the main pane's states (loading, unavailable, empty), the Todo item list, and the
//! status bar. Rows themselves render in `todo_row`.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::Button;
use gpui_kit::component::input::{
    Enter, Escape, IndentInline, InputEvent, InputState, MoveDown, MoveUp,
};
use gpui_kit::component::menu::{ContextMenuExt, PopupMenuItem};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::component::{Icon, Sizable};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use tuxedo_core::{
    query_with_condition, query_with_condition_at, query_word_at, QueryCondition, TodoDate,
    WorkspaceSnapshot,
};

use super::TuxedoApp;
use crate::command_queue::{Command, TodoCommand};
use crate::model::{SessionModel, SessionState};
use crate::query_ui::{self, FilterEdit, OnAccept, OnEdit, Suggestion};
use crate::theme::{hex, Palette};
use crate::todo_commands::{self, local_today};
use crate::todo_editor;
use crate::todo_projection::{Row, TodoProjection};
use crate::todo_row::{self, ROW_HEIGHT};

/// Below this window width the query bar drops its shortcut hint and button label, so the
/// field keeps room beside an open sidebar, and rows show one token and a count.
const COMPACT_WINDOW_WIDTH: f32 = 960.;

/// How often the List view checks whether the local date changed.
const DATE_POLL: Duration = Duration::from_secs(60);

/// List-view-local UI state: the projection of the selected Todo file into displayed rows,
/// with its query, sort, and grouping, and the query field's autocomplete.
pub(super) struct ListView {
    projection: TodoProjection,
    query: Entity<InputState>,
    /// The highlighted autocomplete row and the word it belongs to. Any other word, such as
    /// one the caret moved to, opens with its first row highlighted.
    highlight: Option<(Range<usize>, usize)>,
    /// Escape closed the popover; the next edit reopens it.
    dismissed: bool,
    /// The query field lives in the window; set it there when an edit elsewhere changes it.
    window: AnyWindowHandle,
    _subscriptions: [Subscription; 2],
    /// Recomputes the projection when the local date changes.
    _date_watch: Task<()>,
}

/// A key the autocomplete popover takes while it is open.
#[derive(Debug, Clone, Copy)]
enum PopoverKey {
    Up,
    Down,
    Accept,
    Close,
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
            highlight: None,
            dismissed: false,
            window: window.window_handle(),
            _subscriptions: [changed, focus],
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
            self.highlight = None;
            self.dismissed = false;
            self.projection.set_query(text);
        }
        self.projection.set_typing(typing);
        true
    }

    /// Recomputes the displayed rows after accepted session data, a query edit, or the local
    /// date changes. A different Workspace clears the query; the same one keeps it.
    pub(super) fn reproject(&mut self, selected: Option<&WorkspaceSnapshot>, today: TodoDate) {
        self.projection.sync(selected, today);
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
        if self.dismissed || !state.focus_handle(cx).is_focused(window) {
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
        match &self.highlight {
            Some((at, row)) if at == word => (*row).min(len - 1),
            _ => 0,
        }
    }

    /// Handles a popover key, or lets it through to the field while the popover is closed.
    fn on_popover_key(
        app: &mut TuxedoApp,
        key: PopoverKey,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let Some((word, offered)) = app.list_view.popover(window, cx) else {
            return;
        };
        cx.stop_propagation();
        let this = &mut app.list_view;
        let last = offered.len() - 1;
        let current = this.highlighted(&word, offered.len());
        let next = match key {
            PopoverKey::Up => current.checked_sub(1).unwrap_or(last),
            PopoverKey::Down => (current + 1) % offered.len(),
            PopoverKey::Close => {
                this.dismissed = true;
                current
            }
            PopoverKey::Accept => return Self::accept(app, current, window, cx),
        };
        this.highlight = Some((word, next));
        cx.notify();
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
        app.list_view.highlight = None;
        if app.list_view.query_changed(window, cx) {
            app.session_changed(cx);
        }
    }

    /// The query bar above the list: field, Add filter, error hint, readout, Sort and Group.
    fn render_query_bar(
        &self,
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
        let key = |key: PopoverKey| {
            move |app: &mut TuxedoApp, window: &mut Window, cx: &mut Context<TuxedoApp>| {
                ListView::on_popover_key(app, key, window, cx)
            }
        };
        let (up, down, enter, tab, escape) = (
            key(PopoverKey::Up),
            key(PopoverKey::Down),
            key(PopoverKey::Accept),
            key(PopoverKey::Accept),
            key(PopoverKey::Close),
        );
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
        )
        // Capture phase: the popover sees these keys before the field, only while open.
        .capture_action(cx.listener(move |app, _: &MoveUp, w, cx| up(app, w, cx)))
        .capture_action(cx.listener(move |app, _: &MoveDown, w, cx| down(app, w, cx)))
        .capture_action(cx.listener(move |app, _: &Enter, w, cx| enter(app, w, cx)))
        .capture_action(cx.listener(move |app, _: &IndentInline, w, cx| tab(app, w, cx)))
        .capture_action(cx.listener(move |app, _: &Escape, w, cx| escape(app, w, cx)));
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
                .child(
                    h_flex()
                        .gap_2()
                        .child(div().flex_1().min_w_0().child(field))
                        .child(new_item_button(cx)),
                )
                .children(error)
                .child(query_ui::render_readout_row(
                    &self.projection,
                    self.projection.sort(selected),
                    &on_edit,
                    p,
                ))
                .into_any_element(),
        )
    }

    pub(super) fn render(
        &self,
        session: &Entity<SessionModel>,
        window: &Window,
        p: &'static Palette,
        cx: &Context<TuxedoApp>,
    ) -> AnyElement {
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
                    Some("This Todo file did not contain any parsed Todo items.".into()),
                    p,
                ))
                .child(div().pb_6().child(new_item_button(cx)))
                .into_any_element(),
            (SessionState::Ready(_), Some(_)) if self.projection.shown() == 0 => {
                query_ui::render_no_matches(&self.projection, &on_edit(cx), p)
            }
            (SessionState::Ready(_), Some(selected)) => render_list(
                session.clone(),
                &selected.workspace.id,
                self.projection.rows(),
                local_today(),
                p,
            ),
        };

        v_flex()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .children(self.render_query_bar(model.selected(), window, p, cx))
            .child(body)
            .when_some(model.selected(), |main, selected| {
                main.child(render_status_bar(selected, p))
            })
            .into_any_element()
    }
}

/// Rows read the Todo items through the session handle, so nothing is cloned per frame.
/// The element id is scoped to the Workspace so each one gets its own scroll state.
fn render_list(
    session: Entity<SessionModel>,
    workspace_id: &str,
    rows: Rc<[Row]>,
    today: TodoDate,
    p: &'static Palette,
) -> AnyElement {
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
                    let item = selected.file.items.get(index)?;
                    let command = Command::Todo(TodoCommand::Complete {
                        target: todo_commands::target(selected, revision, item),
                        completed: !item.completed,
                    });
                    let toggle = session.clone();
                    let on_toggle = move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                        toggle.update(cx, |model, cx| model.enqueue(command.clone(), cx));
                    };
                    let row = todo_row::render(index, item, today, compact, on_toggle, p);
                    Some(editable_row(index, row, &session, item))
                })
                .collect()
        },
    )
    .flex_1()
    .min_h(px(ROW_HEIGHT))
    .into_any_element()
}

/// Double-click or the context menu's Edit opens the Todo-item editor for the row's item.
fn editable_row(
    index: usize,
    row: AnyElement,
    session: &Entity<SessionModel>,
    item: &tuxedo_core::TodoItem,
) -> AnyElement {
    let (session, item) = (session.clone(), item.clone());
    let edit = move |window: &mut Window, cx: &mut App| {
        todo_editor::open_edit(session.clone(), &item, window, cx)
    };
    let menu_edit = edit.clone();
    div()
        .id(("todo-edit", index))
        .on_click(move |event, window, cx| {
            if event.click_count() == 2 {
                edit(window, cx);
            }
        })
        .context_menu(move |menu, _, _| {
            let edit = menu_edit.clone();
            menu.item(
                PopupMenuItem::new("Edit Todo item…")
                    .on_click(move |_, window, cx| edit(window, cx)),
            )
        })
        .child(row)
        .into_any_element()
}

/// The toolbar's New item action (also Cmd-N).
fn new_item_button(cx: &Context<TuxedoApp>) -> Button {
    Button::new("new-todo-item")
        .small()
        .outline()
        .icon(Icon::new(IconName::Plus))
        .label("New item")
        .tooltip("New Todo item (⌘N)")
        .on_click(
            cx.listener(|app, _, window, cx| {
                todo_editor::open_new(app.session.clone(), window, cx)
            }),
        )
}

/// Routes a query control's edit to the List view, then recomputes the projection.
pub(super) fn on_edit(cx: &Context<TuxedoApp>) -> OnEdit {
    let app = cx.entity().downgrade();
    Rc::new(move |edit, window, cx| {
        app.update(cx, |app, cx| ListView::apply(app, edit, window, cx))
            .ok();
    })
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
