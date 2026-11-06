//! List-view filter controls: the toolbar (search, completion view, sort, grouping), the
//! sidebar's collapsible Facet sections, Due-date group headers, and the no-matches state.
//! Every control reports a [`FilterEdit`]; the List view applies it to its projection.

use std::rc::Rc;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::collapsible::Collapsible;
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
}

/// Applies an edit, from any control's click handler.
pub type OnEdit = Rc<dyn Fn(FilterEdit, &mut Window, &mut App)>;

/// One line of controls; a narrow pane wraps them onto more lines.
const TOOLBAR_MIN_HEIGHT: f32 = 44.;
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

/// The toolbar row above the list; the Facets live in the sidebar.
pub fn render_toolbar(
    projection: &TodoProjection,
    sort: TodoSortOrder,
    search: &Entity<InputState>,
    on_edit: &OnEdit,
    p: &Palette,
) -> AnyElement {
    let filters = projection.filters();
    let completion = |id, label, view| {
        edit_button(id, FilterEdit::Completion(view), on_edit)
            .label(label)
            .selected(filters.completion == view)
    };
    let (sort_label, next_sort) = match sort {
        TodoSortOrder::File => ("Sort: File order", TodoSortOrder::Due),
        TodoSortOrder::Due => ("Sort: Due date", TodoSortOrder::File),
    };
    // Two groups that wrap onto further lines in a narrow pane instead of being clipped.
    let view = h_flex()
        .flex_wrap()
        .gap_1()
        .child(
            div().w(px(240.)).min_w(px(160.)).child(
                Input::new(search)
                    .small()
                    .cleanable(true)
                    .prefix(Icon::new(IconName::Search).size_3p5()),
            ),
        )
        .child(completion("completion-all", "All", CompletionView::All))
        .child(completion("completion-open", "Open", CompletionView::Open))
        .child(completion(
            "completion-completed",
            "Completed",
            CompletionView::Completed,
        ));
    let arrange = h_flex()
        .flex_wrap()
        .justify_end()
        .gap_1()
        .ml_auto()
        .when(filters.has_filters(), |bar| {
            bar.child(edit_button("clear-filters", FilterEdit::Clear, on_edit).label("Clear"))
        })
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
    h_flex()
        .flex_wrap()
        .min_h(px(TOOLBAR_MIN_HEIGHT))
        .flex_shrink_0()
        .px_3()
        .py_1p5()
        .gap_x_3()
        .gap_y_1()
        .border_b_1()
        .border_color(hex(p.border))
        .child(view)
        .child(arrange)
        .into_any_element()
}

/// One collapsible Facet section of the sidebar, in display order; `as usize` indexes the
/// sections' open flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FacetSection {
    Due,
    Projects,
    Contexts,
    Priorities,
}

impl FacetSection {
    fn label(self) -> &'static str {
        match self {
            Self::Due => "Due date",
            Self::Projects => "Projects",
            Self::Contexts => "Contexts",
            Self::Priorities => "Priorities",
        }
    }

    /// Names one value of the section for assistive technology.
    fn singular(self) -> &'static str {
        match self {
            Self::Due => "Due date",
            Self::Projects => "Project",
            Self::Contexts => "Context",
            Self::Priorities => "Priority",
        }
    }
}

/// Expands or collapses a sidebar Facet section, or shows more or fewer of its values.
pub type OnToggleSection = Rc<dyn Fn(FacetSection, &mut Window, &mut App)>;

/// How many Project or Context values a section shows before "Show more".
const COLLAPSED_FACETS: usize = 5;

/// Electron's `FacetFilter` rule: unless `expanded`, the first five values in Facet order plus
/// the selected value wherever it is. Returns each shown value with its Facet index, and how
/// many values stay hidden.
pub fn visible_facets<'a>(
    values: &'a [FacetValue],
    selected: Option<&str>,
    expanded: bool,
) -> (Vec<(usize, &'a FacetValue)>, usize) {
    let shown: Vec<_> = values
        .iter()
        .enumerate()
        .filter(|(i, facet)| {
            expanded || *i < COLLAPSED_FACETS || selected == Some(facet.value.as_str())
        })
        .collect();
    let hidden = values.len() - shown.len();
    (shown, hidden)
}

/// The sidebar's Facet sections' UI state, each indexed by `FacetSection as usize`: `open`
/// shows a section's rows; `expanded` shows all of a Project or Context section's values.
#[derive(Debug, Clone, Copy)]
pub struct FacetSectionsState {
    pub open: [bool; 4],
    pub expanded: [bool; 4],
}

/// The Due-date, Project, Context, and Priority Facets as collapsible sidebar sections, each a
/// vertical list of toggles. A collapsed section builds no rows; Projects and Contexts show
/// five values plus the selected one until expanded, and are left out while they have none.
pub fn render_facet_sections(
    projection: &TodoProjection,
    state: FacetSectionsState,
    on_toggle: &OnToggleSection,
    on_expand: &OnToggleSection,
    on_edit: &OnEdit,
    p: &Palette,
) -> AnyElement {
    let filters = projection.filters();
    let facets = projection.facets();
    let completed_view = filters.completion == CompletionView::Completed;
    let is_open = |section: FacetSection| state.open[section as usize];
    let due = DUE_CATEGORIES
        .into_iter()
        .filter(|_| is_open(FacetSection::Due))
        .filter(|&c| c != DueCategory::Invalid || (projection.invalid_due() > 0 && !completed_view))
        .map(|category| {
            let count = (category == DueCategory::Invalid).then(|| projection.invalid_due());
            facet_button(
                SharedString::from(format!("facet-due-{category:?}")),
                due_label(category).into(),
                "Due date",
                count,
                filters.due == Some(category),
                false,
                FilterEdit::Due(category),
                on_edit,
                p,
            )
            .disabled(completed_view)
            .into_any_element()
        })
        .collect();
    // Projects and Contexts: absent without values; selected rows carry a check, not a count.
    let named = |section: FacetSection,
                 kind: &'static str,
                 prefix: &'static str,
                 values: &[FacetValue],
                 selected: Option<&str>,
                 edit: fn(&FacetValue) -> FilterEdit| {
        if values.is_empty() {
            return None;
        }
        if !is_open(section) {
            return Some((section, Vec::new(), None));
        }
        let expanded = state.expanded[section as usize];
        let (shown, hidden) = visible_facets(values, selected, expanded);
        let mut rows: Vec<AnyElement> = shown
            .into_iter()
            .map(|(i, facet)| {
                facet_button(
                    SharedString::from(format!("facet-{kind}-{i}")),
                    format!("{prefix}{}", facet.value).into(),
                    section.singular(),
                    Some(facet.count),
                    selected == Some(facet.value.as_str()),
                    true,
                    edit(facet),
                    on_edit,
                    p,
                )
                .into_any_element()
            })
            .collect();
        if hidden > 0 || expanded {
            rows.push(show_more_button(section, expanded, hidden, on_expand, p).into_any_element());
        }
        Some((section, rows, None))
    };
    let projects = named(
        FacetSection::Projects,
        "project",
        "+",
        &facets.projects,
        filters.project.as_deref(),
        |f| FilterEdit::Project(f.value.clone()),
    );
    let contexts = named(
        FacetSection::Contexts,
        "context",
        "@",
        &facets.contexts,
        filters.context.as_deref(),
        |f| FilterEdit::Context(f.value.clone()),
    );
    let priority = filters.priority.map(|c| c.to_string());
    let priorities = if is_open(FacetSection::Priorities) {
        &facets.priorities[..]
    } else {
        &[]
    }
    .iter()
    .enumerate()
    .map(|(i, facet)| {
        facet_button(
            SharedString::from(format!("facet-priority-{i}")),
            facet.value.clone().into(),
            FacetSection::Priorities.singular(),
            Some(facet.count),
            priority.as_deref() == Some(facet.value.as_str()),
            false,
            FilterEdit::Priority(facet.value.chars().next().unwrap_or('A')),
            on_edit,
            p,
        )
        .into_any_element()
    })
    .collect();
    let sections = [
        Some((FacetSection::Due, due, None)),
        projects,
        contexts,
        Some((
            FacetSection::Priorities,
            priorities,
            Some(if completed_view {
                "Not available for completed items"
            } else {
                "No Priorities"
            }),
        )),
    ];
    v_flex()
        .gap_1()
        .children(
            sections.into_iter().flatten().map(|(kind, values, empty)| {
                section(kind, is_open(kind), values, empty, on_toggle, p)
            }),
        )
        .into_any_element()
}

/// Electron's small muted "Show N more" / "Show less" ghost button below a section's values.
fn show_more_button(
    section: FacetSection,
    expanded: bool,
    hidden: usize,
    on_expand: &OnToggleSection,
    p: &Palette,
) -> impl IntoElement {
    let on_expand = on_expand.clone();
    let label = section.label();
    h_flex().mt_1().child(
        Button::new(SharedString::from(format!("facet-show-more-{section:?}")))
            .ghost()
            .small()
            .px_2()
            .accessibility_label(if expanded {
                format!("Show fewer {label}")
            } else {
                format!("Show more {label}")
            })
            .on_click(move |_, window, cx| on_expand(section, window, cx))
            .child(
                div()
                    .text_xs()
                    .text_color(hex(p.muted_foreground))
                    .child(if expanded {
                        "Show less".to_owned()
                    } else {
                        format!("Show {hidden} more")
                    }),
            ),
    )
}

/// A full-width ghost toggle: the value on the left, its count right-aligned and muted. With
/// `check`, a selected toggle shows a check mark in place of its count.
/// The Button centers its content, so one flexible row child carries the alignment.
#[allow(clippy::too_many_arguments)]
fn facet_button(
    id: SharedString,
    value: SharedString,
    kind: &'static str,
    count: Option<usize>,
    selected: bool,
    check: bool,
    edit: FilterEdit,
    on_edit: &OnEdit,
    p: &Palette,
) -> Button {
    let on_edit = on_edit.clone();
    Button::new(id)
        .ghost()
        .w_full()
        .px_2()
        .accessibility_label(match count {
            Some(1) => format!("{kind} {value}, 1 item"),
            Some(n) => format!("{kind} {value}, {n} items"),
            None => format!("{kind} {value}"),
        })
        .tooltip(value.clone())
        .selected(selected)
        .toggled(selected)
        .on_click(move |_, window, cx| on_edit(edit.clone(), window, cx))
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .gap_2()
                .child(div().flex_1().min_w_0().truncate().child(value))
                .children(count.filter(|_| !(check && selected)).map(|count| {
                    div()
                        .flex_shrink_0()
                        .text_xs()
                        .text_color(hex(p.muted_foreground))
                        .child(count.to_string())
                }))
                .when(check && selected, |row| {
                    row.child(Icon::new(IconName::Check).size_4().flex_shrink_0())
                }),
        )
}

fn section(
    kind: FacetSection,
    open: bool,
    values: Vec<AnyElement>,
    empty: Option<&'static str>,
    on_toggle: &OnToggleSection,
    p: &Palette,
) -> impl IntoElement {
    let muted = hex(p.muted_foreground);
    let on_toggle = on_toggle.clone();
    let label = kind.label();
    // Button has no expanded state for assistive technology; pressed carries open/closed.
    let header = Button::new(SharedString::from(format!("facet-section-{kind:?}")))
        .ghost()
        .w_full()
        .h_7()
        .px_2()
        .accessibility_label(label)
        .toggled(open)
        .on_click(move |_, window, cx| on_toggle(kind, window, cx))
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .justify_between()
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .text_color(muted)
                .child(label)
                .child(
                    Icon::new(if open {
                        IconName::ChevronDown
                    } else {
                        IconName::ChevronRight
                    })
                    .size_3p5(),
                ),
        );
    let list = v_flex()
        .gap_0p5()
        .when(values.is_empty(), |list| {
            list.children(empty.map(|e| div().px_2().py_1().text_xs().text_color(muted).child(e)))
        })
        .children(values);
    Collapsible::new()
        .open(open)
        .gap_0p5()
        .child(header)
        .content(list)
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

#[cfg(test)]
mod tests {
    use tuxedo_core::FacetValue;

    use super::visible_facets;

    #[test]
    fn collapsed_facets_show_the_first_five_and_the_selected_value() {
        let values: Vec<FacetValue> = ["a", "b", "c", "d", "e", "f", "g", "h"]
            .into_iter()
            .map(|value| FacetValue {
                value: value.into(),
                count: 1,
            })
            .collect();
        let indices = |shown: Vec<(usize, &FacetValue)>| -> Vec<usize> {
            shown.into_iter().map(|(i, _)| i).collect()
        };

        let (shown, hidden) = visible_facets(&values, Some("g"), false);
        assert_eq!((indices(shown), hidden), (vec![0, 1, 2, 3, 4, 6], 2));

        let (shown, hidden) = visible_facets(&values, Some("g"), true);
        assert_eq!((indices(shown), hidden), ((0..8).collect(), 0));

        let (shown, hidden) = visible_facets(&values[..5], None, false);
        assert_eq!((indices(shown), hidden), ((0..5).collect(), 0));
    }
}
