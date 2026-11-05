//! Dev tool (feature `screenshot`): `TUXEDO_SCREENSHOT=out.png [TUXEDO_APPEARANCE=light|dark] tuxedo`
//! [TUXEDO_SELECT=<Workspace name>] renders the window offscreen once the session has settled, saves the frame, and quits.

use std::time::Duration;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;

use crate::model::SessionModel;

pub fn schedule(window: AnyWindowHandle, session: Entity<SessionModel>, cx: &mut App) {
    let Some(path) = std::env::var_os("TUXEDO_SCREENSHOT") else {
        return;
    };
    match std::env::var("TUXEDO_APPEARANCE").as_deref() {
        Ok("dark") => Theme::change(ThemeMode::Dark, None, cx),
        Ok("light") => Theme::change(ThemeMode::Light, None, cx),
        _ => {}
    }
    cx.spawn(async move |cx| {
        // Session restoration runs on the background executor; give it and a few frames time.
        cx.background_executor()
            .timer(Duration::from_millis(1500))
            .await;
        // Switch the way a sidebar click does, then let the background load land.
        if let Ok(name) = std::env::var("TUXEDO_SELECT") {
            cx.update(|cx| {
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
            cx.background_executor()
                .timer(Duration::from_millis(1000))
                .await;
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
}
