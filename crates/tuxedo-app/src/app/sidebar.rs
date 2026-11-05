//! Workspace sidebar: the Workspaces list (switching, creating, editing, and removing
//! Workspaces) and the Overview counts.
//! The root shell owns its slot and the open/close slide; this module owns what slides.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::component::{Icon, Sizable};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;

use super::TuxedoApp;
use crate::model::SessionModel;
use crate::theme::{hex, Palette};
use crate::workspace_ui;

/// The sidebar's full width; the shell's slot animates between 0 and this.
pub(super) const WIDTH: f32 = 256.;

/// Sidebar-local UI state (none yet). Workspace management keeps its state here.
#[derive(Default)]
pub(super) struct WorkspaceSidebar {}

impl WorkspaceSidebar {
    pub(super) fn render(
        &self,
        session: &Entity<SessionModel>,
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
            v_flex()
                .gap_0p5()
                .child(group_label("Overview", p))
                .child(count_row("All", IconName::List, s.total, p))
                .child(count_row("Open", IconName::Circle, s.open, p))
                .child(count_row(
                    "Completed",
                    IconName::CircleCheck,
                    s.completed,
                    p,
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
                        content
                            .child(
                                div()
                                    .mx_2()
                                    .my_2()
                                    .border_t_1()
                                    .border_color(hex(p.sidebar_border)),
                            )
                            .child(overview)
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

fn count_row(label: &'static str, icon: IconName, count: usize, p: &Palette) -> impl IntoElement {
    h_flex()
        .h_8()
        .px_2()
        .gap_2()
        .text_sm()
        .child(Icon::new(icon).size_4().text_color(hex(p.muted_foreground)))
        .child(div().flex_1().child(label))
        .child(
            div()
                .text_xs()
                .text_color(hex(p.muted_foreground))
                .child(count.to_string()),
        )
}
