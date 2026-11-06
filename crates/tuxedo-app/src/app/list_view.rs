//! List view: the main pane's states (loading, unavailable, empty), the Todo item list, and the
//! status bar. Rows themselves render in `todo_row`.

use gpui_kit::assets::IconName;
use gpui_kit::component::input::{
    Enter, Escape, IndentInline, InputEvent, InputState, MoveDown, MoveUp,
};
use gpui_kit::component::Icon;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use tuxedo_core::{query_word_at, TodoDate, WorkspaceSnapshot};

use super::TuxedoApp;
use crate::command_queue::{Command, TodoCommand};
use crate::model::{SessionModel, SessionState};
use crate::query_ui::{self, FilterEdit, OnAccept, OnEdit, Suggestion};
use crate::theme::{hex, Palette};
use crate::todo_commands::{self, local_today};
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
    /// The highlighted autocomplete row.
    highlighted: usize,
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
            highlighted: 0,
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
            self.highlighted = 0;
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

    /// Cmd-F: puts the caret in the query field.
    pub(super) fn focus_query(&self, window: &mut Window, cx: &mut Context<TuxedoApp>) {
        self.query.update(cx, |state, cx| state.focus(window, cx));
    }

    /// Applies a control's edit; the caller then recomputes via `session_changed`, which
    /// also shows a rewritten query in the field.
    fn edit(&mut self, edit: FilterEdit) {
        let p = &mut self.projection;
        match edit {
            FilterEdit::Completion(view) => p.set_completion(view),
            FilterEdit::Add(condition) => p.add_condition(&condition),
            FilterEdit::Clear => p.clear(),
            FilterEdit::Sort(sort) => p.set_sort(sort),
            FilterEdit::Grouped(grouped) => p.set_grouped(grouped),
        }
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

    /// Handles a popover key, or lets it through to the field while the popover is closed.
    fn on_popover_key(
        app: &mut TuxedoApp,
        key: PopoverKey,
        window: &mut Window,
        cx: &mut Context<TuxedoApp>,
    ) {
        let Some((_, offered)) = app.list_view.popover(window, cx) else {
            return;
        };
        cx.stop_propagation();
        let this = &mut app.list_view;
        let last = offered.len() - 1;
        let current = this.highlighted.min(last);
        match key {
            PopoverKey::Up => this.highlighted = current.checked_sub(1).unwrap_or(last),
            PopoverKey::Down => this.highlighted = if current == last { 0 } else { current + 1 },
            PopoverKey::Close => this.dismissed = true,
            PopoverKey::Accept => return Self::accept(app, current, window, cx),
        }
        cx.notify();
    }

    /// Replaces the word at the caret with suggestion `index` and a space, leaving the caret
    /// after them.
    fn accept(app: &mut TuxedoApp, index: usize, window: &mut Window, cx: &mut Context<TuxedoApp>) {
        let Some((word, offered)) = app.list_view.popover(window, cx) else {
            return;
        };
        let Some(token) = offered.get(index).map(|s| s.token.clone()) else {
            return;
        };
        let query = app.list_view.query.clone();
        let text = query.read(cx).value().to_string();
        // The word ends at the core lexer's whitespace or at the end: step over a following
        // separator, or add a space.
        let separator = text[word.end..].chars().next();
        let replacement = if separator.is_some() {
            token
        } else {
            format!("{token} ")
        };
        let caret = word.start + replacement.len() + separator.map_or(0, char::len_utf8);
        // `replace` keeps the field's undo history; its change event reparses the query.
        query.update(cx, |state, cx| {
            state.set_selected_range(word.clone(), cx);
            state.replace(replacement, window, cx);
            state.set_selected_range(caret..caret, cx);
            state.focus(window, cx);
        });
        app.list_view.highlighted = 0;
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
                .map(|(_, offered)| (offered.as_slice(), self.highlighted.min(offered.len() - 1))),
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
                .child(field)
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
            (SessionState::Ready(_), Some(selected)) if selected.file.items.is_empty() => message(
                "No valid Todo items",
                Some("This Todo file did not contain any parsed Todo items.".into()),
                p,
            ),
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
                    let session = session.clone();
                    let on_toggle = move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                        session.update(cx, |model, cx| model.enqueue(command.clone(), cx));
                    };
                    Some(todo_row::render(index, item, today, compact, on_toggle, p))
                })
                .collect()
        },
    )
    .flex_1()
    .min_h(px(ROW_HEIGHT))
    .into_any_element()
}

/// Routes a query control's edit to the List view, then recomputes the projection.
pub(super) fn on_edit(cx: &Context<TuxedoApp>) -> OnEdit {
    let app = cx.entity().downgrade();
    Rc::new(move |edit, _, cx| {
        app.update(cx, |app, cx| {
            app.list_view.edit(edit);
            app.session_changed(cx);
        })
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
