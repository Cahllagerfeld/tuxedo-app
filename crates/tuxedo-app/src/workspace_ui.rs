//! Workspace management dialogs: creating a Workspace and editing one (name, Workspace color, and
//! Workspace replacement through the native file picker), and confirming a Workspace deletion.
//! They open in gpui-kit's window dialog layer; confirming enqueues a Workspace command, whose
//! failure the app shows like every other command outcome.

use std::cell::Cell;
use std::path::PathBuf;

use gpui_kit::component::button::{Button, ButtonVariant, ButtonVariants};
use gpui_kit::component::dialog::{DialogAction, DialogClose, DialogFooter};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{h_flex, v_flex, WindowExt as _};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{js_trim, Workspace, WorkspaceChange, WorkspaceColor};

use crate::command_queue::Command;
use crate::model::SessionModel;
use crate::theme::{hex, Palette};
use crate::workspace_commands::{self, WorkspaceCommand};

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
    let name = form.read(cx).name.clone();
    // `open_dialog` focuses the dialog shell; focus the name once, on the first build only.
    let initial_focus = Cell::new(true);
    window.open_dialog(cx, move |dialog, window, cx| {
        if initial_focus.replace(false) {
            name.update(cx, |name, cx| name.focus(window, cx));
        }
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
        let name = self.name.read(cx).value().to_string();
        let todo_file = self.todo_file.clone();
        match form_command(self.editing.clone(), name, self.color, todo_file) {
            Ok(command) => {
                self.error = None;
                self.session.update(cx, |model, cx| {
                    model.enqueue(Command::Workspace(command), cx)
                });
                true
            }
            Err(error) => {
                self.error = Some(error);
                cx.notify();
                false
            }
        }
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
            // A ghost Button keeps focus, keyboard activation, and the label; the swatch is a child,
            // since a custom variant tints its fill.
            Button::new(color.as_str())
                .ghost()
                .p(px(2.))
                .size_6()
                .rounded(px(999.))
                .border_2()
                .border_color(if selected {
                    hex(p.ring)
                } else {
                    hex(p.background)
                })
                .child(div().size_full().rounded_full().bg(fill))
                .accessibility_label(color_label(color))
                .toggled(selected)
                .tooltip(color_label(color))
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

/// The command a submitted form issues. The name is passed as typed: the core trims it with
/// JavaScript's whitespace rules, which keep characters such as U+0085 that Rust's `trim` drops.
fn form_command(
    editing: Option<String>,
    name: String,
    color: WorkspaceColor,
    todo_file: Option<PathBuf>,
) -> Result<WorkspaceCommand, &'static str> {
    if js_trim(&name).is_empty() {
        return Err("Enter a workspace name.");
    }
    let todo_file = todo_file.ok_or("Choose the exact Todo file for this workspace.")?;
    Ok(match editing {
        Some(id) => WorkspaceChange::Update {
            id,
            name,
            color,
            todo_file,
        },
        None => workspace_commands::create(name, color, todo_file),
    })
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

#[cfg(test)]
mod tests {
    use tuxedo_core::{load_catalogue, WorkspaceColor, WorkspaceSession};

    use super::form_command;
    use crate::model::tests::{catalogue, A};

    #[test]
    fn editing_only_the_color_keeps_a_name_javascript_does_not_trim() {
        let path = catalogue("form-name");
        let mut session = WorkspaceSession::new(load_catalogue(&path).unwrap());
        session.open(A).unwrap();
        let mut save = |name: &str, color| {
            let a = session.catalogue().workspace(A).unwrap().clone();
            let command = form_command(Some(A.into()), name.into(), color, Some(a.todo_file))?;
            let result = session
                .prepare_workspace_change(&path, command)
                .unwrap()
                .execute();
            session.accept_workspace_change(result.unwrap()).unwrap();
            Ok::<_, &str>(session.catalogue().workspace(A).unwrap().name.clone())
        };
        // Electron can save this name; changing only the color must not rename it.
        assert_eq!(
            save("\u{85}Home", WorkspaceColor::Blue),
            Ok("\u{85}Home".into())
        );
        assert_eq!(
            save("\u{85}Home", WorkspaceColor::Green),
            Ok("\u{85}Home".into())
        );
        assert_eq!(
            save(" \u{feff}", WorkspaceColor::Green),
            Err("Enter a workspace name.")
        );
        assert!(matches!(
            form_command(None, "Home".into(), WorkspaceColor::Blue, None),
            Err("Choose the exact Todo file for this workspace.")
        ));
    }
}
