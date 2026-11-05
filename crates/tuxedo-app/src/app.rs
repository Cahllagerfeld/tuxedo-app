//! App shell: title bar, navigation rail, Workspace sidebar, List view, and status bar.
//! Mirrors `routes/+layout.svelte` and its children; read-only.

use std::time::Duration;

use gpui_kit::assets::IconName;
use gpui_kit::base::{transition, RoundedFrameCover, Transition};
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::component::{Disableable, Icon, Selectable, Sizable, TitleBar};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{TodoDate, WorkspaceSnapshot};

use crate::model::{SessionModel, SessionState};
use crate::theme::{self, hex, Palette};
use crate::todo_row::{self, ROW_HEIGHT};

const TOOLBAR_HEIGHT: f32 = 40.;
const RAIL_WIDTH: f32 = 56.;
const SIDEBAR_WIDTH: f32 = 256.;
/// The sidebar's open/close slide (Electron's `duration-200 ease-linear`).
const SIDEBAR_TRANSITION: Duration = Duration::from_millis(200);
/// The content card's radius (`rounded-xl`).
const CARD_RADIUS: f32 = 14.;

pub struct TuxedoApp {
    session: Entity<SessionModel>,
    sidebar_open: bool,
    _subscriptions: Vec<Subscription>,
}

impl TuxedoApp {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let session = cx.new(SessionModel::new);
        Self::with_session(session, window, cx)
    }

    fn with_session(
        session: Entity<SessionModel>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let subscriptions = vec![
            cx.observe(&session, |_, _, cx| cx.notify()),
            cx.observe_window_appearance(window, |_, window, cx| theme::init(window, cx)),
        ];
        Self {
            session,
            sidebar_open: true,
            _subscriptions: subscriptions,
        }
    }

    #[cfg(feature = "screenshot")]
    pub fn session(&self) -> &Entity<SessionModel> {
        &self.session
    }

    #[cfg(feature = "screenshot")]
    pub fn sidebar_open(&self) -> bool {
        self.sidebar_open
    }

    pub fn set_sidebar_open(&mut self, open: bool, cx: &mut Context<Self>) {
        self.sidebar_open = open;
        cx.notify();
    }
}

impl Render for TuxedoApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = Palette::current(cx);
        // One stable id for both directions, so a quick re-toggle reverses from the current width.
        // Snaps under reduced motion and stops requesting frames at rest.
        let sidebar_width = transition(
            ("workspace-sidebar", "width"),
            if self.sidebar_open { SIDEBAR_WIDTH } else { 0. },
            Transition::new(SIDEBAR_TRANSITION).ease(|t| t),
            window,
            cx,
        );
        let model = self.session.read(cx);
        let selected = model.selected();
        let restored = !matches!(model.state(), SessionState::Restoring);
        // Mounted even when closed, so its scroll state survives a close and reopen. At width 0
        // the slot's clip leaves it nothing to paint or hit-test.
        let shows_sidebar = restored;

        v_flex()
            .size_full()
            .bg(hex(p.window_background))
            .text_color(hex(p.foreground))
            .font_family(theme::UI_FONT)
            .child(self.render_title_bar(selected.is_some(), p, cx))
            .child(
                // Plain rows (not `h_flex`, which centers) so the rail and inset span the height.
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .when_some(selected, |row, selected| {
                        row.child(render_rail(selected, model.pending(), p))
                    })
                    .child(
                        // A block frame (no `flex`): `RoundedFrameCover` sits after the content
                        // and positions itself by moving up one frame height.
                        div()
                            .relative()
                            .flex_1()
                            .min_h_0()
                            .min_w_0()
                            .m_1()
                            .overflow_hidden()
                            .rounded(px(CARD_RADIUS))
                            .border_1()
                            .border_color(hex(p.border))
                            .bg(hex(p.background))
                            .shadow_sm()
                            .child(
                                div()
                                    .size_full()
                                    .flex()
                                    .when(shows_sidebar, |content| {
                                        content.child(self.render_sidebar_slot(
                                            sidebar_width,
                                            model,
                                            p,
                                            cx,
                                        ))
                                    })
                                    .child(self.render_main(model, p)),
                            )
                            // GPUI clips children to a rectangle; this paints the window
                            // background into the corner notches so nothing pokes past the
                            // rounded border, including scrolled or hovered rows.
                            .child(
                                RoundedFrameCover::uniform(px(CARD_RADIUS))
                                    .frame_border(px(1.))
                                    .backdrop(hex(p.window_background)),
                            ),
                    ),
            )
    }
}

impl TuxedoApp {
    fn render_title_bar(
        &self,
        shows_workspace: bool,
        p: &Palette,
        cx: &Context<Self>,
    ) -> impl IntoElement {
        TitleBar::new()
            .h(px(TOOLBAR_HEIGHT))
            .bg(hex(p.window_background))
            .border_0()
            .text_sm()
            .text_color(hex(p.muted_foreground))
            .child(
                h_flex()
                    .pl_4()
                    .gap_1()
                    .when(shows_workspace, |bar| {
                        bar.child(
                            Button::new("toggle-sidebar")
                                .ghost()
                                .small()
                                .icon(Icon::new(IconName::PanelLeft))
                                .tooltip("Toggle sidebar")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    // macOS posts no change notification; re-read the setting here.
                                    gpui_kit::base::apply_system_reduce_motion(cx);
                                    this.set_sidebar_open(!this.sidebar_open, cx);
                                })),
                        )
                    })
                    .when(!shows_workspace, |bar| {
                        bar.child(
                            div()
                                .pl_2()
                                .text_xs()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("Tuxedo"),
                        )
                    }),
            )
    }

    /// The sidebar's layout slot animates `width` while the sidebar keeps its full width,
    /// pinned to the slot's right edge, so it slides out to the left under the clip instead of
    /// being squeezed. While closing or closed an occluding overlay makes it inert, like
    /// Electron's `inert`: no clicks, hover, or scrolling.
    fn render_sidebar_slot(
        &self,
        width: f32,
        model: &SessionModel,
        p: &Palette,
        cx: &Context<Self>,
    ) -> impl IntoElement {
        div()
            .id("workspace-sidebar-slot")
            .when(cfg!(test), |slot| {
                slot.debug_selector(|| "workspace-sidebar-slot".into())
            })
            .relative()
            .flex()
            .justify_end()
            .h_full()
            .w(px(width))
            .min_w_0()
            .flex_shrink_0()
            .overflow_hidden()
            .child(self.render_sidebar(model, p, cx))
            .when(!self.sidebar_open, |slot| {
                slot.child(div().absolute().inset_0().occlude())
            })
    }

    fn render_sidebar(
        &self,
        model: &SessionModel,
        p: &Palette,
        cx: &Context<Self>,
    ) -> impl IntoElement {
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
            .w(px(SIDEBAR_WIDTH))
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
                            .child(group_label("Workspaces", p))
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

    fn render_main(&self, model: &SessionModel, p: &'static Palette) -> AnyElement {
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
                self.session.clone(),
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

fn render_rail(
    selected: &WorkspaceSnapshot,
    pending: Option<&str>,
    p: &Palette,
) -> impl IntoElement {
    let badge = Some(&selected.workspace).map(|workspace| {
        let (bg, fg) = p.workspace(workspace.color);
        let initial = if pending.is_some() {
            "…".to_owned()
        } else {
            workspace
                .name
                .trim()
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_else(|| "?".into())
        };
        div()
            .size_9()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(10.))
            .bg(bg)
            .text_color(fg)
            .text_sm()
            .font_weight(FontWeight::SEMIBOLD)
            .child(initial)
    });
    v_flex()
        .w(px(RAIL_WIDTH))
        .flex_shrink_0()
        .items_center()
        .gap_2()
        .py_3()
        .children(badge)
        .child(div().mx_2().w_8().border_t_1().border_color(hex(p.border)))
        .child(
            Button::new("view-list")
                .ghost()
                .large()
                .selected(true)
                .icon(Icon::new(IconName::List))
                .tooltip("List view"),
        )
        .child(
            Button::new("view-kanban")
                .ghost()
                .large()
                .disabled(true)
                .icon(Icon::new(IconName::Columns3))
                .tooltip("Kanban view (not in this prototype)"),
        )
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{point, px, AppContext as _, Modifiers, TestAppContext};

    use super::{TuxedoApp, SIDEBAR_TRANSITION};
    use crate::model::tests::{catalogue, A, C};
    use crate::model::SessionModel;

    #[gpui::test]
    fn the_sidebar_ignores_clicks_while_it_slides_closed(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let path = catalogue("inert-sidebar");
        let session = cx.new(|cx| SessionModel::restore_from(Some(path), cx));
        let (app, cx) = cx.add_window_view(|window, cx| {
            crate::theme::init(window, cx);
            TuxedoApp::with_session(session.clone(), window, cx)
        });
        cx.run_until_parked();
        let selected = |cx: &mut gpui::VisualTestContext| {
            session.read_with(cx, |m, _| m.selected().map(|s| s.workspace.id.clone()))
        };
        assert_eq!(selected(cx).as_deref(), Some(A));

        // The toggle's frame starts the transition; later frames sample it at the advanced clock.
        app.update(cx, |app, cx| app.set_sidebar_open(false, cx));
        cx.run_until_parked();
        cx.executor().advance_clock(SIDEBAR_TRANSITION / 4);
        cx.update(|window, _| window.refresh());
        cx.run_until_parked();
        let slot = cx
            .debug_bounds("workspace-sidebar-slot")
            .expect("slot is rendered");
        assert_eq!(slot.size.width, px(192.), "a linear quarter of 256px");

        // A quarter into the slide the row still shows, pinned to the shrinking slot's right edge.
        let row = cx
            .debug_bounds("workspace-row-2")
            .expect("row C is rendered");
        let visible = point(row.right() - px(8.), row.center().y);
        assert!(visible.x > px(0.), "row C is still on screen");
        cx.simulate_click(visible, Modifiers::none());
        cx.run_until_parked();
        assert_eq!(selected(cx).as_deref(), Some(A));

        // Closed, it stays mounted but entirely outside the zero-width slot's clip.
        cx.executor().advance_clock(SIDEBAR_TRANSITION);
        cx.update(|window, _| window.refresh());
        cx.run_until_parked();
        let slot = cx
            .debug_bounds("workspace-sidebar-slot")
            .expect("closed sidebar stays mounted");
        assert_eq!(slot.size.width, px(0.));
        let row = cx
            .debug_bounds("workspace-row-2")
            .expect("row C stays mounted");
        assert!(row.right() <= slot.left(), "row C lies outside the clip");

        // Reopened, the same row responds again.
        app.update(cx, |app, cx| app.set_sidebar_open(true, cx));
        cx.run_until_parked();
        cx.executor()
            .advance_clock(SIDEBAR_TRANSITION + Duration::from_millis(50));
        cx.update(|window, _| window.refresh());
        cx.run_until_parked();
        let row = cx
            .debug_bounds("workspace-row-2")
            .expect("row C is rendered");
        cx.simulate_click(row.center(), Modifiers::none());
        cx.run_until_parked();
        assert_eq!(selected(cx).as_deref(), Some(C));
    }
}
