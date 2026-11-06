//! List view: the main pane's states (loading, unavailable, empty), the Todo item list, and the
//! status bar. Rows themselves render in `todo_row`.

use gpui_kit::assets::IconName;
use gpui_kit::component::Icon;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::component::input::{InputEvent, InputState};

use tuxedo_core::{TodoDate, WorkspaceSnapshot};

use super::TuxedoApp;
use crate::command_queue::{Command, TodoCommand};
use crate::filter_ui::{self, FilterEdit, OnEdit};
use crate::model::{SessionModel, SessionState};
use crate::theme::{hex, Palette};
use crate::todo_commands::{self, local_today};
use crate::todo_projection::{Row, TodoProjection};
use crate::todo_row::{self, ROW_HEIGHT};

/// How often the List view checks whether the local date changed.
const DATE_POLL: Duration = Duration::from_secs(60);

/// List-view-local UI state: the projection of the selected Todo file into displayed rows,
/// with its filters, search, sort, and grouping.
pub(super) struct ListView {
    projection: TodoProjection,
    search: Entity<InputState>,
    /// The search field lives in the window; set it there when a reset clears the search.
    window: AnyWindowHandle,
    _subscriptions: [Subscription; 1],
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
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search Todo items…"));
        let typed = cx.subscribe(&search, |app, search, event: &InputEvent, cx| {
            if let InputEvent::Change = event {
                let text = search.read(cx).value().to_string();
                app.list_view.edit(FilterEdit::Search(text));
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
            search,
            window: window.window_handle(),
            _subscriptions: [typed],
            _date_watch: date_watch,
        }
    }

    /// Recomputes the displayed rows after accepted session data, a filter, or the local date
    /// changes. A different Workspace resets the filters; the same one keeps and reconciles them.
    pub(super) fn reproject(&mut self, selected: Option<&WorkspaceSnapshot>, today: TodoDate) {
        self.projection.sync(selected, today);
    }

    /// Shows the projection's search in the field after a reset changed it.
    pub(super) fn sync_search_field(&self, cx: &mut Context<TuxedoApp>) {
        let wanted = self.projection.search_text().to_owned();
        if self.search.read(cx).value().as_ref() == wanted {
            return;
        }
        let search = self.search.clone();
        let window = self.window;
        cx.defer(move |cx| {
            window
                .update(cx, |_, window, cx| {
                    search.update(cx, |state, cx| state.set_value(wanted, window, cx))
                })
                .ok();
        });
    }

    /// Applies a filter control's edit; the caller then recomputes via `session_changed`.
    fn edit(&mut self, edit: FilterEdit) {
        let p = &mut self.projection;
        match edit {
            FilterEdit::Completion(view) => p.set_completion(view),
            FilterEdit::Search(text) => p.set_search(text),
            FilterEdit::Project(value) => p.toggle_project(&value),
            FilterEdit::Context(value) => p.toggle_context(&value),
            FilterEdit::Priority(value) => p.toggle_priority(value),
            FilterEdit::Due(value) => p.toggle_due(value),
            FilterEdit::Clear => p.clear(),
            FilterEdit::Sort(sort) => p.set_sort(sort),
            FilterEdit::Grouped(grouped) => p.set_grouped(grouped),
        }
    }

    /// The projection whose Facets the sidebar shows, while the toolbar shows too.
    pub(super) fn facets(&self, selected: Option<&WorkspaceSnapshot>) -> Option<&TodoProjection> {
        selected.filter(|s| !s.file.items.is_empty())?;
        Some(&self.projection)
    }

    /// The toolbar above the list: search, completion view, sort and grouping.
    fn render_toolbar(
        &self,
        selected: Option<&WorkspaceSnapshot>,
        p: &'static Palette,
        cx: &Context<TuxedoApp>,
    ) -> Option<AnyElement> {
        let selected = selected.filter(|s| !s.file.items.is_empty())?;
        Some(filter_ui::render_toolbar(
            &self.projection,
            self.projection.sort(selected),
            &self.search,
            &on_edit(cx),
            p,
        ))
    }

    pub(super) fn render(
        &self,
        session: &Entity<SessionModel>,
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
                filter_ui::render_no_matches(&self.projection, &on_edit(cx), p)
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
            .children(self.render_toolbar(model.selected(), p, cx))
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
        move |range, _, cx| {
            let model = session.read(cx);
            let (Some(selected), Some(revision)) = (model.selected(), model.revision()) else {
                return Vec::new();
            };
            range
                .filter_map(|row| {
                    let index = match *rows.get(row)? {
                        Row::Header { kind, count } => {
                            return Some(filter_ui::render_group_header(kind, count, p));
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
                    Some(todo_row::render(index, item, today, on_toggle, p))
                })
                .collect()
        },
    )
    .flex_1()
    .min_h(px(ROW_HEIGHT))
    .into_any_element()
}

/// Routes a filter control's edit to the List view, then recomputes the projection.
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
