//! List-view filter controls: the toolbar (search, completion view, sort, grouping), the
//! collapsible Facet bar, Due-date group headers, and the no-matches state. Every control
//! reports a [`FilterEdit`]; the owner applies it to its projection.

use std::rc::Rc;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{h_flex, v_flex, Disableable, Icon, Selectable, Sizable};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{CompletionView, DueCategory, DueGroupKind, FacetValue, TodoSortOrder};

use crate::theme::{hex, Palette};
use crate::todo_projection::TodoProjection;
use crate::todo_row::ROW_HEIGHT;

/// One person-initiated change to the List view's projection.
#[derive(Debug, Clone, PartialEq)]
pub enum FilterEdit {
    Completion(CompletionView),
    Search(String),
    Project(String),
    Context(String),
    Priority(char),
    Due(DueCategory),
    Clear,
    Sort(TodoSortOrder),
    Grouped(bool),
    ToggleFacets,
}

/// Applies an edit, from any control's click handler.
pub type OnEdit = Rc<dyn Fn(FilterEdit, &mut Window, &mut App)>;

const TOOLBAR_HEIGHT: f32 = 44.;
/// The due categories in sidebar order; Invalid shows only while some open item has one.
const DUE_CATEGORIES: [DueCategory; 5] = [
    DueCategory::Overdue,
    DueCategory::Today,
    DueCategory::Upcoming,
    DueCategory::None,
    DueCategory::Invalid,
];

pub fn group_label(kind: DueGroupKind) -> &'static str {
    match kind {
        DueGroupKind::Overdue => "Overdue",
        DueGroupKind::Today => "Today",
        DueGroupKind::Upcoming => "Upcoming",
        DueGroupKind::NoDueDate => "No due date",
    }
}

pub fn due_label(category: DueCategory) -> &'static str {
    match category {
        DueCategory::Overdue => "Overdue",
        DueCategory::Today => "Today",
        DueCategory::Upcoming => "Upcoming",
        DueCategory::None => "No due date",
        DueCategory::Invalid => "Invalid due date",
    }
}

fn edit_button(id: impl Into<ElementId>, edit: FilterEdit, on_edit: &OnEdit) -> Button {
    let on_edit = on_edit.clone();
    Button::new(id)
        .ghost()
        .small()
        .on_click(move |_, window, cx| on_edit(edit.clone(), window, cx))
}

/// The toolbar row, followed by the Facet bar while it is open.
pub fn render_toolbar(
    projection: &TodoProjection,
    sort: TodoSortOrder,
    search: &Entity<InputState>,
    facets_open: bool,
    on_edit: &OnEdit,
    p: &Palette,
) -> AnyElement {
    let filters = projection.filters();
    let completion = |id, label, view| {
        edit_button(id, FilterEdit::Completion(view), on_edit)
            .label(label)
            .selected(filters.completion == view)
    };
    let active = [
        filters.project.is_some(),
        filters.context.is_some(),
        filters.priority.is_some(),
        filters.due.is_some(),
    ]
    .into_iter()
    .filter(|set| *set)
    .count();
    let facets_label = match active {
        0 => "Filters".to_owned(),
        n => format!("Filters ({n})"),
    };
    let (sort_label, next_sort) = match sort {
        TodoSortOrder::File => ("Sort: File order", TodoSortOrder::Due),
        TodoSortOrder::Due => ("Sort: Due date", TodoSortOrder::File),
    };
    let toolbar = h_flex()
        .h(px(TOOLBAR_HEIGHT))
        .flex_shrink_0()
        .px_3()
        .gap_1()
        .border_b_1()
        .border_color(hex(p.border))
        .child(
            div().w(px(240.)).flex_shrink_0().child(
                Input::new(search)
                    .small()
                    .cleanable(true)
                    .prefix(Icon::new(IconName::Search).size_3p5()),
            ),
        )
        .child(div().w_2())
        .child(completion("completion-all", "All", CompletionView::All))
        .child(completion("completion-open", "Open", CompletionView::Open))
        .child(completion(
            "completion-completed",
            "Completed",
            CompletionView::Completed,
        ))
        .child(div().flex_1())
        .when(filters.has_filters(), |bar| {
            bar.child(edit_button("clear-filters", FilterEdit::Clear, on_edit).label("Clear"))
        })
        .child(
            edit_button("toggle-facets", FilterEdit::ToggleFacets, on_edit)
                .icon(Icon::new(IconName::ListFilter))
                .label(facets_label)
                .selected(facets_open),
        )
        .child(
            edit_button("sort-order", FilterEdit::Sort(next_sort), on_edit)
                .icon(Icon::new(IconName::ArrowDownUp))
                .label(sort_label)
                .tooltip("Sort Todo items (this session only)"),
        )
        .child(
            edit_button(
                "group-due",
                FilterEdit::Grouped(!projection.grouped()),
                on_edit,
            )
            .icon(Icon::new(IconName::Rows3))
            .label("Group by due")
            .selected(projection.grouped()),
        );
    v_flex()
        .flex_shrink_0()
        .child(toolbar)
        .when(facets_open, |column| {
            column.child(
                div()
                    .border_b_1()
                    .border_color(hex(p.border))
                    .child(render_facets(projection, on_edit, p)),
            )
        })
        .into_any_element()
}

/// The Due-date, Project, Context, and Priority Facets, each a labelled list of toggles with
/// counts. Self-contained, so it can move into the sidebar as in the Electron app.
pub fn render_facets(projection: &TodoProjection, on_edit: &OnEdit, p: &Palette) -> AnyElement {
    let filters = projection.filters();
    let facets = projection.facets();
    let completed_view = filters.completion == CompletionView::Completed;
    let due = DUE_CATEGORIES
        .into_iter()
        .filter(|&c| c != DueCategory::Invalid || (projection.invalid_due() > 0 && !completed_view))
        .map(|category| {
            let label = match category {
                DueCategory::Invalid => {
                    format!("{} {}", due_label(category), projection.invalid_due())
                }
                _ => due_label(category).to_owned(),
            };
            edit_button(
                SharedString::from(format!("facet-due-{category:?}")),
                FilterEdit::Due(category),
                on_edit,
            )
            .label(label)
            .disabled(completed_view)
            .selected(filters.due == Some(category))
            .into_any_element()
        })
        .collect();
    let values = |kind: &'static str,
                  prefix: &'static str,
                  values: &[FacetValue],
                  selected: Option<&str>,
                  edit: fn(&FacetValue) -> FilterEdit| {
        values
            .iter()
            .enumerate()
            .map(|(i, facet)| {
                edit_button(
                    SharedString::from(format!("facet-{kind}-{i}")),
                    edit(facet),
                    on_edit,
                )
                .label(format!("{prefix}{}  {}", facet.value, facet.count))
                .selected(selected == Some(facet.value.as_str()))
                .into_any_element()
            })
            .collect::<Vec<_>>()
    };
    let projects = values(
        "project",
        "+",
        &facets.projects,
        filters.project.as_deref(),
        |f| FilterEdit::Project(f.value.clone()),
    );
    let contexts = values(
        "context",
        "@",
        &facets.contexts,
        filters.context.as_deref(),
        |f| FilterEdit::Context(f.value.clone()),
    );
    let priority = filters.priority.map(|c| c.to_string());
    let priorities = values(
        "priority",
        "",
        &facets.priorities,
        priority.as_deref(),
        |f| FilterEdit::Priority(f.value.chars().next().unwrap_or('A')),
    );
    v_flex()
        .id("facet-bar")
        .max_h(px(180.))
        .overflow_y_scroll()
        .px_3()
        .py_2()
        .gap_1()
        .child(section("Due date", due, None, p))
        .child(section("Projects", projects, Some("No Projects"), p))
        .child(section("Contexts", contexts, Some("No Contexts"), p))
        .child(section(
            "Priorities",
            priorities,
            Some(if completed_view {
                "Not available for completed items"
            } else {
                "No Priorities"
            }),
            p,
        ))
        .into_any_element()
}

fn section(
    label: &'static str,
    values: Vec<AnyElement>,
    empty: Option<&'static str>,
    p: &Palette,
) -> impl IntoElement {
    let muted = hex(p.muted_foreground);
    h_flex()
        .items_start()
        .gap_2()
        .child(
            div()
                .w(px(84.))
                .flex_shrink_0()
                .pt_1()
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .text_color(muted)
                .child(label),
        )
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .flex_wrap()
                .gap_1()
                .when(values.is_empty(), |row| {
                    row.children(empty.map(|e| div().pt_1().text_xs().text_color(muted).child(e)))
                })
                .children(values),
        )
}

/// A Due-date group header: one fixed-height row of the virtualized list.
pub fn render_group_header(kind: DueGroupKind, count: usize, p: &Palette) -> AnyElement {
    h_flex()
        .id(SharedString::from(format!("due-group-{kind:?}")))
        .h(px(ROW_HEIGHT))
        .w_full()
        .px_4()
        .gap_2()
        .items_end()
        .pb_1p5()
        .border_b_1()
        .border_color(hex(p.border))
        .bg(hex(p.muted).opacity(0.4))
        .text_xs()
        .font_weight(FontWeight::SEMIBOLD)
        .child(group_label(kind))
        .child(
            div()
                .text_color(hex(p.muted_foreground))
                .font_weight(FontWeight::NORMAL)
                .child(count.to_string()),
        )
        .into_any_element()
}

/// Shown when the Todo file has items but none are displayed: either every match is deferred,
/// or nothing matches (with Clear filters when a filter narrows the list).
pub fn render_no_matches(projection: &TodoProjection, on_edit: &OnEdit, p: &Palette) -> AnyElement {
    let filters = projection.filters();
    let deferred = projection.deferred();
    let (title, description) = if deferred > 0 {
        let verb = if deferred == 1 {
            "Todo item is"
        } else {
            "Todo items are"
        };
        (
            "Matching Todo items are deferred".to_owned(),
            format!("{deferred} matching {verb} deferred until a future Show from date."),
        )
    } else {
        let status = match filters.completion {
            CompletionView::All => "",
            CompletionView::Open => "open ",
            CompletionView::Completed => "completed ",
        };
        let narrowed = filters.has_filters();
        (
            format!(
                "No {status}items{}.",
                if narrowed { " match these filters" } else { "" }
            ),
            if narrowed {
                "Try clearing a filter to see more Todo items.".to_owned()
            } else {
                "There are no Todo items in this completion view.".to_owned()
            },
        )
    };
    v_flex()
        .flex_1()
        .items_center()
        .justify_center()
        .gap_2()
        .p_6()
        .child(
            Icon::new(IconName::FileText)
                .size_6()
                .text_color(hex(p.muted_foreground)),
        )
        .child(div().text_lg().font_weight(FontWeight::MEDIUM).child(title))
        .child(
            div()
                .text_sm()
                .text_color(hex(p.muted_foreground))
                .child(description),
        )
        .when(deferred == 0 && filters.has_filters(), |column| {
            column.child(
                edit_button("empty-clear-filters", FilterEdit::Clear, on_edit)
                    .outline()
                    .label("Clear filters"),
            )
        })
        .into_any_element()
}
