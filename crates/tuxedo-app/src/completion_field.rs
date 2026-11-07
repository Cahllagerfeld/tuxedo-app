//! The autocomplete mechanics shared by the Query field, quick add, and the row editor: the
//! highlighted row and dismissal per field, the capture-phase keys that drive an open panel,
//! and the suggestion panel anchored below the field. Each field supplies its own words, what
//! they offer, and how accepting rewrites its text.

use std::ops::Range;
use std::rc::Rc;

use gpui_kit::base::Popup;
use gpui_kit::component::input::{Enter, Escape, IndentInline, MoveDown, MoveUp};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;

use crate::theme::{hex, Palette, MONO_FONT};

/// The most suggestions a panel lists.
pub const MAX_OFFERS: usize = 8;
const PANEL_WIDTH: f32 = 360.;

/// One row of the panel: the word it writes and what it means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub token: String,
    pub detail: String,
}

/// Accepts the offer at an index.
pub type OnAccept = Rc<dyn Fn(usize, &mut Window, &mut App)>;

/// A key an open panel takes before its field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionKey {
    Up,
    Down,
    Accept,
    Close,
}

/// One field's panel state: the highlighted row and the word it belongs to (any other word,
/// such as one the caret moved to, opens with its first row highlighted), and whether Escape
/// closed the panel until the next edit.
#[derive(Debug, Default)]
pub struct Completion {
    highlight: Option<(Range<usize>, usize)>,
    dismissed: bool,
}

impl Completion {
    /// The field's text changed: reopen on the first row.
    pub fn edited(&mut self) {
        self.highlight = None;
        self.dismissed = false;
    }

    pub fn dismissed(&self) -> bool {
        self.dismissed
    }

    /// The highlighted row of the panel open on `word`, offering `len` rows.
    pub fn highlighted(&self, word: &Range<usize>, len: usize) -> usize {
        match &self.highlight {
            Some((at, row)) if at == word => (*row).min(len.saturating_sub(1)),
            _ => 0,
        }
    }

    /// Applies a key to the panel open on `word`; returns the row to accept for Accept.
    pub fn key(&mut self, key: CompletionKey, word: Range<usize>, len: usize) -> Option<usize> {
        let current = self.highlighted(&word, len);
        let next = match key {
            CompletionKey::Up => current.checked_sub(1).unwrap_or(len - 1),
            CompletionKey::Down => (current + 1) % len,
            CompletionKey::Close => {
                self.dismissed = true;
                current
            }
            CompletionKey::Accept => {
                self.highlight = None;
                return Some(current);
            }
        };
        self.highlight = Some((word, next));
        None
    }
}

/// Wraps a field so an open panel sees Up, Down, Enter, Tab, and Escape before the field does.
/// `on_key` returns whether it took the key (the panel was open); otherwise the key goes on.
pub fn capture_keys<V: 'static>(
    element: Div,
    cx: &Context<V>,
    on_key: impl Fn(&mut V, CompletionKey, &mut Window, &mut Context<V>) -> bool + Clone + 'static,
) -> Div {
    let listener = |key: CompletionKey| {
        let on_key = on_key.clone();
        move |view: &mut V, window: &mut Window, cx: &mut Context<V>| {
            if on_key(view, key, window, cx) {
                cx.stop_propagation();
            }
        }
    };
    let (up, down, enter, tab, escape) = (
        listener(CompletionKey::Up),
        listener(CompletionKey::Down),
        listener(CompletionKey::Accept),
        listener(CompletionKey::Accept),
        listener(CompletionKey::Close),
    );
    element
        .capture_action(cx.listener(move |v, _: &MoveUp, w, cx| up(v, w, cx)))
        .capture_action(cx.listener(move |v, _: &MoveDown, w, cx| down(v, w, cx)))
        .capture_action(cx.listener(move |v, _: &Enter, w, cx| enter(v, w, cx)))
        .capture_action(cx.listener(move |v, _: &IndentInline, w, cx| tab(v, w, cx)))
        .capture_action(cx.listener(move |v, _: &Escape, w, cx| escape(v, w, cx)))
}

/// `field` with its suggestion panel anchored below it while `open` holds offers and the
/// highlighted row. The panel follows scrolling and stays inside the window; rows accept on
/// mouse down, before the field loses focus to the click.
pub fn render(
    id: impl Into<ElementId>,
    field: impl IntoElement,
    open: Option<(&[Offer], usize)>,
    on_accept: OnAccept,
    p: &'static Palette,
) -> Popup {
    let id: ElementId = id.into();
    let panel = open.map(|(offers, highlighted)| {
        v_flex()
            .id((id.clone(), "panel"))
            .w(px(PANEL_WIDTH))
            .p_1()
            .rounded(px(8.))
            .border_1()
            .border_color(hex(p.border))
            .bg(hex(p.popover))
            .shadow_lg()
            .children(offers.iter().enumerate().map(|(i, offer)| {
                let on_accept = on_accept.clone();
                let active = i == highlighted;
                h_flex()
                    .id(("completion-offer", i))
                    .h_7()
                    .px_2()
                    .gap_2()
                    .rounded(px(5.))
                    .cursor_pointer()
                    // The keyboard cursor: a primary tint, like a selected List row, since the
                    // neutral `accent` and `muted` barely differ from the panel. Hover would
                    // override it, so only other rows take hover.
                    .when(active, |row| row.bg(hex(p.primary).opacity(0.12)))
                    .when(!active, |row| row.hover(|row| row.bg(hex(p.muted))))
                    .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                        cx.stop_propagation();
                        on_accept(i, window, cx);
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .font_family(MONO_FONT)
                            .text_sm()
                            .child(offer.token.clone()),
                    )
                    .child(
                        div()
                            .flex_shrink_0()
                            .text_xs()
                            .text_color(hex(p.muted_foreground))
                            .child(offer.detail.clone()),
                    )
                    .when(active, |row| {
                        row.child(
                            div()
                                .flex_shrink_0()
                                .text_xs()
                                .text_color(hex(p.primary))
                                .child("↵"),
                        )
                    })
            }))
    });
    Popup::new(id, field)
        .w_full()
        .anchor(Anchor::TopLeft)
        .offset(px(4.))
        .when_some(panel, |popup, panel| popup.content(panel))
}
