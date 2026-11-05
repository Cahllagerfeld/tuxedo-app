//! Design tokens ported from `apps/desktop/src/routes/layout.css`.
//!
//! The oklch values there were converted to sRGB hex once (OKLab → linear sRGB → gamma);
//! the table lives in the slice's `ui-design-notes.md`.

use std::rc::Rc;

use gpui_kit::component::theme::{Theme, ThemeConfig};
use gpui_kit::*;
use tuxedo_core::WorkspaceColor;

pub const UI_FONT: &str = "Figtree";
pub const MONO_FONT: &str = "JetBrains Mono";

/// Embedded fonts (SIL OFL, see `assets/fonts/*-OFL.txt`).
pub fn load_fonts(cx: &mut App) {
    let fonts = vec![
        include_bytes!("../assets/fonts/Figtree-Regular.ttf")
            .as_slice()
            .into(),
        include_bytes!("../assets/fonts/Figtree-Medium.ttf")
            .as_slice()
            .into(),
        include_bytes!("../assets/fonts/Figtree-SemiBold.ttf")
            .as_slice()
            .into(),
        include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf")
            .as_slice()
            .into(),
    ];
    if let Err(error) = cx.text_system().add_fonts(fonts) {
        eprintln!("tuxedo: could not load embedded fonts: {error}");
    }
}

/// Registers the ported light and dark themes and follows the system appearance.
pub fn init(window: &mut Window, cx: &mut App) {
    Theme::update(cx, |theme| {
        theme.light_theme = Rc::new(config("Tuxedo Light", &LIGHT));
        theme.dark_theme = Rc::new(config("Tuxedo Dark", &DARK));
    });
    Theme::sync_system_appearance(Some(window), cx);
}

/// App-specific tokens that have no gpui-component equivalent.
pub struct Palette {
    pub window_background: &'static str,
    pub background: &'static str,
    pub foreground: &'static str,
    pub muted: &'static str,
    pub muted_foreground: &'static str,
    pub accent: &'static str,
    pub accent_foreground: &'static str,
    pub destructive: &'static str,
    pub border: &'static str,
    pub input: &'static str,
    pub ring: &'static str,
    pub sidebar: &'static str,
    pub sidebar_foreground: &'static str,
    pub sidebar_accent: &'static str,
    pub sidebar_accent_foreground: &'static str,
    pub sidebar_border: &'static str,
    pub primary: &'static str,
    pub primary_foreground: &'static str,
    pub popover: &'static str,
    pub priority_a: &'static str,
    pub priority_a_muted: &'static str,
    pub priority_b: &'static str,
    pub priority_b_muted: &'static str,
    pub priority_c: &'static str,
    pub priority_c_muted: &'static str,
    pub completed: &'static str,
    dark: bool,
}

pub const LIGHT: Palette = Palette {
    window_background: "#eeeeee",
    background: "#ffffff",
    foreground: "#0a0a0a",
    muted: "#f5f5f5",
    muted_foreground: "#737373",
    accent: "#f5f5f5",
    accent_foreground: "#171717",
    destructive: "#e7000b",
    border: "#e5e5e5",
    input: "#e5e5e5",
    ring: "#a1a1a1",
    sidebar: "#fafafa",
    sidebar_foreground: "#0a0a0a",
    sidebar_accent: "#f5f5f5",
    sidebar_accent_foreground: "#171717",
    sidebar_border: "#e5e5e5",
    primary: "#171717",
    primary_foreground: "#fafafa",
    popover: "#ffffff",
    priority_a: "#c92f33",
    priority_a_muted: "#ffe7e4",
    priority_b: "#00793d",
    priority_b_muted: "#dcf2e3",
    priority_c: "#036eae",
    priority_c_muted: "#dbeefe",
    completed: "#516a59",
    dark: false,
};

pub const DARK: Palette = Palette {
    window_background: "#242424",
    background: "#0a0a0a",
    foreground: "#fafafa",
    muted: "#262626",
    muted_foreground: "#a1a1a1",
    accent: "#404040",
    accent_foreground: "#fafafa",
    destructive: "#ff6467",
    border: "#ffffff1a",
    input: "#ffffff26",
    ring: "#737373",
    sidebar: "#171717",
    sidebar_foreground: "#fafafa",
    sidebar_accent: "#262626",
    sidebar_accent_foreground: "#fafafa",
    sidebar_border: "#ffffff1a",
    primary: "#e5e5e5",
    primary_foreground: "#171717",
    popover: "#262626",
    priority_a: "#ff847c",
    priority_a_muted: "#47211e",
    priority_b: "#73ce95",
    priority_b_muted: "#143320",
    priority_c: "#72b8f2",
    priority_c_muted: "#142e43",
    completed: "#81b292",
    dark: true,
};

impl Palette {
    pub fn current(cx: &App) -> &'static Palette {
        if Theme::global(cx).is_dark() {
            &DARK
        } else {
            &LIGHT
        }
    }

    /// Workspace color (Tailwind -600 light, -400 dark) and the text color for its badge.
    pub fn workspace(&self, color: WorkspaceColor) -> (Hsla, Hsla) {
        let (light, dark) = match color {
            WorkspaceColor::Blue => ("#155dfc", "#51a2ff"),
            WorkspaceColor::Green => ("#00a63e", "#05df72"),
            WorkspaceColor::Amber => ("#e17100", "#ffb900"),
            WorkspaceColor::Red => ("#e7000b", "#ff6467"),
            WorkspaceColor::Violet => ("#7f22fe", "#a684ff"),
            WorkspaceColor::Pink => ("#e60076", "#fb64b6"),
            WorkspaceColor::Cyan => ("#0092b8", "#00d3f2"),
            WorkspaceColor::Orange => ("#f54900", "#ff8904"),
        };
        let dark_text = self.dark
            || matches!(
                color,
                WorkspaceColor::Green
                    | WorkspaceColor::Amber
                    | WorkspaceColor::Cyan
                    | WorkspaceColor::Orange
            );
        let text = if dark_text { "#020618" } else { "#ffffff" };
        (hex(if self.dark { dark } else { light }), hex(text))
    }

    /// Priority badge colors (background, foreground) matching `TodoItem.svelte`.
    pub fn priority(&self, priority: char) -> (Hsla, Hsla) {
        match priority {
            'A' => (hex(self.priority_a_muted), hex(self.priority_a)),
            'B' => (hex(self.priority_b_muted), hex(self.priority_b)),
            'C' => (hex(self.priority_c_muted), hex(self.priority_c)),
            _ => (hex(self.muted), hex(self.muted_foreground)),
        }
    }
}

/// Parses `#rrggbb` or `#rrggbbaa`.
pub fn hex(value: &str) -> Hsla {
    let digits = value.trim_start_matches('#');
    let parsed = u32::from_str_radix(digits, 16).unwrap_or(0);
    let rgba_value = if digits.len() == 6 {
        (parsed << 8) | 0xff
    } else {
        parsed
    };
    rgba(rgba_value).into()
}

fn config(name: &str, p: &Palette) -> ThemeConfig {
    let value = serde_json::json!({
        "name": name,
        "mode": if p.dark { "dark" } else { "light" },
        "font.family": UI_FONT,
        "font.size": 16.0,
        "mono_font.family": MONO_FONT,
        "mono_font.size": 12.0,
        "radius": 8,
        "radius.lg": 10,
        "shadow": true,
        "colors": {
            "background": p.background,
            "foreground": p.foreground,
            "border": p.border,
            "input.border": p.input,
            "ring": p.ring,
            "muted.background": p.muted,
            "muted.foreground": p.muted_foreground,
            "accent.background": p.accent,
            "accent.foreground": p.accent_foreground,
            "primary.background": p.primary,
            "primary.foreground": p.primary_foreground,
            "secondary.background": p.muted,
            "secondary.foreground": p.accent_foreground,
            "secondary.hover.background": p.accent,
            "danger.background": p.destructive,
            "popover.background": p.popover,
            "popover.foreground": p.foreground,
            "sidebar.background": p.sidebar,
            "sidebar.foreground": p.sidebar_foreground,
            "sidebar.accent.background": p.sidebar_accent,
            "sidebar.accent.foreground": p.sidebar_accent_foreground,
            "sidebar.border": p.sidebar_border,
            "list.background": p.background,
            "list.hover.background": p.muted,
            "list.active.background": p.muted,
            "title_bar.background": p.window_background,
            "title_bar.border": "#00000000",
            "status_bar.background": p.background,
            "status_bar.border": p.border,
            "window.border": p.border,
        }
    });
    serde_json::from_value(value).expect("the ported theme config is valid")
}
