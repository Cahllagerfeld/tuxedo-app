//! The List view's projection state: filter selections, search, sort override, and Due
//! grouping for the selected Workspace, with the displayed rows cached until accepted data,
//! a filter, or the local date changes. The rules themselves live in `tuxedo_core`'s
//! `todo_query`; this module owns only the state and the locale collation.

use std::cmp::Ordering;
use std::rc::Rc;
use std::sync::LazyLock;

use icu_collator::options::CollatorOptions;
use icu_collator::{Collator, CollatorBorrowed};
use tuxedo_core::{
    deferred_count, group_todos_by_due, invalid_due_count, project_todos, todo_facets,
    CompletionView, DueCategory, DueGroupKind, Facets, TodoDate, TodoFilters, TodoSortOrder,
    WorkspaceSnapshot,
};

/// Root-locale collation, as the Electron app's `String.prototype.localeCompare` applies it
/// to Facet values: accents and case are secondary and tertiary differences, lowercase first.
static COLLATOR: LazyLock<CollatorBorrowed<'static>> = LazyLock::new(|| {
    Collator::try_new(Default::default(), CollatorOptions::default())
        .expect("compiled root collation data is always available")
});

/// Locale order for Facet values.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    COLLATOR.compare(a, b)
}

/// One row of the virtualized List view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Row {
    /// A Due-date group header and the number of Todo items under it.
    Header { kind: DueGroupKind, count: usize },
    /// An index into the selected file's `items`.
    Item(usize),
}

pub struct TodoProjection {
    /// The Workspace the selections belong to; another ID resets them.
    workspace_id: Option<String>,
    filters: TodoFilters,
    /// A local sort choice for this session; the Workspace's saved order applies otherwise.
    sort_override: Option<TodoSortOrder>,
    grouped: bool,
    today: TodoDate,
    facets: Facets,
    rows: Rc<[Row]>,
    /// Displayed Todo items (rows without headers).
    shown: usize,
    deferred: usize,
    invalid_due: usize,
}

impl TodoProjection {
    pub fn new(today: TodoDate) -> Self {
        Self {
            workspace_id: None,
            filters: TodoFilters::default(),
            sort_override: None,
            grouped: false,
            today,
            facets: Facets::default(),
            rows: Rc::from([]),
            shown: 0,
            deferred: 0,
            invalid_due: 0,
        }
    }

    /// Recomputes the rows for accepted session data or a new local date. A different
    /// Workspace ID resets every selection, the sort override, and grouping; the same
    /// Workspace keeps them and drops only values its data no longer offers.
    pub fn sync(&mut self, selected: Option<&WorkspaceSnapshot>, today: TodoDate) {
        let id = selected.map(|s| s.workspace.id.as_str());
        if self.workspace_id.as_deref() != id {
            self.workspace_id = id.map(str::to_owned);
            self.reset();
        }
        self.today = today;
        let Some(selected) = selected else {
            self.facets = Facets::default();
            self.rows = Rc::from([]);
            (self.shown, self.deferred, self.invalid_due) = (0, 0, 0);
            return;
        };
        let file = &selected.file;
        self.facets = todo_facets(file, self.filters.completion, locale_compare);
        self.filters.reconcile(&self.facets, file, today);
        let show_deferred = selected.workspace.show_deferred.unwrap_or(false);
        let indices = project_todos(
            file,
            &self.filters,
            today,
            self.sort(selected),
            show_deferred,
        );
        self.shown = indices.len();
        self.rows = if self.grouped {
            group_todos_by_due(file, &indices, today)
                .into_iter()
                .flat_map(|group| {
                    let header = Row::Header {
                        kind: group.kind,
                        count: group.indices.len(),
                    };
                    std::iter::once(header).chain(group.indices.into_iter().map(Row::Item))
                })
                .collect()
        } else {
            indices.into_iter().map(Row::Item).collect()
        };
        self.deferred = if show_deferred {
            0
        } else {
            deferred_count(file, &self.filters, today)
        };
        self.invalid_due = invalid_due_count(file, today);
    }

    fn reset(&mut self) {
        self.filters = TodoFilters::default();
        self.sort_override = None;
        self.grouped = false;
        #[cfg(feature = "screenshot")]
        self.apply_screenshot_preset();
    }

    /// The effective order: the local choice, else the Workspace's saved `sort_order`.
    pub fn sort(&self, selected: &WorkspaceSnapshot) -> TodoSortOrder {
        self.sort_override
            .or(selected.workspace.sort_order)
            .unwrap_or(TodoSortOrder::File)
    }

    pub fn filters(&self) -> &TodoFilters {
        &self.filters
    }

    pub fn facets(&self) -> &Facets {
        &self.facets
    }

    pub fn rows(&self) -> Rc<[Row]> {
        self.rows.clone()
    }

    pub fn shown(&self) -> usize {
        self.shown
    }

    /// Matching open Todo items hidden until their Show from date.
    pub fn deferred(&self) -> usize {
        self.deferred
    }

    /// Open Todo items with a malformed Due date; the Invalid filter only shows when nonzero.
    pub fn invalid_due(&self) -> usize {
        self.invalid_due
    }

    pub fn grouped(&self) -> bool {
        self.grouped
    }

    pub fn today(&self) -> TodoDate {
        self.today
    }

    // Edits below change only the selections; the caller then calls `sync` with the current
    // session data, which also reconciles them.

    pub fn set_completion(&mut self, completion: CompletionView) {
        self.filters.completion = completion;
    }

    pub fn set_search(&mut self, search: String) {
        self.filters.search = search;
    }

    pub fn toggle_project(&mut self, value: &str) {
        toggle(&mut self.filters.project, value.to_owned());
    }

    pub fn toggle_context(&mut self, value: &str) {
        toggle(&mut self.filters.context, value.to_owned());
    }

    /// Ignored in the Completed view, as in the Electron app.
    pub fn toggle_priority(&mut self, value: char) {
        if self.filters.completion != CompletionView::Completed {
            toggle(&mut self.filters.priority, value);
        }
    }

    /// Ignored in the Completed view, as in the Electron app.
    pub fn toggle_due(&mut self, value: DueCategory) {
        if self.filters.completion != CompletionView::Completed {
            toggle(&mut self.filters.due, value);
        }
    }

    /// Clears search and Facet selections; the completion view, sort, and grouping stay.
    pub fn clear(&mut self) {
        self.filters.clear();
    }

    pub fn set_sort(&mut self, sort: TodoSortOrder) {
        self.sort_override = Some(sort);
    }

    pub fn set_grouped(&mut self, grouped: bool) {
        self.grouped = grouped;
    }

    /// `TUXEDO_SEARCH`, `TUXEDO_COMPLETION=open|completed`, `TUXEDO_PROJECT`,
    /// `TUXEDO_CONTEXT`, `TUXEDO_SORT=due|file`, and `TUXEDO_GROUP=due` preselect the
    /// projection of each Workspace the screenshot shows.
    #[cfg(feature = "screenshot")]
    fn apply_screenshot_preset(&mut self) {
        let var = |name| std::env::var(name).ok().filter(|v| !v.is_empty());
        if let Some(search) = var("TUXEDO_SEARCH") {
            self.filters.search = search;
        }
        match var("TUXEDO_COMPLETION").as_deref() {
            Some("open") => self.filters.completion = CompletionView::Open,
            Some("completed") => self.filters.completion = CompletionView::Completed,
            _ => {}
        }
        self.filters.project = var("TUXEDO_PROJECT");
        self.filters.context = var("TUXEDO_CONTEXT");
        match var("TUXEDO_SORT").as_deref() {
            Some("due") => self.sort_override = Some(TodoSortOrder::Due),
            Some("file") => self.sort_override = Some(TodoSortOrder::File),
            _ => {}
        }
        self.grouped = var("TUXEDO_GROUP").as_deref() == Some("due");
    }
}

fn toggle<T: PartialEq>(selection: &mut Option<T>, value: T) {
    *selection = if selection.as_ref() == Some(&value) {
        None
    } else {
        Some(value)
    };
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tuxedo_core::{parse_todo_text, Workspace, WorkspaceColor, WorkspaceSnapshot};

    use super::*;

    fn snapshot(id: &str, text: &str, sort_order: Option<TodoSortOrder>) -> WorkspaceSnapshot {
        let file = parse_todo_text(PathBuf::from("/tmp/todo.txt"), text);
        WorkspaceSnapshot {
            workspace: Workspace {
                id: id.into(),
                name: id.into(),
                todo_file: file.path.clone(),
                color: WorkspaceColor::Blue,
                created_at: "2026-11-05T00:00:00.000Z".into(),
                sort_order,
                show_deferred: None,
            },
            summary: file.summary(),
            file,
        }
    }

    fn today() -> TodoDate {
        TodoDate::parse("2026-10-14").unwrap()
    }

    #[test]
    fn facets_follow_the_electron_locale_order_without_merging_case_or_accents() {
        let work = snapshot(
            "work",
            "Task +zebra +Éclair +eclair +Apple +apple +Zebra +éclair +banana\n",
            None,
        );
        let mut projection = TodoProjection::new(today());
        projection.sync(Some(&work), today());
        let values: Vec<&str> = projection
            .facets()
            .projects
            .iter()
            .map(|f| f.value.as_str())
            .collect();
        // `["zebra","Éclair",…].sort((a, b) => a.localeCompare(b))` in Electron.
        assert_eq!(
            values,
            ["apple", "Apple", "banana", "eclair", "éclair", "Éclair", "zebra", "Zebra"]
        );
    }

    #[test]
    fn selections_survive_same_workspace_updates_and_reset_for_another_workspace() {
        let text = "(A) Open +Work @Home due:2026-10-14\n(B) Other +Home\nx Done +Work\n";
        let work = snapshot("work", text, Some(TodoSortOrder::Due));
        let mut projection = TodoProjection::new(today());
        projection.sync(Some(&work), today());
        projection.set_completion(CompletionView::Open);
        projection.set_search("open".into());
        projection.toggle_project("Work");
        projection.toggle_context("Home");
        projection.set_sort(TodoSortOrder::File);
        projection.set_grouped(true);
        projection.sync(Some(&work), today());
        assert_eq!(
            projection.rows().as_ref(),
            [
                Row::Header {
                    kind: DueGroupKind::Today,
                    count: 1
                },
                Row::Item(0)
            ]
        );

        // Same Workspace, changed file: kept selections stay, the vanished Context is dropped.
        let edited = snapshot(
            "work",
            "(A) Open +Work\nx Done +Work\n",
            Some(TodoSortOrder::Due),
        );
        projection.sync(Some(&edited), today());
        let filters = projection.filters();
        assert_eq!(
            (
                filters.search.as_str(),
                filters.project.as_deref(),
                filters.context.as_deref()
            ),
            ("open", Some("Work"), None)
        );
        assert_eq!(projection.sort(&edited), TodoSortOrder::File);

        // Another Workspace with the same contents: everything resets, its saved order applies.
        let other = snapshot("other", text, Some(TodoSortOrder::Due));
        projection.sync(Some(&other), today());
        assert_eq!(projection.filters(), &TodoFilters::default());
        assert!(!projection.grouped());
        assert_eq!(projection.sort(&other), TodoSortOrder::Due);
        assert_eq!(projection.shown(), 3);
    }
}
