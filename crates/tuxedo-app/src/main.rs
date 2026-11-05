mod app;
mod command_queue;
mod model;
#[cfg(feature = "screenshot")]
mod screenshot;
mod session;
mod theme;
mod todo_commands;
mod todo_row;

use gpui_kit::component::TitleBar;
use gpui_kit::*;

fn main() {
    gpui_kit::application()
        .with_assets(gpui_kit::assets::AllAssets)
        .run(|cx| {
            gpui_kit::init(cx);
            theme::load_fonts(cx);
            let window_size = size(px(1200.), px(780.));
            #[cfg(feature = "screenshot")]
            let bounds = screenshot::window_bounds(window_size, cx);
            #[cfg(not(feature = "screenshot"))]
            let bounds = WindowBounds::centered(window_size, cx);
            let options = WindowOptions {
                window_bounds: Some(bounds),
                window_min_size: Some(size(px(640.), px(400.))),
                ..TitleBar::window_options()
            };
            let (_window, _root) = gpui_kit::open_window(options, cx, |window, cx| {
                theme::init(window, cx);
                cx.new(|cx| app::TuxedoApp::new(window, cx))
            })
            .expect("failed to open the Tuxedo window");
            #[cfg(feature = "screenshot")]
            if screenshot::schedule(_window, _root, cx) {
                return;
            }
            cx.activate(true);
        });
}
