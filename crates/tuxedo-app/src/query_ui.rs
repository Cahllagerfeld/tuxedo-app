//! The List view's query bar: the text-query field with its autocomplete popover and Add
//! filter menu, the inline error hint, the readout of what the query means, and the Sort and
//! Group segments; plus Due-date group headers and the no-matches state.
//! Every control reports a [`FilterEdit`]; the List view applies it to its projection.

use std::ops::Range;
use std::rc::Rc;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::{h_flex, v_flex, Icon, Selectable, Sizable};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use tuxedo_core::{
    CompletionView, DueCategory, DueGroupKind, FacetValue, QueryCondition, QueryError,
    TodoSortOrder, COMPLETION_VALUES, DUE_VALUES,
};

use crate::theme::{hex, Palette, MONO_FONT};
use crate::todo_projection::{PrefixKind, TodoProjection};
use crate::todo_row::ROW_HEIGHT;

/// One person-initiated change to the List view's projection.
#[derive(Debug, Clone, PartialEq)]
pub enum FilterEdit {
    /// Overview: rewrites the query's `is:` word.
    Completion(CompletionView),
    /// Add filter: appends a condition to the query.
    Add(QueryCondition),
    Clear,
    Sort(TodoSortOrder),
    Grouped(bool),
}

/// Applies an edit, from any control's click handler.
pub type OnEdit = Rc<dyn Fn(FilterEdit, &mut Window, &mut App)>;

/// Accepts the autocomplete suggestion at an index.
pub type OnAccept = Rc<dyn Fn(usize, &mut Window, &mut App)>;

pub const PLACEHOLDER: &str = "Search, or filter with +project @context pri:A due:today";
/// The most suggestions the popover lists.
const MAX_SUGGESTIONS: usize = 8;
const POPOVER_WIDTH: f32 = 360.;

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

fn completion_label(view: CompletionView) -> &'static str {
    match view {
        CompletionView::All => "All",
        CompletionView::Open => "Open",
        CompletionView::Completed => "Completed",
    }
}

/// One autocomplete choice: the word it writes and what it means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Suggestion {
    pub token: String,
    pub detail: String,
}

/// The values a query word being typed can complete to: Projects and Contexts (with their
/// counts in this view) after `+` and `@`, the Priorities in this view after `pri:`, the Due
/// categories after `due:`, and the completion views after `is:`. Keys and values match
/// ignoring case, names by prefix; Priority and Due offer nothing in the Completed view.
pub fn suggestions(word: &str, projection: &TodoProjection) -> Vec<Suggestion> {
    let facets = projection.facets();
    let completed_view = projection.filters().completion == CompletionView::Completed;
    let lower = word.to_lowercase();
    let key = |prefix: &str| lower.starts_with(prefix);
    let named = |values: &[FacetValue], noun: &str, condition: fn(String) -> QueryCondition| {
        values
            .iter()
            .map(|f| Suggestion {
                token: condition(f.value.clone()).token(),
                detail: format!("{noun} · {}", f.count),
            })
            .collect::<Vec<_>>()
    };
    let candidates = if word.starts_with('+') {
        named(&facets.projects, "Project", QueryCondition::Project)
    } else if word.starts_with('@') {
        named(&facets.contexts, "Context", QueryCondition::Context)
    } else if key("pri:") && !completed_view {
        facets
            .priorities
            .iter()
            .map(|f| Suggestion {
                token: format!("pri:{}", f.value),
                detail: format!("Priority · {}", f.count),
            })
            .collect()
    } else if key("due:") && !completed_view {
        DUE_VALUES
            .into_iter()
            .filter(|&(_, due)| due != DueCategory::Invalid || projection.invalid_due() > 0)
            .map(|(_, due)| Suggestion {
                token: QueryCondition::Due(due).token(),
                detail: format!("Due · {}", due_label(due)),
            })
            .collect()
    } else if key("is:") {
        COMPLETION_VALUES
            .into_iter()
            .map(|(_, view)| Suggestion {
                token: QueryCondition::Completion(view).token(),
                detail: format!("View · {}", completion_label(view)),
            })
            .collect()
    } else {
        Vec::new()
    };
    candidates
        .into_iter()
        .filter(|s| s.token.to_lowercase().starts_with(&lower))
        .take(MAX_SUGGESTIONS)
        .collect()
}

/// The query field, the Add filter menu, and the autocomplete popover below the field.
/// `popover` is the open popover's suggestions and highlighted row; `on_accept` takes a row.
/// A `compact` pane drops the shortcut hint and the menu button's label.
pub fn render_field_row(
    query: &Entity<InputState>,
    projection: &TodoProjection,
    popover: Option<(&[Suggestion], usize)>,
    on_accept: OnAccept,
    on_edit: &OnEdit,
    compact: bool,
    p: &'static Palette,
) -> Div {
    let dropdown = popover.map(|(offered, highlighted)| {
        deferred(
            v_flex()
                .id("query-suggestions")
                .occlude()
                .absolute()
                .top(px(38.))
                .left_0()
                .w(px(POPOVER_WIDTH))
                .max_w_full()
                .p_1()
                .rounded(px(8.))
                .border_1()
                .border_color(hex(p.border))
                .bg(hex(p.popover))
                .shadow_lg()
                .children(offered.iter().enumerate().map(|(i, s)| {
                    let on_accept = on_accept.clone();
                    let active = i == highlighted;
                    h_flex()
                        .id(("query-suggestion", i))
                        .h_7()
                        .px_2()
                        .gap_2()
                        .rounded(px(5.))
                        .cursor_pointer()
                        .when(active, |row| row.bg(hex(p.muted)))
                        .hover(|row| row.bg(hex(p.muted)))
                        // On mouse down, before the field loses focus to the click.
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
                                .child(s.token.clone()),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_xs()
                                .text_color(hex(p.muted_foreground))
                                .child(s.detail.clone()),
                        )
                        .when(active, |row| {
                            row.child(
                                div()
                                    .flex_shrink_0()
                                    .text_xs()
                                    .text_color(hex(p.muted_foreground))
                                    .child("↵"),
                            )
                        })
                })),
        )
        .with_priority(1)
    });
    h_flex()
        .gap_2()
        .child(
            div()
                .relative()
                .flex_1()
                .min_w_0()
                .child(
                    Input::new(query)
                        .aria_label("Query")
                        .cleanable(true)
                        .prefix(Icon::new(IconName::TextSearch).size_4())
                        .when(!compact, |input| {
                            input.suffix(
                                div()
                                    .text_xs()
                                    .text_color(hex(p.muted_foreground))
                                    .child("⌘F"),
                            )
                        }),
                )
                .children(dropdown),
        )
        .child(add_filter_menu(projection, on_edit, compact))
}

/// A menu of submenus that append a condition, for people who do not know the syntax.
fn add_filter_menu(
    projection: &TodoProjection,
    on_edit: &OnEdit,
    compact: bool,
) -> impl IntoElement {
    let completed_view = projection.filters().completion == CompletionView::Completed;
    let facets = projection.facets();
    let named = |values: &[FacetValue], condition: fn(String) -> QueryCondition| {
        values
            .iter()
            .map(|f| (f.value.clone(), Some(f.count), condition(f.value.clone())))
            .collect::<Vec<_>>()
    };
    let projects = named(&facets.projects, QueryCondition::Project);
    let contexts = named(&facets.contexts, QueryCondition::Context);
    let priorities: Vec<_> = facets
        .priorities
        .iter()
        .filter_map(|f| {
            let letter = f.value.chars().next()?;
            Some((
                f.value.clone(),
                Some(f.count),
                QueryCondition::Priority(letter),
            ))
        })
        .collect();
    let dues: Vec<_> = DUE_VALUES
        .into_iter()
        .filter(|&(_, due)| due != DueCategory::Invalid || projection.invalid_due() > 0)
        .map(|(_, due)| (due_label(due).to_owned(), None, QueryCondition::Due(due)))
        .collect();
    let groups = Rc::new([
        ("Project", "No Projects", projects),
        ("Context", "No Contexts", contexts),
        (
            "Priority",
            if completed_view {
                "Not available for completed items"
            } else {
                "No Priorities"
            },
            if completed_view {
                Vec::new()
            } else {
                priorities
            },
        ),
        (
            "Due",
            "Not available for completed items",
            if completed_view { Vec::new() } else { dues },
        ),
    ]);
    let on_edit = on_edit.clone();
    Button::new("add-filter")
        .outline()
        .icon(Icon::new(IconName::ListFilterPlus))
        .when(!compact, |button| button.label("Add filter"))
        .accessibility_label("Add filter")
        .tooltip("Add a condition to the query")
        .dropdown_menu(move |mut menu, window, cx| {
            for index in 0..groups.len() {
                let (groups, on_edit) = (groups.clone(), on_edit.clone());
                let label = groups[index].0;
                menu = menu.submenu(label, window, cx, move |mut menu, _, _| {
                    let (_, empty, values) = &groups[index];
                    if values.is_empty() {
                        return menu.item(PopupMenuItem::label(*empty));
                    }
                    for (value, count, condition) in values {
                        let (on_edit, condition) = (on_edit.clone(), condition.clone());
                        let label = match count {
                            Some(count) => format!("{value}  ({count})"),
                            None => value.clone(),
                        };
                        menu =
                            menu.item(PopupMenuItem::new(label).on_click(move |_, window, cx| {
                                on_edit(FilterEdit::Add(condition.clone()), window, cx)
                            }));
                    }
                    menu.scrollable(true).max_h(px(320.))
                });
            }
            menu
        })
}

/// The inline hint for an invalid query: the message, then the query with the offending
/// span highlighted.
pub fn render_error(query: &str, error: &QueryError, p: &Palette) -> impl IntoElement {
    let span = clamp_span(query, error.span.clone());
    let highlight = HighlightStyle {
        color: Some(hex(p.destructive)),
        background_color: Some(hex(p.destructive).opacity(0.12)),
        underline: Some(UnderlineStyle {
            thickness: px(1.),
            color: Some(hex(p.destructive)),
            wavy: true,
        }),
        ..Default::default()
    };
    // An empty span (never produced today) would highlight nothing; show a caret instead.
    let (text, span) = if span.is_empty() {
        let mut text = query.to_owned();
        text.insert(span.start, '‸');
        (text, span.start..span.start + '‸'.len_utf8())
    } else {
        (query.to_owned(), span)
    };
    h_flex()
        .id("query-error")
        .min_w_0()
        .gap_2()
        .text_xs()
        .child(
            Icon::new(IconName::TriangleAlert)
                .size_3p5()
                .flex_shrink_0()
                .text_color(hex(p.destructive)),
        )
        .child(
            div()
                .flex_shrink_0()
                .text_color(hex(p.destructive))
                .child(error.to_string()),
        )
        .child(
            div()
                .min_w_0()
                .truncate()
                .font_family(MONO_FONT)
                .text_color(hex(p.muted_foreground))
                .child(StyledText::new(text).with_highlights([(span, highlight)])),
        )
}

/// `span` limited to `text` and widened to character boundaries.
fn clamp_span(text: &str, span: Range<usize>) -> Range<usize> {
    let mut start = span.start.min(text.len());
    let mut end = span.end.clamp(start, text.len());
    while !text.is_char_boundary(start) {
        start -= 1;
    }
    while !text.is_char_boundary(end) {
        end += 1;
    }
    start..end
}

/// The words of the readout: one `(kind, value, absent)` per condition: Projects, Contexts,
/// Priority, Due, search words, then the word being typed as a prefix (`Project Tu…`).
pub fn readout_parts(projection: &TodoProjection) -> Vec<(&'static str, String, bool)> {
    let filters = projection.filters();
    let absent = projection.absent();
    let mut parts = Vec::new();
    for project in &filters.projects {
        parts.push((
            "Project",
            project.clone(),
            absent.projects.contains(project),
        ));
    }
    for context in &filters.contexts {
        parts.push((
            "Context",
            context.clone(),
            absent.contexts.contains(context),
        ));
    }
    if let Some(priority) = filters.priority {
        parts.push(("Priority", priority.to_string(), absent.priority.is_some()));
    }
    if let Some(due) = filters.due {
        parts.push(("Due", due_label(due).to_owned(), false));
    }
    for word in &filters.search {
        parts.push(("Text", format!("\u{201c}{word}\u{201d}"), false));
    }
    if let Some(prefix) = projection.prefix().filter(|p| !p.typed.is_empty()) {
        let kind = match prefix.kind {
            PrefixKind::Project => "Project",
            PrefixKind::Context => "Context",
            PrefixKind::Priority => "Priority",
            PrefixKind::Due => "Due",
            PrefixKind::Completion => "View",
        };
        parts.push((kind, format!("{}\u{2026}", prefix.typed), false));
    }
    parts
}

/// What the query means and what it shows, the stale hint while the query is invalid, and
/// the Sort, Group, and Clear controls on the right. Empty on the left without filters.
pub fn render_readout_row(
    projection: &TodoProjection,
    sort: TodoSortOrder,
    on_edit: &OnEdit,
    p: &'static Palette,
) -> impl IntoElement {
    let muted = hex(p.muted_foreground);
    let stale = projection.error().is_some();
    let narrowed = projection.narrowed();
    let chip = |kind: &'static str, value: String, absent: bool| {
        h_flex()
            .gap_1()
            .px_1p5()
            .rounded(px(4.))
            .bg(hex(p.muted))
            .child(div().text_color(muted).child(kind))
            .child(
                div()
                    .font_weight(FontWeight::MEDIUM)
                    .when(absent, |v| v.text_color(hex(p.destructive)))
                    .child(value),
            )
            .when(absent, |c| {
                c.child(
                    div()
                        .text_color(hex(p.destructive))
                        .child("not in this view"),
                )
            })
    };
    let mut counts = Vec::new();
    if narrowed || stale {
        counts.push(format!("{} shown", projection.shown()));
        if projection.deferred() > 0 {
            counts.push(format!("{} deferred", projection.deferred()));
        }
    }
    let readout = h_flex()
        .id("query-readout")
        .flex_1()
        .min_w(px(200.))
        .flex_wrap()
        .gap_1p5()
        .text_xs()
        .when(stale, |r| {
            r.child(
                div()
                    .text_color(hex(p.destructive))
                    .child("Stale: showing the last valid query"),
            )
        })
        .when(narrowed, |r| {
            r.children(
                readout_parts(projection)
                    .into_iter()
                    .map(|(kind, value, absent)| chip(kind, value, absent)),
            )
        })
        .when(!counts.is_empty(), |r| {
            r.child(div().text_color(muted).child(counts.join(" · ")))
        });
    let clear = (!projection.query().is_empty()).then(|| {
        let on_edit = on_edit.clone();
        Button::new("clear-query")
            .ghost()
            .xsmall()
            .label("Clear")
            .tooltip("Clear the query")
            .on_click(move |_, window, cx| on_edit(FilterEdit::Clear, window, cx))
    });
    h_flex()
        .flex_wrap()
        .gap_x_3()
        .gap_y_1()
        .child(readout)
        .child(
            h_flex()
                .ml_auto()
                .gap_3()
                .children(clear)
                .child(segment(
                    "sort",
                    "Sort",
                    [
                        (
                            "File",
                            sort == TodoSortOrder::File,
                            FilterEdit::Sort(TodoSortOrder::File),
                        ),
                        (
                            "Due",
                            sort == TodoSortOrder::Due,
                            FilterEdit::Sort(TodoSortOrder::Due),
                        ),
                    ],
                    on_edit,
                    p,
                ))
                .child(segment(
                    "group",
                    "Group",
                    [
                        ("None", !projection.grouped(), FilterEdit::Grouped(false)),
                        ("Due", projection.grouped(), FilterEdit::Grouped(true)),
                    ],
                    on_edit,
                    p,
                )),
        )
}

/// A labeled two-option segmented control.
fn segment(
    id: &'static str,
    label: &'static str,
    options: [(&'static str, bool, FilterEdit); 2],
    on_edit: &OnEdit,
    p: &'static Palette,
) -> impl IntoElement {
    h_flex()
        .gap_1()
        .child(
            div()
                .text_xs()
                .text_color(hex(p.muted_foreground))
                .child(label),
        )
        .child(
            h_flex()
                .p_0p5()
                .gap_0p5()
                .rounded(px(7.))
                .bg(hex(p.muted))
                .children(options.into_iter().map(|(name, on, edit)| {
                    let on_edit = on_edit.clone();
                    Button::new(SharedString::from(format!("{id}-{}", name.to_lowercase())))
                        .ghost()
                        .xsmall()
                        .label(name)
                        .accessibility_label(format!("{label}: {name}"))
                        .selected(on)
                        .when(on, |b| b.bg(hex(p.background)).shadow_xs())
                        .on_click(move |_, window, cx| on_edit(edit.clone(), window, cx))
                })),
        )
}

/// A compact Due-date group header: one fixed-height row of the virtualized list.
pub fn render_group_header(kind: DueGroupKind, count: usize, p: &Palette) -> AnyElement {
    h_flex()
        .id(SharedString::from(format!("due-group-{kind:?}")))
        .h(px(ROW_HEIGHT))
        .w_full()
        .px_4()
        .gap_2()
        .border_b_1()
        .border_color(hex(p.border))
        .bg(hex(p.muted).opacity(0.6))
        .font_family(MONO_FONT)
        .text_xs()
        .child(
            div()
                .font_weight(FontWeight::SEMIBOLD)
                .child(group_label(kind).to_uppercase()),
        )
        .child(
            div()
                .text_color(hex(p.muted_foreground))
                .child(format!("({count})")),
        )
        .into_any_element()
}

/// Shown when the Todo file has items but none are displayed: either every match is deferred,
/// or nothing matches (with Clear query when the query narrows the list).
pub fn render_no_matches(projection: &TodoProjection, on_edit: &OnEdit, p: &Palette) -> AnyElement {
    let filters = projection.filters();
    let deferred = projection.deferred();
    let narrowed = projection.narrowed();
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
        (
            format!(
                "No {status}items{}.",
                if narrowed { " match this query" } else { "" }
            ),
            if narrowed {
                "Try removing a condition to see more Todo items.".to_owned()
            } else {
                "There are no Todo items in this completion view.".to_owned()
            },
        )
    };
    let on_edit = on_edit.clone();
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
        .when(deferred == 0 && narrowed, |column| {
            column.child(
                Button::new("empty-clear-query")
                    .outline()
                    .small()
                    .label("Clear query")
                    .on_click(move |_, window, cx| on_edit(FilterEdit::Clear, window, cx)),
            )
        })
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tuxedo_core::{parse_todo_text, TodoDate, Workspace, WorkspaceColor, WorkspaceSnapshot};

    // Explicit imports: a glob of gpui would shadow the built-in `#[test]`.
    use super::{suggestions, TodoProjection};

    #[test]
    fn suggestions_complete_the_word_from_this_views_values_and_fixed_vocabularies() {
        let file = parse_todo_text(
            PathBuf::from("/tmp/todo.txt"),
            "(A) a +Work +Web @home due:2026-02-30\n(B) b +work\nx c +Done @home\n",
        );
        let selected = WorkspaceSnapshot {
            workspace: Workspace {
                id: "w".into(),
                name: "w".into(),
                todo_file: file.path.clone(),
                color: WorkspaceColor::Blue,
                created_at: "2026-11-06T00:00:00.000Z".into(),
                sort_order: None,
                show_deferred: None,
            },
            summary: file.summary(),
            file,
        };
        let today = TodoDate::parse("2026-11-06").unwrap();
        let mut projection = TodoProjection::new(today);
        projection.sync(Some(&selected), today);
        let tokens = |projection: &TodoProjection, word| -> Vec<String> {
            suggestions(word, projection)
                .into_iter()
                .map(|s| s.token)
                .collect()
        };
        assert_eq!(tokens(&projection, "+w"), ["+Web", "+work", "+Work"]);
        assert_eq!(suggestions("+Work", &projection)[0].detail, "Project · 1");
        assert_eq!(tokens(&projection, "@"), ["@home"]);
        assert_eq!(tokens(&projection, "PRI:"), ["pri:A", "pri:B"]);
        assert_eq!(tokens(&projection, "due:in"), ["due:invalid"]);
        assert_eq!(tokens(&projection, "is:c"), ["is:completed"]);
        assert_eq!(tokens(&projection, "work"), Vec::<String>::new());

        // The Completed view offers its own Projects and no Priority or Due values.
        projection.set_query("is:completed".into());
        projection.sync(Some(&selected), today);
        assert_eq!(tokens(&projection, "+"), ["+Done"]);
        assert_eq!(tokens(&projection, "pri:"), Vec::<String>::new());
        assert_eq!(tokens(&projection, "due:"), Vec::<String>::new());
    }
}
