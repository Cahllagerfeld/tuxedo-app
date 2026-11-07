//! Saved views and Show deferred: the sidebar's "Saved views" section (apply, delete, retry), the
//! Save view dialog, and the List toolbar's Show deferred toggle and Save view action. Saving,
//! deleting, and Show deferred enqueue commands; their failures show like every other outcome.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariant, ButtonVariants};
use gpui_kit::component::dialog::{DialogAction, DialogClose, DialogFooter};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::{h_flex, v_flex, Disableable, Icon, Selectable, Sizable, WindowExt as _};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{js_trim, CompletionView, SavedView, TodoFilters, WorkspaceSnapshot};

use crate::command_queue::Command;
use crate::model::SessionModel;
use crate::saved_view_commands::SavedViewCommand;
use crate::theme::{hex, Palette, MONO_FONT};
use crate::todo_projection::TodoProjection;
use crate::workspace_commands;

/// Replaces the List view's Query with a Saved view's.
pub type OnApply = Rc<dyn Fn(String, &mut Window, &mut App)>;

/// Whether `view` is what the List view applies now: its Query means the current filters.
fn is_applied(view: &SavedView, projection: &TodoProjection) -> bool {
    projection.error().is_none()
        && TodoFilters::parse(&view.query).as_ref() == Ok(projection.filters())
}

/// The sidebar's "Saved views" section for the Active workspace. Rows apply their view while
/// the List view has Todo items to filter.
pub fn render_section(
    session: &Entity<SessionModel>,
    projection: Option<&TodoProjection>,
    on_apply: OnApply,
    p: &Palette,
    cx: &App,
) -> Option<AnyElement> {
    let model = session.read(cx);
    let workspace_id = model.selected()?.workspace.id.clone();
    let views = model.saved_views()?;
    let rows = views
        .for_workspace(&workspace_id)
        .enumerate()
        .map(|(index, view)| {
            let applied = projection.is_some_and(|projection| is_applied(view, projection));
            let on_apply = on_apply.clone();
            let query = view.query.clone();
            h_flex()
                .id(("saved-view", index))
                .h_8()
                .px_2()
                .gap_2()
                .rounded(px(8.))
                .text_sm()
                .when(projection.is_some(), |row| {
                    row.cursor_pointer()
                        .hover(|style| style.bg(hex(p.sidebar_accent)))
                        .on_click(move |_, window, cx| on_apply(query.clone(), window, cx))
                })
                .when(applied, |row| {
                    row.bg(hex(p.sidebar_accent))
                        .text_color(hex(p.sidebar_accent_foreground))
                        .font_weight(FontWeight::MEDIUM)
                })
                .child(
                    Icon::new(IconName::Bookmark)
                        .size_4()
                        .text_color(hex(p.muted_foreground)),
                )
                .child(div().flex_1().min_w_0().truncate().child(view.name.clone()))
                .child(row_menu(index, view, session))
                .into_any_element()
        })
        .collect::<Vec<_>>();
    let empty = rows.is_empty();
    let error = views.error().map(|error| {
        let session = session.clone();
        v_flex()
            .px_2()
            .gap_1()
            .text_xs()
            .child(div().text_color(hex(p.destructive)).child(error.to_owned()))
            .child(
                Button::new("retry-saved-views")
                    .outline()
                    .xsmall()
                    .label("Retry saved views")
                    .on_click(move |_, _, cx| {
                        session.update(cx, |model, cx| {
                            model.enqueue(Command::SavedView(SavedViewCommand::Reload), cx)
                        })
                    }),
            )
    });
    let has_error = error.is_some();
    Some(
        v_flex()
            .gap_0p5()
            .child(
                div()
                    .h_8()
                    .px_2()
                    .flex()
                    .items_center()
                    .text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(hex(p.muted_foreground))
                    .child("Saved views"),
            )
            .children(error)
            .children(rows)
            .when(empty && !has_error, |section| {
                section.child(
                    div()
                        .px_2()
                        .py_1p5()
                        .text_sm()
                        .text_color(hex(p.muted_foreground))
                        .child("No saved views yet."),
                )
            })
            .into_any_element(),
    )
}

/// A Saved view's own options.
fn row_menu(index: usize, view: &SavedView, session: &Entity<SessionModel>) -> impl IntoElement {
    let (session, view) = (session.clone(), view.clone());
    Button::new(("saved-view-options", index))
        .ghost()
        .xsmall()
        .icon(Icon::new(IconName::Ellipsis))
        .tooltip(format!("Options for {}", view.name))
        .dropdown_menu(move |menu, _, _| {
            let (session, view) = (session.clone(), view.clone());
            menu.item(
                PopupMenuItem::new("Delete saved view…")
                    .on_click(move |_, window, cx| open_delete(session.clone(), &view, window, cx)),
            )
        })
}

/// Asks before deleting `view`. Todo files are not touched.
fn open_delete(session: Entity<SessionModel>, view: &SavedView, window: &mut Window, cx: &mut App) {
    let id = view.id.clone();
    let description = format!(
        "Delete the saved view {}? Its Query is not applied anywhere else.",
        view.name
    );
    window.open_alert_dialog(cx, move |alert, _, _| {
        let session = session.clone();
        let id = id.clone();
        alert
            .title("Delete saved view?")
            .description(description.clone())
            .ok_text("Delete saved view")
            .ok_variant(ButtonVariant::Danger)
            .cancel_text("Cancel")
            .show_cancel(true)
            .on_ok(move |_, _, cx| {
                let command = SavedViewCommand::delete(id.clone());
                session.update(cx, |model, cx| {
                    model.enqueue(Command::SavedView(command), cx)
                });
                true
            })
    });
}

/// The List toolbar's Show deferred toggle and Save view action, beside Sort and Group.
pub fn render_toolbar(
    session: Entity<SessionModel>,
    selected: &WorkspaceSnapshot,
    projection: &TodoProjection,
    p: &Palette,
    cx: &App,
) -> impl IntoElement {
    let id = selected.workspace.id.clone();
    let shown = selected.workspace.show_deferred.unwrap_or(false);
    // Deferred Todo items are open ones; the Completed view never shows them.
    let completed = projection.filters().completion == CompletionView::Completed;
    let hidden = projection.deferred();
    let toggle_session = session.clone();
    let deferred = Button::new("show-deferred")
        .ghost()
        .xsmall()
        .icon(Icon::new(IconName::Clock))
        .label("Show deferred")
        .accessibility_label("Show deferred")
        .selected(shown)
        .when(shown, |b| b.bg(hex(p.muted)))
        .disabled(completed)
        .tooltip(if shown {
            "Hide deferred Todo items".to_owned()
        } else {
            format!("Show deferred Todo items ({hidden} hidden)")
        })
        .on_click(move |_, _, cx| {
            let command = workspace_commands::set_show_deferred(id.clone(), !shown);
            toggle_session.update(cx, |model, cx| {
                model.enqueue(Command::Workspace(command), cx)
            });
        });

    let query = projection.query().to_owned();
    let unsaveable = if js_trim(&query).is_empty() {
        Some("Enter a Query to save it as a view")
    } else if projection.error().is_some() {
        Some("Fix the Query before saving it")
    } else if session
        .read(cx)
        .saved_views()
        .is_none_or(|v| v.error().is_some())
    {
        Some("Saved views are unavailable")
    } else {
        None
    };
    let workspace_id = selected.workspace.id.clone();
    let save = Button::new("save-view")
        .ghost()
        .xsmall()
        .icon(Icon::new(IconName::BookmarkPlus))
        .label("Save view…")
        .disabled(unsaveable.is_some())
        .tooltip(unsaveable.unwrap_or("Save the current Query as a view"))
        .on_click(move |_, window, cx| {
            open_save(
                session.clone(),
                workspace_id.clone(),
                query.clone(),
                window,
                cx,
            )
        });
    h_flex().gap_1().flex_shrink_0().child(deferred).child(save)
}

/// Opens the Save view dialog for the current Query.
pub fn open_save(
    session: Entity<SessionModel>,
    workspace_id: String,
    query: String,
    window: &mut Window,
    cx: &mut App,
) {
    let form = cx.new(|cx| SaveViewForm {
        session,
        workspace_id,
        query,
        name: cx.new(|cx| InputState::new(window, cx)),
        error: None,
    });
    let name = form.read(cx).name.clone();
    let initial_focus = Cell::new(true);
    window.open_dialog(cx, move |dialog, window, cx| {
        if initial_focus.replace(false) {
            name.update(cx, |name, cx| name.focus(window, cx));
        }
        let submit = form.clone();
        dialog
            .title("Save view")
            .w(px(440.))
            .child(form.clone())
            .footer(
                DialogFooter::new()
                    .child(DialogClose::new().trigger(|button| button.label("Cancel")))
                    .child(
                        DialogAction::new().child(
                            Button::new("submit-saved-view")
                                .primary()
                                .label("Save view"),
                        ),
                    ),
            )
            .on_ok(move |_, _, cx| submit.update(cx, |form, cx| form.submit(cx)))
    });
}

struct SaveViewForm {
    session: Entity<SessionModel>,
    workspace_id: String,
    query: String,
    name: Entity<InputState>,
    /// Why the last submission was refused before it reached the queue.
    error: Option<&'static str>,
}

impl SaveViewForm {
    /// Enqueues the command; `false` keeps the dialog open to show what is wrong. The core
    /// trims and checks the name again against the file.
    fn submit(&mut self, cx: &mut Context<Self>) -> bool {
        let name = self.name.read(cx).value().to_string();
        let model = self.session.read(cx);
        let taken = |trimmed: &str| {
            let lower = trimmed.to_lowercase();
            model.saved_views().is_some_and(|views| {
                views
                    .for_workspace(&self.workspace_id)
                    .any(|v| v.name.to_lowercase() == lower)
            })
        };
        self.error = match js_trim(&name) {
            "" => Some("Enter a view name."),
            trimmed if taken(trimmed) => {
                Some("A saved view with this name already exists in this Workspace.")
            }
            _ => None,
        };
        if self.error.is_some() {
            cx.notify();
            return false;
        }
        let command = SavedViewCommand::create(self.workspace_id.clone(), name, self.query.clone());
        self.session.update(cx, |model, cx| {
            model.enqueue(Command::SavedView(command), cx)
        });
        true
    }
}

impl Render for SaveViewForm {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = Palette::current(cx);
        v_flex()
            .gap_4()
            .text_sm()
            .child(div().text_color(hex(p.muted_foreground)).child(
                "Save the current Query for this Workspace. Due categories stay relative to today.",
            ))
            .child(
                v_flex()
                    .gap_1p5()
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(hex(p.foreground))
                            .child("View name"),
                    )
                    .child(Input::new(&self.name))
                    .child(
                        div()
                            .text_xs()
                            .text_color(hex(p.muted_foreground))
                            .child("Choose a unique name within this Workspace."),
                    ),
            )
            .child(
                v_flex()
                    .gap_1p5()
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(hex(p.foreground))
                            .child("Query"),
                    )
                    .child(
                        div()
                            .px_2()
                            .py_1p5()
                            .rounded(px(6.))
                            .bg(hex(p.muted))
                            .font_family(MONO_FONT)
                            .text_xs()
                            .child(self.query.clone()),
                    ),
            )
            .when_some(self.error, |form, error| {
                form.child(div().text_color(hex(p.destructive)).child(error))
            })
    }
}

#[cfg(test)]
mod tests {
    // Explicit imports: a glob of gpui would shadow the built-in `#[test]` the macro expands to.
    use gpui::{AppContext as _, TestAppContext};
    use tuxedo_core::TodoDate;

    use crate::command_queue::{Command, OutcomeKind};
    use crate::model::tests::{catalogue, A};
    use crate::model::SessionModel;
    use crate::saved_view_commands::SavedViewCommand;
    use crate::todo_projection::TodoProjection;
    use crate::workspace_commands;

    #[gpui::test]
    fn show_deferred_persists_and_saved_views_run_through_the_queue(cx: &mut TestAppContext) {
        let path = catalogue("show-deferred");
        std::fs::write(
            path.with_file_name("A.txt"),
            "Now\nLater t:2999-01-01\nx Done t:2999-01-01\n",
        )
        .unwrap();
        let today = TodoDate::parse("2026-11-07").unwrap();
        let restore = |cx: &mut TestAppContext| {
            let model = cx.new(|cx| SessionModel::restore_from(Some(path.clone()), cx));
            cx.run_until_parked();
            model
        };
        let shown = |model: &gpui::Entity<SessionModel>, cx: &mut TestAppContext| {
            model.read_with(cx, |m, _| {
                let mut projection = TodoProjection::new(today);
                projection.sync(m.selected(), today);
                (projection.shown(), projection.deferred())
            })
        };
        let model = restore(cx);
        assert_eq!(
            shown(&model, cx),
            (2, 1),
            "the deferred open item is hidden"
        );

        // The toggle's command saves the preference; the projection follows, and so does a
        // restart. Saving a view runs through the same queue.
        let toggle = workspace_commands::set_show_deferred(A.into(), true);
        let save = SavedViewCommand::create(A.into(), "Later".into(), "later".into());
        model.update(cx, |m, cx| {
            m.enqueue(Command::Workspace(toggle), cx);
            m.enqueue(Command::SavedView(save), cx);
        });
        cx.run_until_parked();
        let outcomes = model.update(cx, |m, _| m.take_outcomes());
        assert!(
            outcomes.iter().all(|o| o.kind == OutcomeKind::Applied),
            "{outcomes:?}"
        );
        assert_eq!(shown(&model, cx), (3, 0));
        let model = restore(cx);
        assert_eq!(shown(&model, cx), (3, 0));
        model.read_with(cx, |m, _| {
            let views = m.saved_views().unwrap();
            assert_eq!(
                views
                    .for_workspace(A)
                    .map(|v| v.query.as_str())
                    .collect::<Vec<_>>(),
                ["later"]
            );
        });
    }
}
