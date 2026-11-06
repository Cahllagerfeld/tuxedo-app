//! Workspace sidebar: the Workspaces list (switching, creating, editing, and removing
//! Workspaces) and Overview, which shows the counts and selects the completion view.
//! The root shell owns its slot and the open/close slide; this module owns what slides.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::component::{Icon, Sizable};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;

use tuxedo_core::CompletionView;

use super::{list_view, TuxedoApp};
use crate::model::SessionModel;
use crate::query_ui::{FilterEdit, OnEdit};
use crate::theme::{hex, Palette};
use crate::todo_projection::TodoProjection;
use crate::workspace_ui;

/// The sidebar's full width; the shell's slot animates between 0 and this.
pub(super) const WIDTH: f32 = 256.;

/// The sidebar holds no state of its own: the completion view lives in the List view's query.
pub(super) struct WorkspaceSidebar;

impl WorkspaceSidebar {
    /// `projection` is the List view's while it has Todo items to filter; without it the
    /// Overview rows show counts only.
    pub(super) fn render(
        &self,
        session: &Entity<SessionModel>,
        projection: Option<&TodoProjection>,
        p: &Palette,
        cx: &Context<TuxedoApp>,
    ) -> impl IntoElement {
        let model = session.read(cx);
        let active_id = model.selected().map(|s| s.workspace.id.as_str());
        let pending = model.pending();
        let items = model
            .workspaces()
            .iter()
            .enumerate()
            .map(|(index, workspace)| {
                let is_active = active_id == Some(workspace.id.as_str());
                let is_pending = pending == Some(workspace.id.as_str());
                let (dot, _) = p.workspace(workspace.color);
                let id = workspace.id.clone();
                h_flex()
                    .id(("workspace", index))
                    .when(cfg!(test) && index == 2, |item| {
                        item.debug_selector(|| "workspace-row-2".into())
                    })
                    .h_8()
                    .px_2()
                    .gap_2()
                    .rounded(px(8.))
                    .text_sm()
                    .cursor_pointer()
                    .hover(|style| style.bg(hex(p.sidebar_accent)))
                    .when(is_active, |item| {
                        item.bg(hex(p.sidebar_accent))
                            .text_color(hex(p.sidebar_accent_foreground))
                    })
                    .child(div().size_2().flex_shrink_0().rounded_full().bg(dot))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .child(workspace.name.clone()),
                    )
                    .when(is_active, |item| {
                        item.child(
                            div()
                                .text_xs()
                                .text_color(hex(p.muted_foreground))
                                .child("Active"),
                        )
                    })
                    .when(is_pending, |item| {
                        item.child(
                            div()
                                .text_xs()
                                .text_color(hex(p.muted_foreground))
                                .child("Opening…"),
                        )
                    })
                    .child(options_menu(index, workspace, session))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.session
                            .update(cx, |session, cx| session.select(&id, cx));
                    }))
            });

        let overview = model.selected().map(|selected| {
            let s = selected.summary;
            let current = projection.map(|p| p.filters().completion);
            let on_edit = list_view::on_edit(cx);
            let row = |view, label, icon, count| {
                overview_row(view, label, icon, count, current, &on_edit, p)
            };
            v_flex()
                .gap_0p5()
                .child(group_label("Overview", p))
                .child(row(CompletionView::All, "All", IconName::List, s.total))
                .child(row(CompletionView::Open, "Open", IconName::Circle, s.open))
                .child(row(
                    CompletionView::Completed,
                    "Completed",
                    IconName::CircleCheck,
                    s.completed,
                ))
        });

        v_flex()
            .w(px(WIDTH))
            .flex_shrink_0()
            .h_full()
            .bg(hex(p.sidebar))
            .text_color(hex(p.sidebar_foreground))
            .border_r_1()
            .border_color(hex(p.sidebar_border))
            .child(
                v_flex()
                    .id("sidebar-content")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px_2()
                    .pt_3()
                    .pb_3()
                    .gap_2()
                    .child(
                        v_flex()
                            .gap_0p5()
                            .child(
                                h_flex()
                                    .justify_between()
                                    .child(group_label("Workspaces", p))
                                    .child(create_button(session)),
                            )
                            .children(items)
                            .when(model.workspaces().is_empty(), |group| {
                                group.child(
                                    div()
                                        .px_2()
                                        .py_1p5()
                                        .text_sm()
                                        .text_color(hex(p.muted_foreground))
                                        .child("No saved workspaces yet."),
                                )
                            }),
                    )
                    .when_some(overview, |content, overview| {
                        content.child(separator(p)).child(overview)
                    }),
            )
            .child(
                v_flex()
                    .p_4()
                    .text_xs()
                    .text_color(hex(p.muted_foreground))
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(hex(p.sidebar_foreground))
                            .child("Tuxedo"),
                    )
                    .child("Your Todo files, in one place."),
            )
    }
}

/// Starts Workspace creation.
fn create_button(session: &Entity<SessionModel>) -> impl IntoElement {
    let session = session.clone();
    Button::new("create-workspace")
        .ghost()
        .xsmall()
        .icon(Icon::new(IconName::Plus))
        .tooltip("Create workspace")
        .on_click(move |_, window, cx| workspace_ui::open_create(session.clone(), window, cx))
}

/// A Workspace's own options: edit it or remove it, without opening its Todo file.
fn options_menu(
    index: usize,
    workspace: &tuxedo_core::Workspace,
    session: &Entity<SessionModel>,
) -> impl IntoElement {
    let (session, workspace) = (session.clone(), workspace.clone());
    Button::new(("workspace-options", index))
        .ghost()
        .xsmall()
        .icon(Icon::new(IconName::Ellipsis))
        .tooltip(format!("Options for {}", workspace.name))
        .dropdown_menu(move |menu, _, _| {
            let (edit_session, edit_workspace) = (session.clone(), workspace.clone());
            let (remove_session, remove_workspace) = (session.clone(), workspace.clone());
            menu.item(
                PopupMenuItem::new("Edit workspace…").on_click(move |_, window, cx| {
                    workspace_ui::open_edit(edit_session.clone(), &edit_workspace, window, cx)
                }),
            )
            .item(
                PopupMenuItem::new("Remove workspace…").on_click(move |_, window, cx| {
                    workspace_ui::open_delete(remove_session.clone(), &remove_workspace, window, cx)
                }),
            )
        })
}

fn separator(p: &Palette) -> impl IntoElement {
    div()
        .mx_2()
        .my_2()
        .border_t_1()
        .border_color(hex(p.sidebar_border))
}

fn group_label(label: &'static str, p: &Palette) -> impl IntoElement {
    div()
        .h_8()
        .px_2()
        .flex()
        .items_center()
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(hex(p.muted_foreground))
        .child(label)
}

/// One Overview row: the completion view's count; while the List view has Todo items to
/// filter, a toggle that selects that view by rewriting the query's `is:` word.
fn overview_row(
    view: CompletionView,
    label: &'static str,
    icon: IconName,
    count: usize,
    current: Option<CompletionView>,
    on_edit: &OnEdit,
    p: &Palette,
) -> impl IntoElement {
    let selected = current == Some(view);
    let on_edit = on_edit.clone();
    h_flex()
        .id(SharedString::from(format!(
            "overview-{}",
            label.to_lowercase()
        )))
        .h_8()
        .px_2()
        .gap_2()
        .rounded(px(8.))
        .text_sm()
        .when(current.is_some(), |row| {
            row.cursor_pointer()
                .hover(|style| style.bg(hex(p.sidebar_accent)))
                .on_click(move |_, window, cx| on_edit(FilterEdit::Completion(view), window, cx))
        })
        .when(selected, |row| {
            row.bg(hex(p.sidebar_accent))
                .text_color(hex(p.sidebar_accent_foreground))
                .font_weight(FontWeight::MEDIUM)
        })
        .child(Icon::new(icon).size_4().text_color(hex(p.muted_foreground)))
        .child(div().flex_1().child(label))
        .child(
            div()
                .text_xs()
                .text_color(hex(p.muted_foreground))
                .child(count.to_string()),
        )
}
