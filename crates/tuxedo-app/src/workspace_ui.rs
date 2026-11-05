//! Workspace management dialogs: creating a Workspace and editing one (name, Workspace color, and
//! Workspace replacement through the native file picker), and confirming a Workspace deletion.
//! They open in gpui-kit's window dialog layer; confirming enqueues a Workspace command, whose
//! failure the app shows like every other command outcome.

use std::path::PathBuf;

use gpui_kit::component::button::{Button, ButtonVariant, ButtonVariants};
use gpui_kit::component::dialog::{DialogAction, DialogClose, DialogFooter};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{h_flex, v_flex, WindowExt as _};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{Workspace, WorkspaceChange, WorkspaceColor};

use crate::command_queue::Command;
use crate::model::SessionModel;
use crate::theme::{hex, Palette};
use crate::workspace_commands;

/// Opens the Workspace creation dialog.
pub fn open_create(session: Entity<SessionModel>, window: &mut Window, cx: &mut App) {
    open_form(session, None, window, cx);
}

/// Opens the dialog that renames, recolors, or replaces the Todo file of `workspace`.
pub fn open_edit(
    session: Entity<SessionModel>,
    workspace: &Workspace,
    window: &mut Window,
    cx: &mut App,
) {
    open_form(session, Some(workspace), window, cx);
}

/// Asks before removing `workspace` from the saved Workspaces. Its Todo file is kept.
pub fn open_delete(
    session: Entity<SessionModel>,
    workspace: &Workspace,
    window: &mut Window,
    cx: &mut App,
) {
    let id = workspace.id.clone();
    let description = format!(
        "Remove {} from saved Workspaces? Its Todo file will not be deleted.",
        workspace.name
    );
    window.open_alert_dialog(cx, move |alert, _, _| {
        let session = session.clone();
        let id = id.clone();
        alert
            .title("Remove workspace?")
            .description(description.clone())
            .ok_text("Remove workspace")
            .ok_variant(ButtonVariant::Danger)
            .cancel_text("Cancel")
            .show_cancel(true)
            .on_ok(move |_, _, cx| {
                let command = WorkspaceChange::Delete { id: id.clone() };
                session.update(cx, |model, cx| {
                    model.enqueue(Command::Workspace(command), cx)
                });
                true
            })
    });
}

fn open_form(
    session: Entity<SessionModel>,
    existing: Option<&Workspace>,
    window: &mut Window,
    cx: &mut App,
) {
    let editing = existing.is_some();
    let form = cx.new(|cx| WorkspaceForm::new(session, existing, window, cx));
    form.read(cx)
        .name
        .clone()
        .update(cx, |name, cx| name.focus(window, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        let submit = form.clone();
        dialog
            .title(if editing {
                "Edit workspace"
            } else {
                "Create workspace"
            })
            .w(px(440.))
            .child(form.clone())
            .footer(
                DialogFooter::new()
                    .child(DialogClose::new().trigger(|button| button.label("Cancel")))
                    .child(DialogAction::new().child(
                        Button::new("submit-workspace").primary().label(if editing {
                            "Save workspace"
                        } else {
                            "Create workspace"
                        }),
                    )),
            )
            .on_ok(move |_, _, cx| submit.update(cx, |form, cx| form.submit(cx)))
    });
}

/// The create/edit form's state. The core trims and validates again before saving.
struct WorkspaceForm {
    session: Entity<SessionModel>,
    /// The Workspace being edited; `None` when creating one.
    editing: Option<String>,
    name: Entity<InputState>,
    color: WorkspaceColor,
    todo_file: Option<PathBuf>,
    /// Why the last submission was refused before it reached the queue.
    error: Option<&'static str>,
}

impl WorkspaceForm {
    fn new(
        session: Entity<SessionModel>,
        existing: Option<&Workspace>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let name = existing.map(|w| w.name.clone()).unwrap_or_default();
        Self {
            session,
            editing: existing.map(|w| w.id.clone()),
            name: cx.new(|cx| InputState::new(window, cx).default_value(name)),
            color: existing.map_or(WorkspaceColor::Blue, |w| w.color),
            todo_file: existing.map(|w| w.todo_file.clone()),
            error: None,
        }
    }

    /// Enqueues the command; `false` keeps the dialog open to show what is missing.
    fn submit(&mut self, cx: &mut Context<Self>) -> bool {
        let name = self.name.read(cx).value().trim().to_owned();
        self.error = match (&self.todo_file, name.is_empty()) {
            (_, true) => Some("Enter a workspace name."),
            (None, _) => Some("Choose the exact Todo file for this workspace."),
            _ => None,
        };
        let (Some(todo_file), None) = (self.todo_file.clone(), self.error) else {
            cx.notify();
            return false;
        };
        let command = match self.editing.clone() {
            Some(id) => WorkspaceChange::Update {
                id,
                name,
                color: self.color,
                todo_file,
            },
            None => workspace_commands::create(name, self.color, todo_file),
        };
        self.session.update(cx, |model, cx| {
            model.enqueue(Command::Workspace(command), cx)
        });
        true
    }

    /// The native open panel for one existing Todo file. This app never creates Todo files.
    fn choose_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let chosen = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose".into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(mut paths))) = chosen.await {
                this.update(cx, |form, cx| {
                    form.todo_file = paths.pop();
                    form.error = None;
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }
}

impl Render for WorkspaceForm {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = Palette::current(cx);
        let file = self
            .todo_file
            .as_ref()
            .map(|path| path.display().to_string());
        let swatches = WorkspaceColor::ALL.into_iter().map(|color| {
            let (fill, _) = p.workspace(color);
            let selected = color == self.color;
            div()
                .id(color.as_str())
                .size_6()
                .rounded_full()
                .p(px(2.))
                .border_2()
                .border_color(if selected {
                    hex(p.ring)
                } else {
                    gpui_kit::transparent_black()
                })
                .cursor_pointer()
                .child(div().size_full().rounded_full().bg(fill))
                .tooltip(move |window, cx| {
                    gpui_kit::component::tooltip::Tooltip::new(color_label(color)).build(window, cx)
                })
                .on_click(cx.listener(move |form, _, _, cx| {
                    form.color = color;
                    cx.notify();
                }))
        });
        v_flex()
            .gap_4()
            .text_sm()
            .child(
                div()
                    .text_color(hex(p.muted_foreground))
                    .child(if self.editing.is_some() {
                        "Rename this Workspace, change its color, or point it at another Todo file. The current Todo file is not changed."
                    } else {
                        "Open a Todo file you already use. Give your Workspace a name and color."
                    }),
            )
            .child(field("Workspace name", p).child(Input::new(&self.name)))
            .child(
                field("Todo file", p)
                    .child(
                        Button::new("choose-todo-file")
                            .outline()
                            .label("Open an existing Todo file")
                            .on_click(cx.listener(|form, _, window, cx| {
                                form.choose_file(window, cx)
                            })),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            // Paths matter most at their end: the file name.
                            .text_ellipsis_start()
                            .text_color(hex(p.muted_foreground))
                            .child(file.unwrap_or_else(|| {
                                "Select an existing plain-text file.".into()
                            })),
                    ),
            )
            .child(field("Workspace color", p).child(h_flex().gap_1().children(swatches)))
            .when_some(self.error, |form, error| {
                form.child(div().text_color(hex(p.destructive)).child(error))
            })
    }
}

fn field(label: &'static str, p: &Palette) -> Div {
    v_flex().gap_1p5().child(
        div()
            .font_weight(FontWeight::MEDIUM)
            .text_color(hex(p.foreground))
            .child(label),
    )
}

fn color_label(color: WorkspaceColor) -> &'static str {
    match color {
        WorkspaceColor::Blue => "Blue",
        WorkspaceColor::Green => "Green",
        WorkspaceColor::Amber => "Amber",
        WorkspaceColor::Red => "Red",
        WorkspaceColor::Violet => "Violet",
        WorkspaceColor::Pink => "Pink",
        WorkspaceColor::Cyan => "Cyan",
        WorkspaceColor::Orange => "Orange",
    }
}
