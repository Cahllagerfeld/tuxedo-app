//! Read-only projections of a Todo file for the List view: Facets, filtering and text search,
//! Due-date sorting, and Due-date grouping. Parity with `todo-filter.svelte.ts`,
//! `todo-filter-facets.ts`, `todo-due.ts`, and `todo-threshold.ts`.
//!
//! Every index addresses `TodoFile::items`, never a physical line.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::catalogue::TodoSortOrder;
use crate::date::TodoDate;
use crate::todo::{DueCategory, TodoFile, TodoItem};

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

/// The List view's filters. The default shows everything.
///
/// Selections AND together. The Completed view ignores the Priority and Due selections, and a
/// Due selection only ever matches open Todo items.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TodoFilters {
    pub completion: CompletionView,
    /// Whitespace-separated terms, matched case-insensitively as literal substrings.
    pub search: String,
    pub project: Option<String>,
    pub context: Option<String>,
    pub priority: Option<char>,
    pub due: Option<DueCategory>,
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

    pub fn label(self) -> &'static str {
        match self {
            Self::Overdue => "Overdue",
            Self::Today => "Today",
            Self::Upcoming => "Upcoming",
            Self::NoDueDate => "No due date",
        }
    }

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
/// collation. Values `compare` deems equal keep their code-point order.
pub fn todo_facets(
    file: &TodoFile,
    completion: CompletionView,
    mut compare: impl FnMut(&str, &str) -> Ordering,
) -> Facets {
    let mut projects = BTreeMap::<&str, usize>::new();
    let mut contexts = BTreeMap::<&str, usize>::new();
    let mut priorities = BTreeMap::<String, usize>::new();
    for item in file.items.iter().filter(|item| completion.includes(item)) {
        count_distinct(&mut projects, &item.projects);
        count_distinct(&mut contexts, &item.contexts);
        if let (false, Some(priority)) = (item.completed, item.priority) {
            *priorities.entry(priority.to_string()).or_default() += 1;
        }
    }
    let mut sorted = |counts: Vec<(&str, usize)>| {
        let mut values: Vec<FacetValue> = counts
            .into_iter()
            .map(|(value, count)| FacetValue {
                value: value.to_owned(),
                count,
            })
            .collect();
        values.sort_by(|a, b| compare(&a.value, &b.value));
        values
    };
    Facets {
        projects: sorted(projects.into_iter().collect()),
        contexts: sorted(contexts.into_iter().collect()),
        priorities: sorted(priorities.iter().map(|(v, c)| (v.as_str(), *c)).collect()),
    }
}

fn count_distinct<'a>(counts: &mut BTreeMap<&'a str, usize>, values: &'a [String]) {
    for (index, value) in values.iter().enumerate() {
        if !values[..index].contains(value) {
            *counts.entry(value).or_default() += 1;
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
        !self.search_terms().is_empty()
            || self.project.is_some()
            || self.context.is_some()
            || self.priority.is_some()
            || self.due.is_some()
    }

    /// Clears search and Facet selections, keeping the completion view.
    pub fn clear(&mut self) {
        *self = Self {
            completion: self.completion,
            ..Self::default()
        };
    }

    /// Drops selections the current data no longer offers, after a same-Workspace data change
    /// or a completion-view change: Projects, Contexts, and Priorities absent from `facets`
    /// (which must be this completion view's), any Due selection in the Completed view, and
    /// the Invalid Due selection once no open item has a malformed Due date.
    pub fn reconcile(&mut self, facets: &Facets, file: &TodoFile, today: TodoDate) {
        if self.completion == CompletionView::Completed {
            self.due = None;
        }
        if self.due == Some(DueCategory::Invalid) && invalid_due_count(file, today) == 0 {
            self.due = None;
        }
        if self
            .project
            .as_deref()
            .is_some_and(|v| !Facets::has(&facets.projects, v))
        {
            self.project = None;
        }
        if self
            .context
            .as_deref()
            .is_some_and(|v| !Facets::has(&facets.contexts, v))
        {
            self.context = None;
        }
        if self
            .priority
            .is_some_and(|v| !Facets::has(&facets.priorities, &v.to_string()))
        {
            self.priority = None;
        }
    }

    /// Whether `item` matches every filter (Show from dates aside).
    pub fn matches(&self, item: &TodoItem, today: TodoDate) -> bool {
        self.matches_terms(item, &self.search_terms(), today)
    }

    fn search_terms(&self) -> Vec<String> {
        self.search
            .to_lowercase()
            .split_whitespace()
            .map(str::to_owned)
            .collect()
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
        if let Some(project) = &self.project {
            if !item.projects.contains(project) {
                return false;
            }
        }
        if let Some(context) = &self.context {
            if !item.contexts.contains(context) {
                return false;
            }
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
