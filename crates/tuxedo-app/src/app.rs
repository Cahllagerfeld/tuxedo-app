//! App shell: window frame, title bar, navigation rail, the content card, and the Workspace
//! sidebar's slot and slide. Mirrors `routes/+layout.svelte`; read-only.
//!
//! Feature areas render through their own modules:
//! - [`sidebar`]: Workspaces list and Overview (the completion-view selector).
//! - [`list_view`]: the main pane (query bar, List view, status bar).

mod list_view;
mod sidebar;

use std::time::Duration;

use gpui_kit::assets::IconName;
use gpui_kit::base::{transition, RoundedFrameCover, Transition};
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::notification::Notification;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::component::{Disableable, Icon, Selectable, Sizable, TitleBar, WindowExt as _};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::WorkspaceSnapshot;

use crate::command_queue::OutcomeKind;
use crate::model::{SessionModel, SessionState};
use crate::theme::{self, hex, Palette};
use crate::todo_commands::local_today;
use list_view::ListView;
use sidebar::WorkspaceSidebar;

const TOOLBAR_HEIGHT: f32 = 40.;
const RAIL_WIDTH: f32 = 56.;
/// The sidebar's open/close slide (Electron's `duration-200 ease-linear`).
const SIDEBAR_TRANSITION: Duration = Duration::from_millis(200);
/// The content card's radius (`rounded-xl`).
const CARD_RADIUS: f32 = 14.;

actions!(tuxedo, [UndoTodo, FocusQuery, Quit]);

/// App-wide key bindings.
pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-z", UndoTodo, None),
        KeyBinding::new("cmd-f", FocusQuery, None),
        KeyBinding::new("cmd-q", Quit, None),
    ]);
}

/// The app menu, whose Quit (Cmd-Q) lets admitted commands finish before the app quits.
pub fn install_menu(root: &Entity<TuxedoApp>, cx: &mut App) {
    let session = root.read(cx).session.clone();
    cx.on_action(move |_: &Quit, cx| session.update(cx, |model, cx| model.request_quit(cx)));
    cx.set_menus(vec![
        Menu::new("Tuxedo").items([MenuItem::action("Quit Tuxedo", Quit)])
    ]);
}

pub struct TuxedoApp {
    /// Focused at startup so app actions (such as Undo) dispatch with nothing else focused.
    focus_handle: FocusHandle,
    session: Entity<SessionModel>,
    sidebar_open: bool,
    sidebar: WorkspaceSidebar,
    list_view: ListView,
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
            cx.observe(&session, |this, _, cx| this.session_changed(cx)),
            cx.observe_in(&session, window, |_, session, window, cx| {
                present_outcomes(&session, window, cx)
            }),
            cx.observe_window_appearance(window, |_, window, cx| theme::init(window, cx)),
        ];
        let model = session.downgrade();
        // Closing waits for admitted commands; `present_outcomes` closes once they finish.
        window.on_window_should_close(cx, move |_, cx| {
            model
                .update(cx, |model, _| model.request_close())
                .unwrap_or(true)
        });
        let focus_handle = cx.focus_handle();
        window.focus(&focus_handle, cx);
        let mut app = Self {
            focus_handle,
            session,
            sidebar_open: true,
            sidebar: WorkspaceSidebar,
            list_view: ListView::new(window, cx),
            _subscriptions: subscriptions,
        };
        app.session_changed(cx);
        app
    }

    /// Runs whenever the session model notifies: accepted data, command outcomes, pending
    /// switches. Recomputes the List view's projection, which clears the query on a
    /// Workspace change, and shows a rewritten query in its field.
    fn session_changed(&mut self, cx: &mut Context<Self>) {
        let selected = self.session.read(cx).selected();
        self.list_view.reproject(selected, local_today());
        self.list_view.sync_query_field(cx);
        cx.notify();
    }

    /// Cmd-F, and screenshot mode's `TUXEDO_FOCUS=query`.
    pub fn focus_query(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.list_view.focus_query(window, cx);
    }

    /// Workspace command UI layered over the window: create/edit/delete dialogs (#258).
    fn render_workspace_ui(&self, _p: &Palette, _cx: &Context<Self>) -> Option<AnyElement> {
        None
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
            if self.sidebar_open {
                sidebar::WIDTH
            } else {
                0.
            },
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
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(|this, _: &UndoTodo, _, cx| {
                this.session.update(cx, |model, cx| model.undo(cx));
            }))
            .on_action(cx.listener(|this, _: &FocusQuery, window, cx| {
                this.focus_query(window, cx);
            }))
            .bg(hex(p.window_background))
            .text_color(hex(p.foreground))
            .font_family(theme::UI_FONT)
            .child(self.render_title_bar(selected.is_some(), model.undo_label(), p, cx))
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
                                            p,
                                            cx,
                                        ))
                                    })
                                    .child(self.list_view.render(&self.session, window, p, cx)),
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
            .children(self.render_workspace_ui(p, cx))
    }
}

impl TuxedoApp {
    fn render_title_bar(
        &self,
        shows_workspace: bool,
        undo_label: Option<&str>,
        p: &Palette,
        cx: &Context<Self>,
    ) -> impl IntoElement {
        let undo_tooltip = format!("{} (⌘Z)", undo_label.unwrap_or("Undo last change"));
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
                        .child(
                            Button::new("undo")
                                .ghost()
                                .small()
                                .icon(Icon::new(IconName::Undo2))
                                .tooltip(undo_tooltip)
                                .disabled(undo_label.is_none())
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.session.update(cx, |model, cx| model.undo(cx));
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
    fn render_sidebar_slot(&self, width: f32, p: &Palette, cx: &Context<Self>) -> impl IntoElement {
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
            .child(self.sidebar.render(
                &self.session,
                self.list_view.projection(self.session.read(cx).selected()),
                p,
                cx,
            ))
            .when(!self.sidebar_open, |slot| {
                slot.child(div().absolute().inset_0().occlude())
            })
    }
}

/// Shows each command outcome the model has not presented yet as a notification, and closes the
/// window once a requested close has waited for the queue to drain.
fn present_outcomes(session: &Entity<SessionModel>, window: &mut Window, cx: &mut App) {
    let (outcomes, close) =
        session.update(cx, |model, _| (model.take_outcomes(), model.close_ready()));
    for outcome in outcomes {
        let message = outcome.message.clone().unwrap_or_default();
        let note = match outcome.kind {
            // The changed row is the outcome; a notice adds to it.
            OutcomeKind::Applied if outcome.message.is_none() => continue,
            OutcomeKind::Applied => Notification::info(message),
            OutcomeKind::Conflict | OutcomeKind::Failed => {
                Notification::error(message).title(outcome.title)
            }
        };
        window.push_notification(note, cx);
    }
    if close {
        window.remove_window();
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{point, px, AppContext as _, Modifiers, TestAppContext};

    use super::{TuxedoApp, SIDEBAR_TRANSITION};
    use crate::model::tests::{catalogue, A, C};
    use crate::model::SessionModel;

    #[gpui::test]
    fn the_autocomplete_popover_takes_keys_only_while_open(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(super::bind_keys);
        let path = catalogue("query-autocomplete");
        std::fs::write(
            path.with_file_name("A.txt"),
            "Plan +Work +Web @home\nOther\n",
        )
        .unwrap();
        let session = cx.new(|cx| SessionModel::restore_from(Some(path), cx));
        let (app, cx) = cx.add_window_view(|window, cx| {
            crate::theme::init(window, cx);
            TuxedoApp::with_session(session.clone(), window, cx)
        });
        cx.run_until_parked();
        let query = |cx: &mut gpui::VisualTestContext| {
            app.read_with(cx, |app, cx| app.list_view.query_text(cx))
        };

        // Cmd-F focuses the field; `+W` offers +Web then +Work; Down and Enter take +Work.
        cx.simulate_keystrokes("cmd-f");
        cx.simulate_input("x +W");
        cx.simulate_keystrokes("down enter");
        cx.run_until_parked();
        assert_eq!(query(cx), "x +Work ");

        // Closed (the caret follows a space): Enter and Down reach the field and change nothing.
        cx.simulate_keystrokes("enter down");
        cx.run_until_parked();
        assert_eq!(query(cx), "x +Work ");

        // Escape closes the popover, so Enter does not accept; typing reopens it for Tab.
        cx.simulate_input("@h");
        cx.simulate_keystrokes("escape enter");
        cx.run_until_parked();
        assert_eq!(query(cx), "x +Work @h");
        cx.simulate_input("o");
        cx.simulate_keystrokes("tab");
        cx.run_until_parked();
        assert_eq!(query(cx), "x +Work @home ");
        app.read_with(cx, |app, cx| {
            let selected = app.session.read(cx).selected();
            let filters = app.list_view.projection(selected).unwrap().filters();
            assert_eq!(
                (filters.projects.as_slice(), filters.contexts.as_slice()),
                (
                    ["Work".to_owned()].as_slice(),
                    ["home".to_owned()].as_slice()
                )
            );
        });
    }

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
