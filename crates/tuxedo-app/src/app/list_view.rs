//! List view: the main pane's states (loading, unavailable, empty), the Todo item list, the
//! error banner, and the status bar. Rows themselves render in `todo_row`.

use gpui_kit::assets::IconName;
use gpui_kit::component::Icon;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{TodoDate, WorkspaceSnapshot};

use super::TuxedoApp;
use crate::model::{SessionModel, SessionState};
use crate::theme::{hex, Palette};
use crate::todo_row::{self, ROW_HEIGHT};

/// List-view-local UI state (none yet). Filters and toolbar state live here.
#[derive(Default)]
pub(super) struct ListView {}

impl ListView {
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
            (SessionState::Ready(_), Some(selected)) => render_list(
                session.clone(),
                &selected.workspace.id,
                selected.file.items.len(),
                local_today(),
                p,
            ),
        };

        v_flex()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .when_some(model.error(), |main, error| {
                main.child(error_banner(error, p))
            })
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
    count: usize,
    today: TodoDate,
    p: &'static Palette,
) -> AnyElement {
    uniform_list(
        SharedString::from(format!("todo-list:{workspace_id}")),
        count,
        move |range, _, cx| {
            let Some(selected) = session.read(cx).selected() else {
                return Vec::new();
            };
            range
                .filter_map(|index| {
                    Some(todo_row::render(
                        index,
                        selected.file.items.get(index)?,
                        today,
                        p,
                    ))
                })
                .collect()
        },
    )
    .flex_1()
    .min_h(px(ROW_HEIGHT))
    .into_any_element()
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

fn error_banner(error: &str, p: &Palette) -> impl IntoElement {
    h_flex()
        .flex_shrink_0()
        .gap_2()
        .px_4()
        .py_2()
        .border_b_1()
        .border_color(hex(p.border))
        .bg(hex(p.destructive).opacity(0.1))
        .text_sm()
        .text_color(hex(p.destructive))
        .child(Icon::new(IconName::TriangleAlert).size_4())
        .child(div().truncate().child(error.to_owned()))
}

fn local_today() -> TodoDate {
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();
    TodoDate::parse(&today).expect("chrono formats a valid YYYY-MM-DD date")
}
