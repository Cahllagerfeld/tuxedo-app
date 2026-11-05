//! One List-view row, ported from `lib/modules/todo/ui/TodoItem.svelte`.

use gpui_kit::assets::IconName;
use gpui_kit::component::h_flex;
use gpui_kit::component::Icon;
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{DueCategory, TodoDate, TodoItem};

use crate::theme::{hex, Palette, MONO_FONT};

pub const ROW_HEIGHT: f32 = 40.;

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
/// or reopens a completed one.
pub fn render(
    index: usize,
    todo: &TodoItem,
    today: TodoDate,
    on_toggle: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    p: &Palette,
) -> AnyElement {
    let muted_fg = hex(p.muted_foreground);
    let projects = unique(&todo.projects);
    let contexts = unique(&todo.contexts);
    let project_limit = if contexts.is_empty() { 2 } else { 1 };
    let context_limit = if projects.is_empty() { 2 } else { 1 };

    let priority = match todo.priority {
        Some(letter) => {
            let (bg, fg) = p.priority(letter);
            div().bg(bg).text_color(fg).child(format!("({letter})"))
        }
        None => div().text_color(muted_fg).child("—"),
    };

    let tags = h_flex()
        .min_w_0()
        .max_w(relative(0.25))
        .flex_shrink(1.)
        .gap_2()
        .overflow_hidden()
        .font_family(MONO_FONT)
        .text_xs()
        .text_color(muted_fg)
        .child(tag_group(
            "+",
            &projects,
            project_limit,
            Some(hex(p.priority_b)),
            p,
        ))
        .child(tag_group("@", &contexts, context_limit, None, p));

    let category = todo.due_category(today);
    let row_date = if todo.completed {
        todo.completion_date
    } else {
        todo.due_date()
    };
    let date = match row_date {
        Some(date) => {
            let (bg, fg) = match (todo.completed, category) {
                (false, DueCategory::Overdue) => {
                    (hex(p.destructive).opacity(0.1), hex(p.destructive))
                }
                (false, DueCategory::Today) => (hex(p.accent), hex(p.accent_foreground)),
                _ => (gpui_kit::transparent_black(), muted_fg),
            };
            let icon = if todo.completed {
                IconName::Check
            } else {
                IconName::CalendarDays
            };
            h_flex()
                .flex_shrink_0()
                .gap_1()
                .px_1p5()
                .py_0p5()
                .rounded(px(4.))
                .text_xs()
                .bg(bg)
                .text_color(fg)
                .child(Icon::new(icon).size_3())
                .child(date.as_str().to_owned())
                .into_any_element()
        }
        // A malformed due: value gets the warning icon instead of a date.
        None if !todo.completed && category == DueCategory::Invalid => {
            Icon::new(IconName::TriangleAlert)
                .size_3p5()
                .flex_shrink_0()
                .text_color(hex(p.destructive))
                .into_any_element()
        }
        None => div().into_any_element(),
    };

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
        .px_3()
        .border_b_1()
        .border_color(hex(p.border).opacity(0.5))
        .hover(|style| style.bg(hex(p.muted).opacity(0.5)))
        .when(todo.completed, |row| row.text_color(muted_fg))
        .child(checkbox)
        .child(
            priority
                .w_6()
                .flex_shrink_0()
                .flex()
                .justify_center()
                .rounded(px(4.))
                .font_family(MONO_FONT)
                .text_xs(),
        )
        .child(
            div()
                .min_w_16()
                .flex_1()
                .truncate()
                .text_sm()
                .when(todo.completed, |text| text.line_through())
                .child(todo.description.clone()),
        )
        .child(tags)
        .child(date)
        .into_any_element()
}

fn tag_group(
    prefix: &str,
    values: &[&String],
    limit: usize,
    color: Option<Hsla>,
    p: &Palette,
) -> AnyElement {
    if values.is_empty() {
        return div().into_any_element();
    }
    let overflow = values.len().saturating_sub(limit);
    h_flex()
        .min_w_0()
        .gap_1()
        .when_some(color, |group, color| group.text_color(color))
        .children(
            values
                .iter()
                .take(limit)
                .map(|value| div().min_w_0().truncate().child(format!("{prefix}{value}"))),
        )
        .when(overflow > 0, |group| {
            group.child(
                div()
                    .flex_shrink_0()
                    .px_1()
                    .rounded(px(4.))
                    .bg(hex(p.muted))
                    .text_color(hex(p.muted_foreground))
                    .child(format!("+{overflow}")),
            )
        })
        .into_any_element()
}
