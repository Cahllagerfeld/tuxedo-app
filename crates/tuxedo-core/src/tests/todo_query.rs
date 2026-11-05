//! Parity cases from `todo-filter.svelte.spec.ts` and `todo-filter-facets.ts`.

use std::cmp::Ordering;
use std::path::PathBuf;

use crate::*;

fn parse(text: &str) -> TodoFile {
    let file = parse_todo_text(PathBuf::from("/tmp/todo.txt"), text);
    assert_eq!(file.skipped, vec![], "{text:?}");
    file
}

fn day(value: &str) -> TodoDate {
    TodoDate::parse(value).unwrap()
}

/// Physical lines of the projected items, so cases read like the TS `line_number` lists.
fn lines(file: &TodoFile, indices: &[usize]) -> Vec<u32> {
    indices.iter().map(|&i| file.items[i].line_number).collect()
}

fn project(file: &TodoFile, filters: &TodoFilters, today: &str) -> Vec<u32> {
    let indices = project_todos(file, filters, day(today), TodoSortOrder::File, false);
    lines(file, &indices)
}

/// A stand-in collation for determinism: case-insensitive first, then lowercase before
/// uppercase, as ICU orders these ASCII samples.
fn collate(a: &str, b: &str) -> Ordering {
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| b.cmp(a))
}

fn values(facets: &[FacetValue]) -> Vec<(&str, usize)> {
    facets.iter().map(|f| (f.value.as_str(), f.count)).collect()
}

#[test]
fn facets_keep_exact_values_count_once_per_item_and_follow_the_completion_view() {
    let file = parse(
        "(A) Open +Work +Work @Home +work\n\
         (B) Other +Personal @Away\n\
         x (C) 2026-10-09 Legacy completed +Done @Home\n\
         x 2026-10-09 Completed +Work @home\n",
    );
    let all = todo_facets(&file, CompletionView::All, collate);
    assert_eq!(
        values(&all.projects),
        [("Done", 1), ("Personal", 1), ("work", 1), ("Work", 2)]
    );
    assert_eq!(
        values(&all.contexts),
        [("Away", 1), ("home", 1), ("Home", 2)]
    );
    // Priorities come from open items only, never from a legacy completed item.
    assert_eq!(values(&all.priorities), [("A", 1), ("B", 1)]);

    let open = todo_facets(&file, CompletionView::Open, collate);
    assert_eq!(
        values(&open.projects),
        [("Personal", 1), ("work", 1), ("Work", 1)]
    );
    let completed = todo_facets(&file, CompletionView::Completed, collate);
    assert_eq!(values(&completed.projects), [("Done", 1), ("Work", 1)]);
    assert_eq!(values(&completed.priorities), []);

    // The comparator decides the order; the core never sorts lexically on its own.
    let reversed = todo_facets(&file, CompletionView::All, |a, b| collate(b, a));
    assert_eq!(reversed.projects[0].value, "Work");

    // Values the collation deems equal keep their first-encounter order, as in Electron.
    let equal = todo_facets(&file, CompletionView::All, |_, _| Ordering::Equal);
    assert_eq!(
        values(&equal.projects),
        [("Work", 2), ("work", 1), ("Personal", 1), ("Done", 1)]
    );
}

#[test]
fn sorts_due_dates_without_changing_ties_and_puts_missing_and_invalid_last() {
    let file = parse(
        "(A) Open +Work @Home\n\
         (A) Open +Work @Home due:2026-11-01\n\
         x 2026-10-09 Completed +Work @Home due:2026-10-14\n\
         (A) Open +Work @Home due:2026-02-30\n\
         (A) Open +Work @Home due:2026-10-14\n",
    );
    let today = day("2026-10-14");
    let all = TodoFilters::default();
    let sorted = |filters: &TodoFilters, sort| {
        lines(&file, &project_todos(&file, filters, today, sort, false))
    };
    assert_eq!(sorted(&all, TodoSortOrder::File), [1, 2, 3, 4, 5]);
    assert_eq!(sorted(&all, TodoSortOrder::Due), [3, 5, 2, 1, 4]);
    let open = TodoFilters {
        completion: CompletionView::Open,
        ..TodoFilters::default()
    };
    assert_eq!(sorted(&open, TodoSortOrder::Due), [5, 2, 1, 4]);
    assert_eq!(sorted(&open, TodoSortOrder::File), [1, 2, 4, 5]);
}

#[test]
fn search_ands_literal_lowercase_terms_over_description_tokens_and_effective_metadata() {
    let file = parse(
        "(A) Release client [v2] +Work @Home due:2026-01-01 due:2026-10-14\n\
         x 2026-10-09 Client follow-up +Work @Home\n",
    );
    let search = |text: &str| {
        let filters = TodoFilters {
            search: text.into(),
            ..TodoFilters::default()
        };
        project(&file, &filters, "2026-10-14")
    };
    assert_eq!(search("  CLIENT\t release  "), [1]);
    assert_eq!(search("+work @HOME due:2026-10-14 [v2]"), [1]);
    // Only the effective (last) metadata value is searched.
    assert_eq!(search("due:2026-01-01"), Vec::<u32>::new());
    assert_eq!(search("client"), [1, 2]);
    assert_eq!(search("rel.*"), Vec::<u32>::new());
    assert_eq!(search(" \n\t "), [1, 2]);
    // Terms split on JavaScript's `\s`: U+FEFF separates, U+0085 does not.
    for (text, expected) in [
        ("\u{feff}client\u{feff}release\u{feff}", vec![1]),
        ("\u{feff}", vec![1, 2]),
        ("client\u{85}release", vec![]),
    ] {
        assert_eq!(search(text), expected, "{text:?}");
    }
    let blank = TodoFilters {
        search: " \n\t ".into(),
        ..TodoFilters::default()
    };
    assert!(!blank.has_filters());
}

#[test]
fn facet_selections_and_together_and_the_completed_view_ignores_priority_and_due() {
    let file = parse(
        "(A) Open +Work @Home due:2026-10-14\n\
         x 2026-10-09 Completed +Work @Home\n",
    );
    let mut filters = TodoFilters {
        search: "home".into(),
        project: Some("Work".into()),
        context: Some("Home".into()),
        priority: Some('A'),
        due: Some(DueCategory::Today),
        ..TodoFilters::default()
    };
    assert_eq!(project(&file, &filters, "2026-10-14"), [1]);
    filters.completion = CompletionView::Completed;
    assert_eq!(project(&file, &filters, "2026-10-14"), [2]);
    filters.search = "open".into();
    assert_eq!(project(&file, &filters, "2026-10-14"), Vec::<u32>::new());
    filters.clear();
    assert_eq!(filters.completion, CompletionView::Completed);
    assert!(!filters.has_filters());
}

#[test]
fn due_categories_match_open_items_only_and_keep_invalid_distinct() {
    let file = parse(
        "Open due:2026-10-13\n\
         Open due:2026-10-14\n\
         Open due:2026-10-15\n\
         Open due:2026-02-30\n\
         Open\n\
         x Completed due:2026-10-13\n",
    );
    let due = |category, today| {
        let filters = TodoFilters {
            due: Some(category),
            ..TodoFilters::default()
        };
        project(&file, &filters, today)
    };
    assert_eq!(due(DueCategory::Overdue, "2026-10-14"), [1]);
    assert_eq!(due(DueCategory::Today, "2026-10-14"), [2]);
    assert_eq!(due(DueCategory::Today, "2026-10-15"), [3]);
    assert_eq!(due(DueCategory::Upcoming, "2026-10-15"), Vec::<u32>::new());
    assert_eq!(due(DueCategory::None, "2026-10-14"), [5]);
    assert_eq!(due(DueCategory::Invalid, "2026-10-14"), [4]);
    assert_eq!(invalid_due_count(&file, day("2026-10-14")), 1);
    let completed = TodoFilters {
        completion: CompletionView::Completed,
        due: Some(DueCategory::Overdue),
        ..TodoFilters::default()
    };
    assert_eq!(project(&file, &completed, "2026-10-14"), [6]);
}

#[test]
fn reconcile_drops_obsolete_selections_and_a_repaired_invalid_due_filter() {
    let today = day("2026-10-14");
    let file = parse("(A) Open +Work @Home due:broken\nx Done due:broken\n");
    let mut filters = TodoFilters {
        project: Some("Work".into()),
        context: Some("Home".into()),
        priority: Some('A'),
        due: Some(DueCategory::Invalid),
        ..TodoFilters::default()
    };
    let facets =
        |file: &TodoFile, filters: &TodoFilters| todo_facets(file, filters.completion, collate);
    filters.reconcile(&facets(&file, &filters), &file, today);
    assert_eq!(
        filters.due,
        Some(DueCategory::Invalid),
        "still one invalid open item"
    );
    assert_eq!(filters.project.as_deref(), Some("Work"));

    // Same Workspace, new data: the repaired date and vanished values clear their selections.
    let repaired = parse("(B) Open +Other due:2026-10-14\nx Done due:broken\n");
    filters.reconcile(&facets(&repaired, &filters), &repaired, today);
    assert_eq!(filters, TodoFilters::default());

    // Switching to Completed clears Due and Priorities (no open items there).
    let mut filters = TodoFilters {
        priority: Some('A'),
        due: Some(DueCategory::Today),
        project: Some("Work".into()),
        ..TodoFilters::default()
    };
    let file = parse("(A) Open +Work\nx Done +Work\n");
    filters.completion = CompletionView::Completed;
    filters.reconcile(&facets(&file, &filters), &file, today);
    assert_eq!(
        (filters.priority, filters.due, filters.project.as_deref()),
        (None, None, Some("Work"))
    );
}

#[test]
fn hides_only_future_open_show_from_dates_unless_show_deferred() {
    let file = parse(
        "Open t:2026-10-15 due:2026-10-01\n\
         Open t:2026-10-14\n\
         Open t:2026-10-13\n\
         Open t:2026-02-30\n\
         Open t:+2d\n\
         Open\n\
         x Completed t:2026-10-15\n",
    );
    let all = TodoFilters::default();
    let run = |today, sort, show| lines(&file, &project_todos(&file, &all, day(today), sort, show));
    assert_eq!(
        run("2026-10-14", TodoSortOrder::File, false),
        [2, 3, 4, 5, 6, 7]
    );
    assert_eq!(deferred_count(&file, &all, day("2026-10-14")), 1);
    assert_eq!(
        run("2026-10-14", TodoSortOrder::Due, true),
        [1, 2, 3, 4, 5, 6, 7]
    );
    assert_eq!(
        run("2026-10-15", TodoSortOrder::File, false),
        [1, 2, 3, 4, 5, 6, 7]
    );
    let completed = TodoFilters {
        completion: CompletionView::Completed,
        ..TodoFilters::default()
    };
    assert_eq!(deferred_count(&file, &completed, day("2026-10-14")), 0);
}

#[test]
fn deferred_count_applies_every_filter_before_the_show_from_exclusion() {
    let file = parse(
        "(A) Open +Work @Home t:2026-10-16 due:2026-10-13\n\
         (B) Open +Other @Away\n\
         x 2026-10-09 Completed +Work @Home\n",
    );
    let today = day("2026-10-14");
    let filters = TodoFilters {
        completion: CompletionView::Open,
        search: "open".into(),
        project: Some("Work".into()),
        context: Some("Home".into()),
        priority: Some('A'),
        due: Some(DueCategory::Overdue),
    };
    assert_eq!(deferred_count(&file, &filters, today), 1);
    assert_eq!(project(&file, &filters, "2026-10-14"), Vec::<u32>::new());
    let shown = project_todos(&file, &filters, today, TodoSortOrder::File, true);
    assert_eq!(lines(&file, &shown), [1]);
    let mismatches = [
        TodoFilters {
            search: "missing".into(),
            ..filters.clone()
        },
        TodoFilters {
            project: Some("Other".into()),
            ..filters.clone()
        },
        TodoFilters {
            context: Some("Away".into()),
            ..filters.clone()
        },
        TodoFilters {
            priority: Some('B'),
            ..filters.clone()
        },
        TodoFilters {
            due: Some(DueCategory::Today),
            ..filters.clone()
        },
    ];
    for mismatch in mismatches {
        assert_eq!(deferred_count(&file, &mismatch, today), 0, "{mismatch:?}");
    }
}

#[test]
fn groups_projected_items_by_due_in_order_with_malformed_dates_in_no_due_date() {
    let file = parse(
        "Later due:2026-10-20\n\
         Broken due:2026-02-30\n\
         Late due:2026-10-01\n\
         Plain\n\
         Now due:2026-10-14\n\
         x Done late due:2026-10-02\n",
    );
    let today = day("2026-10-14");
    let all = TodoFilters::default();
    let summary = |sort| {
        let indices = project_todos(&file, &all, today, sort, false);
        group_todos_by_due(&file, &indices, today)
            .into_iter()
            .map(|group| (group.kind, lines(&file, &group.indices)))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        summary(TodoSortOrder::File),
        [
            (DueGroupKind::Overdue, vec![3, 6]),
            (DueGroupKind::Today, vec![5]),
            (DueGroupKind::Upcoming, vec![1]),
            (DueGroupKind::NoDueDate, vec![2, 4]),
        ]
    );
    assert_eq!(
        summary(TodoSortOrder::Due)[0],
        (DueGroupKind::Overdue, vec![3, 6])
    );

    // Empty groups are omitted.
    let narrowed = TodoFilters {
        search: "plain".into(),
        ..TodoFilters::default()
    };
    let indices = project_todos(&file, &narrowed, today, TodoSortOrder::File, false);
    let groups = group_todos_by_due(&file, &indices, today);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].kind, DueGroupKind::NoDueDate);
}
