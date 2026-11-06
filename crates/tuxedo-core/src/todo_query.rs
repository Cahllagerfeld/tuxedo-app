//! Read-only projections of a Todo file for the List view: Facets, filtering and text search,
//! Due-date sorting, and Due-date grouping. Parity with `todo-filter.svelte.ts`,
//! `todo-filter-facets.ts`, `todo-due.ts`, and `todo-threshold.ts`.
//!
//! Every index addresses `TodoFile::items`, never a physical line. The text query lives in
//! `todo_query::parse`.

mod parse;

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::catalogue::TodoSortOrder;
use crate::date::TodoDate;
use crate::todo::{DueCategory, TodoFile, TodoItem};

pub use parse::{
    QueryError, QueryErrorKind, QueryKey, COMPLETION_VALUES, DUE_VALUES, QUERY_GRAMMAR_VERSION,
};

/// Which completion states the List view shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CompletionView {
    #[default]
    All,
    Open,
    Completed,
}

impl CompletionView {
    fn includes(self, item: &TodoItem) -> bool {
        match self {
            Self::All => true,
            Self::Open => !item.completed,
            Self::Completed => item.completed,
        }
    }
}

/// The List view's filters, written and read as a text query (see [`TodoFilters::parse`]).
/// The default shows everything.
///
/// Every condition ANDs: an item must carry all listed Projects and Contexts and contain every
/// search word. The Completed view ignores the Priority and Due selections (a query cannot
/// combine them), and a Due selection only ever matches open Todo items.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TodoFilters {
    pub completion: CompletionView,
    /// Search words in query order, each matched case-insensitively as a literal substring.
    /// A quoted phrase is one word and may contain whitespace.
    pub search: Vec<String>,
    /// Exact Project names without `+`, sorted by code point and distinct.
    pub projects: Vec<String>,
    /// Exact Context names without `@`, sorted by code point and distinct.
    pub contexts: Vec<String>,
    pub priority: Option<char>,
    pub due: Option<DueCategory>,
}

/// Selections in a query that the current data does not offer, so they match nothing.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AbsentSelections {
    pub projects: Vec<String>,
    pub contexts: Vec<String>,
    pub priority: Option<char>,
}

impl AbsentSelections {
    pub fn is_empty(&self) -> bool {
        self.projects.is_empty() && self.contexts.is_empty() && self.priority.is_none()
    }
}

/// One distinct exact value of a Facet and the number of Todo items carrying it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FacetValue {
    pub value: String,
    pub count: usize,
}

/// The Facets of one completion view, each sorted by the supplied collation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Facets {
    pub projects: Vec<FacetValue>,
    pub contexts: Vec<FacetValue>,
    /// Priorities of open Todo items only, as single-letter strings.
    pub priorities: Vec<FacetValue>,
}

impl Facets {
    fn has(values: &[FacetValue], value: &str) -> bool {
        values.iter().any(|v| v.value == value)
    }
}

/// The List view's Due-date presentation groups, in display order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DueGroupKind {
    Overdue,
    Today,
    Upcoming,
    /// Missing and malformed Due dates.
    NoDueDate,
}

impl DueGroupKind {
    pub const ALL: [Self; 4] = [Self::Overdue, Self::Today, Self::Upcoming, Self::NoDueDate];

    fn of(category: DueCategory) -> Self {
        match category {
            DueCategory::Overdue => Self::Overdue,
            DueCategory::Today => Self::Today,
            DueCategory::Upcoming => Self::Upcoming,
            DueCategory::None | DueCategory::Invalid => Self::NoDueDate,
        }
    }
}

/// A non-empty Due-date group: item indices in their projected order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueGroup {
    pub kind: DueGroupKind,
    pub indices: Vec<usize>,
}

/// Counts each exact Project and Context once per Todo item in `completion`, and Priorities
/// of open Todo items only. Values keep their source spelling; `compare` supplies the locale
/// collation. Values `compare` deems equal keep their first-encounter order.
pub fn todo_facets(
    file: &TodoFile,
    completion: CompletionView,
    mut compare: impl FnMut(&str, &str) -> Ordering,
) -> Facets {
    let mut projects = Counts::default();
    let mut contexts = Counts::default();
    let mut priorities = Counts::default();
    for item in file.items.iter().filter(|item| completion.includes(item)) {
        for (index, value) in item.projects.iter().enumerate() {
            if !item.projects[..index].contains(value) {
                projects.add(value);
            }
        }
        for (index, value) in item.contexts.iter().enumerate() {
            if !item.contexts[..index].contains(value) {
                contexts.add(value);
            }
        }
        if let (false, Some(priority)) = (item.completed, item.priority) {
            priorities.add(&priority.to_string());
        }
    }
    let mut sorted = |counts: Counts| {
        let mut values = counts.values;
        // Stable, so values the collation deems equal keep their first-encounter order.
        values.sort_by(|a, b| compare(&a.value, &b.value));
        values
    };
    Facets {
        projects: sorted(projects),
        contexts: sorted(contexts),
        priorities: sorted(priorities),
    }
}

/// Facet counts in first-encounter order, like the Electron app's insertion-ordered `Map`.
#[derive(Default)]
struct Counts {
    values: Vec<FacetValue>,
    positions: HashMap<String, usize>,
}

impl Counts {
    fn add(&mut self, value: &str) {
        match self.positions.get(value) {
            Some(&position) => self.values[position].count += 1,
            None => {
                self.positions.insert(value.to_owned(), self.values.len());
                self.values.push(FacetValue {
                    value: value.to_owned(),
                    count: 1,
                });
            }
        }
    }
}

/// The displayed Todo items: those matching `filters`, without deferred open items unless
/// `show_deferred`, in file order or by Due date.
///
/// Due order puts valid Due dates first, ascending, then missing and malformed ones; ties keep
/// their physical-line order.
pub fn project_todos(
    file: &TodoFile,
    filters: &TodoFilters,
    today: TodoDate,
    sort: TodoSortOrder,
    show_deferred: bool,
) -> Vec<usize> {
    let terms = filters.search_terms();
    let mut indices: Vec<usize> = file
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            filters.matches_terms(item, &terms, today)
                && (show_deferred || !is_deferred(item, today))
        })
        .map(|(index, _)| index)
        .collect();
    if sort == TodoSortOrder::Due {
        // Stable: `items` are in physical-line order, so ties stay in that order.
        indices.sort_by_key(|&index| {
            let due = file.items[index].due_date();
            (due.is_none(), due)
        });
    }
    indices
}

/// Splits projected `indices` into the non-empty Due-date groups, in [`DueGroupKind::ALL`]
/// order, keeping the projected order within each group.
pub fn group_todos_by_due(file: &TodoFile, indices: &[usize], today: TodoDate) -> Vec<DueGroup> {
    DueGroupKind::ALL
        .into_iter()
        .filter_map(|kind| {
            let indices: Vec<usize> = indices
                .iter()
                .copied()
                .filter(|&index| DueGroupKind::of(file.items[index].due_category(today)) == kind)
                .collect();
            (!indices.is_empty()).then_some(DueGroup { kind, indices })
        })
        .collect()
}

/// Whether an open Todo item's valid Show from date (`t:`) is after `today`.
pub fn is_deferred(item: &TodoItem, today: TodoDate) -> bool {
    !item.completed
        && item
            .metadata_value("t")
            .and_then(TodoDate::parse)
            .is_some_and(|show_from| show_from > today)
}

/// How many matching Todo items are hidden because they are deferred.
pub fn deferred_count(file: &TodoFile, filters: &TodoFilters, today: TodoDate) -> usize {
    let terms = filters.search_terms();
    file.items
        .iter()
        .filter(|item| filters.matches_terms(item, &terms, today) && is_deferred(item, today))
        .count()
}

/// How many open Todo items have a malformed Due date.
pub fn invalid_due_count(file: &TodoFile, today: TodoDate) -> usize {
    file.items
        .iter()
        .filter(|item| !item.completed && item.due_category(today) == DueCategory::Invalid)
        .count()
}

impl TodoFilters {
    /// Whether any narrowing filter is set; the completion view alone does not count.
    pub fn has_filters(&self) -> bool {
        !self.search.is_empty()
            || !self.projects.is_empty()
            || !self.contexts.is_empty()
            || self.priority.is_some()
            || self.due.is_some()
    }

    /// Clears search and every selection, keeping the completion view.
    pub fn clear(&mut self) {
        *self = Self {
            completion: self.completion,
            ..Self::default()
        };
    }

    /// The Projects, Contexts, and Priority this query asks for that `facets` (which must be
    /// this completion view's) do not offer. The query keeps them, as the Electron app keeps
    /// a saved view's absent selections, so they match nothing until the data offers them.
    pub fn absent(&self, facets: &Facets) -> AbsentSelections {
        let missing = |wanted: &[String], offered: &[FacetValue]| {
            wanted
                .iter()
                .filter(|v| !Facets::has(offered, v))
                .cloned()
                .collect()
        };
        let completed_view = self.completion == CompletionView::Completed;
        AbsentSelections {
            projects: missing(&self.projects, &facets.projects),
            contexts: missing(&self.contexts, &facets.contexts),
            priority: self
                .priority
                .filter(|p| !completed_view && !Facets::has(&facets.priorities, &p.to_string())),
        }
    }

    /// Whether `item` matches every filter (Show from dates aside).
    pub fn matches(&self, item: &TodoItem, today: TodoDate) -> bool {
        self.matches_terms(item, &self.search_terms(), today)
    }

    fn search_terms(&self) -> Vec<String> {
        self.search.iter().map(|word| word.to_lowercase()).collect()
    }

    fn matches_terms(&self, item: &TodoItem, terms: &[String], today: TodoDate) -> bool {
        let completed_view = self.completion == CompletionView::Completed;
        if let (false, Some(due)) = (completed_view, self.due) {
            if item.completed || item.due_category(today) != due {
                return false;
            }
        }
        if !self.completion.includes(item) {
            return false;
        }
        if !self.projects.iter().all(|p| item.projects.contains(p))
            || !self.contexts.iter().all(|c| item.contexts.contains(c))
        {
            return false;
        }
        if let (false, Some(priority)) = (completed_view, self.priority) {
            if item.priority != Some(priority) {
                return false;
            }
        }
        terms.is_empty() || {
            let text = search_text(item);
            terms.iter().all(|term| text.contains(term.as_str()))
        }
    }
}

/// The lowercase text search looks in: the description, `+projects`, `@contexts`, and each
/// effective (last-wins) `key:value` metadata pair.
fn search_text(item: &TodoItem) -> String {
    let mut parts = vec![item.description.clone()];
    parts.extend(item.projects.iter().map(|p| format!("+{p}")));
    parts.extend(item.contexts.iter().map(|c| format!("@{c}")));
    let mut seen = Vec::new();
    for (key, _) in &item.metadata {
        if !seen.contains(&key) {
            seen.push(key);
            let value = item.metadata_value(key).unwrap_or_default();
            parts.push(format!("{key}:{value}"));
        }
    }
    parts.join(" ").to_lowercase()
}

/// JavaScript's `\s`, which the Electron app splits search terms on and the query splits
/// words on: Unicode `White_Space` plus U+FEFF, minus U+0085 (NEXT LINE), which Rust's
/// `char::is_whitespace` includes.
fn is_js_whitespace(c: char) -> bool {
    c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}')
}
