//! One dense List-view row: a priority letter in a coloured gutter, the completion checkbox,
//! the description with its Projects and Contexts as muted inline tokens, and the ISO date
//! right-aligned (the Due date of an open item, `x <Completion date>` of a completed one).

use gpui_kit::assets::IconName;
use gpui_kit::component::h_flex;
use gpui_kit::component::Icon;
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{DueCategory, TodoDate, TodoItem};

use crate::theme::{hex, Palette, MONO_FONT};

pub const ROW_HEIGHT: f32 = 32.;
/// Fits `x 2026-10-14`, so dates line up across rows.
const DATE_WIDTH: f32 = 96.;

fn unique(values: &[String]) -> Vec<&String> {
    let mut seen = Vec::new();
    for value in values {
        if !seen.contains(&value) {
            seen.push(value);
        }
    }
    seen
}

/// `index` is the item's position in the Todo file's items. `on_toggle` completes an open item
/// or reopens a completed one. A `compact` row shows only its first token and how many follow.
pub fn render(
    index: usize,
    todo: &TodoItem,
    today: TodoDate,
    compact: bool,
    on_toggle: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    p: &Palette,
) -> AnyElement {
    let muted_fg = hex(p.muted_foreground);
    let (bar, letter) = match todo.priority {
        Some(letter) => (p.priority(letter).1, letter.to_string()),
        None => (transparent_black(), String::new()),
    };
    let category = todo.due_category(today);
    let date = if todo.completed {
        todo.completion_date
            .map(|date| (format!("x {}", date.as_str()), muted_fg))
    } else {
        todo.due_date().map(|date| {
            let color = match category {
                DueCategory::Overdue => hex(p.destructive),
                DueCategory::Today => hex(p.priority_c),
                _ => muted_fg,
            };
            (date.as_str().to_owned(), color)
        })
    };
    // A malformed due: value shows as `due:?` in place of a date.
    let date = date.or_else(|| {
        (!todo.completed && category == DueCategory::Invalid)
            .then(|| ("due:?".to_owned(), hex(p.destructive)))
    });
    let tokens: Vec<String> = unique(&todo.projects)
        .into_iter()
        .map(|v| format!("+{v}"))
        .chain(unique(&todo.contexts).into_iter().map(|v| format!("@{v}")))
        .collect();
    let shown = if compact { 1 } else { tokens.len() };
    let more = tokens.len().saturating_sub(shown);

    // The completion checkbox: a round mark filled with the completed color.
    let checkbox = div()
        .id(("todo-checkbox", index))
        .when(cfg!(test), |mark| {
            mark.debug_selector(move || format!("todo-checkbox-{index}"))
        })
        .on_click(on_toggle)
        .cursor_pointer()
        .size_4()
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .border_1()
        .border_color(if todo.completed {
            hex(p.completed)
        } else {
            hex(p.input)
        })
        .when(todo.completed, |mark| {
            mark.bg(hex(p.completed))
                .text_color(hex(p.background))
                .child(Icon::new(IconName::Check).size_3())
        });

    h_flex()
        .id(("todo-row", index))
        .h(px(ROW_HEIGHT))
        .w_full()
        .min_w_0()
        .items_center()
        .gap_2()
        .pr_4()
        .border_b_1()
        .border_color(hex(p.border).opacity(0.5))
        .hover(|style| style.bg(hex(p.muted).opacity(0.5)))
        .when(todo.completed, |row| row.text_color(muted_fg))
        .child(div().w(px(3.)).h_full().flex_shrink_0().bg(bar))
        .child(
            div()
                .w_4()
                .flex_shrink_0()
                .font_family(MONO_FONT)
                .text_xs()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(bar)
                .child(letter),
        )
        .child(checkbox)
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .gap_2()
                .overflow_hidden()
                .child(
                    div()
                        .flex_shrink_0()
                        .max_w(relative(if compact { 0.6 } else { 0.75 }))
                        .truncate()
                        .text_sm()
                        .when(todo.completed, |text| text.line_through())
                        .child(todo.description.clone()),
                )
                .child(
                    // Tokens take what the description leaves; the date column clips the rest.
                    h_flex()
                        .flex_1()
                        .min_w_0()
                        .gap_1p5()
                        .overflow_hidden()
                        .font_family(MONO_FONT)
                        .text_xs()
                        .text_color(muted_fg)
                        .children(tokens.into_iter().take(shown).map(|token| {
                            div()
                                .when(compact, |t| t.min_w(px(56.)).truncate())
                                .when(!compact, |t| t.flex_shrink_0())
                                .child(token)
                        }))
                        .when(more > 0, |tokens| {
                            tokens.child(
                                div()
                                    .flex_shrink_0()
                                    .px_1()
                                    .rounded(px(4.))
                                    .bg(hex(p.muted))
                                    .child(format!("+{more}")),
                            )
                        }),
                ),
        )
        .child(
            div()
                .w(px(DATE_WIDTH))
                .flex_shrink_0()
                .flex()
                .justify_end()
                .font_family(MONO_FONT)
                .text_xs()
                .children(date.map(|(label, color)| div().text_color(color).child(label))),
        )
        .into_any_element()
}
