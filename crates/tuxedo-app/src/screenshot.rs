//! Dev tool (feature `screenshot`): renders the window offscreen once the session has settled,
//! saves the frame, and quits.
//!
//! `TUXEDO_SCREENSHOT=out.png tuxedo`, optionally with
//! - `TUXEDO_APPEARANCE=light|dark`
//! - `TUXEDO_SELECT=<Workspace name>`: switch Workspaces the way a sidebar click does
//! - `TUXEDO_CLICK=<x>,<y>[;<x>,<y>...]`: left-click those window points in order, after any
//!   `TUXEDO_SELECT`, settling after each click
//! - `TUXEDO_SIDEBAR=hidden`
//! - `TUXEDO_DIALOG=create|edit|delete`: open a Workspace dialog last; `edit` and `delete` act
//!   on the displayed Workspace
//! - `TUXEDO_SCROLL=<px>`: scroll the List view, then hover near the card's top-right corner;
//!   `TUXEDO_SCROLL_AT=<x>,<y>` scrolls and hovers at that window point instead (the sidebar)
//! - `TUXEDO_SIDEBAR_TOGGLE=<ms>`: toggle the sidebar last, then capture <ms> into its
//!   transition (the most recent frame drawn by then)

use std::time::Duration;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;

use crate::app::TuxedoApp;
use crate::workspace_ui;

/// In screenshot mode the window opens far offscreen, as GPUI's visual tests do, so the real
/// pointer and keyboard cannot interfere with the injected state.
pub fn window_bounds(size: Size<Pixels>, cx: &App) -> WindowBounds {
    if std::env::var_os("TUXEDO_SCREENSHOT").is_none() {
        return WindowBounds::centered(size, cx);
    }
    WindowBounds::Windowed(Bounds {
        origin: point(px(-10000.), px(-10000.)),
        size,
    })
}

/// Returns whether screenshot mode is on (the caller then leaves the app inactive).
pub fn schedule(window: AnyWindowHandle, root: Entity<TuxedoApp>, cx: &mut App) -> bool {
    let Some(path) = std::env::var_os("TUXEDO_SCREENSHOT") else {
        return false;
    };
    match std::env::var("TUXEDO_APPEARANCE").as_deref() {
        Ok("dark") => Theme::change(ThemeMode::Dark, None, cx),
        Ok("light") => Theme::change(ThemeMode::Light, None, cx),
        _ => {}
    }
    if std::env::var("TUXEDO_SIDEBAR").as_deref() == Ok("hidden") {
        root.update(cx, |app, cx| app.set_sidebar_open(false, cx));
    }
    cx.spawn(async move |cx| {
        let settle = async |cx: &mut AsyncApp, ms| {
            cx.background_executor()
                .timer(Duration::from_millis(ms))
                .await
        };
        // Session restoration runs on the background executor; give it and a few frames time.
        settle(cx, 1500).await;
        if let Ok(name) = std::env::var("TUXEDO_SELECT") {
            cx.update(|cx| {
                let session = root.read(cx).session().clone();
                session.update(cx, |model, cx| {
                    let id = model
                        .workspaces()
                        .iter()
                        .find(|w| w.name == name)
                        .map(|w| w.id.clone());
                    match id {
                        Some(id) => model.select(&id, cx),
                        None => eprintln!("tuxedo: no Workspace named {name}"),
                    }
                })
            });
            settle(cx, 1000).await;
        }
        for position in clicks() {
            cx.update_window(window, |_, window, cx| {
                let button = MouseButton::Left;
                let modifiers = Modifiers::default();
                window.dispatch_event(
                    PlatformInput::MouseMove(MouseMoveEvent {
                        position,
                        pressed_button: None,
                        modifiers,
                    }),
                    cx,
                );
                window.dispatch_event(
                    PlatformInput::MouseDown(MouseDownEvent {
                        button,
                        position,
                        modifiers,
                        click_count: 1,
                        first_mouse: false,
                    }),
                    cx,
                );
                window.dispatch_event(
                    PlatformInput::MouseUp(MouseUpEvent {
                        button,
                        position,
                        modifiers,
                        click_count: 1,
                    }),
                    cx,
                );
            })
            .ok();
            settle(cx, 1000).await;
        }
        if let Some(offset) = std::env::var("TUXEDO_SCROLL")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
        {
            cx.update_window(window, |_, window, cx| {
                let size = window.viewport_size();
                // Inside the List view, just below the card's top edge, near its right corner.
                let position = std::env::var("TUXEDO_SCROLL_AT")
                    .ok()
                    .and_then(|v| parse_point(&v))
                    .unwrap_or(point(size.width - px(40.), px(52.)));
                let hover = |window: &mut Window, cx: &mut App| {
                    window.dispatch_event(
                        PlatformInput::MouseMove(MouseMoveEvent {
                            position,
                            pressed_button: None,
                            modifiers: Modifiers::default(),
                        }),
                        cx,
                    );
                };
                // GPUI hit-tests a scroll against the pointer, so move there first.
                hover(window, cx);
                window.dispatch_event(
                    PlatformInput::Scroll(ScrollEvent {
                        position,
                        delta: ScrollDelta::Pixels(point(px(0.), px(-offset))),
                        ..Default::default()
                    }),
                    cx,
                );
                hover(window, cx);
            })
            .ok();
            settle(cx, 500).await;
        }
        if let Some(ms) = std::env::var("TUXEDO_SIDEBAR_TOGGLE")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
        {
            cx.update(|cx| {
                root.update(cx, |app, cx| {
                    let open = app.sidebar_open();
                    app.set_sidebar_open(!open, cx);
                })
            });
            settle(cx, ms).await;
        }
        if let Ok(dialog) = std::env::var("TUXEDO_DIALOG") {
            cx.update_window(window, |_, window, cx| {
                let session = root.read(cx).session().clone();
                let shown = session.read(cx).selected().map(|s| s.workspace.clone());
                match (dialog.as_str(), shown) {
                    ("create", _) => workspace_ui::open_create(session, window, cx),
                    ("edit", Some(workspace)) => {
                        workspace_ui::open_edit(session, &workspace, window, cx)
                    }
                    ("delete", Some(workspace)) => {
                        workspace_ui::open_delete(session, &workspace, window, cx)
                    }
                    _ => eprintln!("tuxedo: cannot open the {dialog} dialog"),
                }
            })
            .ok();
            settle(cx, 800).await;
        }
        let result = cx.update_window(window, |_, window, _| window.render_to_image());
        match result {
            Ok(Ok(image)) => match image.save(&path) {
                Ok(()) => eprintln!("tuxedo: saved screenshot to {}", path.to_string_lossy()),
                Err(error) => eprintln!("tuxedo: could not save screenshot: {error}"),
            },
            Ok(Err(error)) | Err(error) => {
                eprintln!("tuxedo: could not render screenshot: {error}")
            }
        }
        cx.update(|cx| cx.quit());
    })
    .detach();
    true
}

/// `TUXEDO_CLICK` window points, in logical pixels.
fn clicks() -> Vec<Point<Pixels>> {
    let Ok(value) = std::env::var("TUXEDO_CLICK") else {
        return Vec::new();
    };
    value.split(';').filter_map(parse_point).collect()
}

/// An `<x>,<y>` window point, in logical pixels.
fn parse_point(pair: &str) -> Option<Point<Pixels>> {
    let (x, y) = pair.split_once(',')?;
    Some(point(
        px(x.trim().parse().ok()?),
        px(y.trim().parse().ok()?),
    ))
}
