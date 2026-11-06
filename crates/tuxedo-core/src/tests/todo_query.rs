//! Parity cases from `todo-filter.svelte.spec.ts` and `todo-filter-facets.ts`, plus the text
//! query grammar.

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

fn query(text: &str) -> TodoFilters {
    TodoFilters::parse(text).unwrap_or_else(|error| panic!("{text:?}: {error}"))
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
    let search = |text: &str| project(&file, &query(text), "2026-10-14");
    assert_eq!(search("  CLIENT\t release  "), [1]);
    assert_eq!(search(r#""+work" "@HOME" "due:2026-10-14" [v2]"#), [1]);
    // A quoted phrase is one contiguous substring, which may cross joined fields.
    assert_eq!(search(r#""v2] +work""#), [1]);
    assert_eq!(
        search(r#""release [v2]" "client release""#),
        Vec::<u32>::new()
    );
    // Only the effective (last) metadata value is searched.
    assert_eq!(search(r#""due:2026-01-01""#), Vec::<u32>::new());
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
    assert!(!query(" \n\t ").has_filters());
}

#[test]
fn every_condition_ands_including_several_projects_and_contexts() {
    let file = parse(
        "(A) Both +Work +Home @office @phone due:2026-10-14\n\
         (A) Work only +Work @office @phone\n\
         (B) Both lower +Work +home @office\n\
         x 2026-10-09 Completed both +Work +Home @office\n",
    );
    let run = |text: &str| project(&file, &query(text), "2026-10-14");
    assert_eq!(run("+Work"), [1, 2, 3, 4]);
    // An item must carry every listed Project and Context, spelled exactly.
    assert_eq!(run("+Work +Home"), [1, 4]);
    assert_eq!(run("+Home +Work +Home @office"), [1, 4]);
    assert_eq!(run("+Work @office @phone"), [1, 2]);
    assert_eq!(run("+Work +Home @phone pri:A due:today both"), [1]);
    assert_eq!(run("is:open +Work +Home"), [1]);
    assert_eq!(run("is:completed +Work +Home"), [4]);
    assert_eq!(run("+Work +Home +Away"), Vec::<u32>::new());

    // The matcher still ignores Priority and Due in the Completed view, which a query cannot
    // express but a hand-built filter can.
    let mut filters = query("+Work +Home pri:A due:today");
    filters.completion = CompletionView::Completed;
    assert_eq!(project(&file, &filters, "2026-10-14"), [4]);
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
}

#[test]
fn absent_selections_stay_in_the_query_and_match_nothing() {
    let today = day("2026-10-14");
    let filters = query("pri:A due:invalid +Work @Home");
    let facets = |file: &TodoFile| todo_facets(file, filters.completion, collate);
    let file = parse("(A) Open +Work @Home due:broken\nx Done due:broken\n");
    assert!(filters.absent(&facets(&file)).is_empty());
    assert_eq!(project(&file, &filters, "2026-10-14"), [1]);

    // New data no longer offers some values: the filters are unchanged and report them.
    let edited = parse("(B) Open +Other @Home due:2026-10-14\nx Done +Work due:broken\n");
    assert_eq!(
        filters.absent(&facets(&edited)),
        AbsentSelections {
            projects: vec![],
            contexts: vec![],
            priority: Some('A'),
        }
    );
    assert_eq!(project(&edited, &filters, "2026-10-14"), Vec::<u32>::new());
    let open = query("is:open +Work +Gone @Home");
    let open_facets = todo_facets(&edited, open.completion, collate);
    assert_eq!(
        open.absent(&open_facets).projects,
        ["Gone".to_owned(), "Work".to_owned()]
    );
    assert_eq!(invalid_due_count(&edited, today), 0);
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
    let base = "is:open pri:A due:overdue +Work @Home open";
    let filters = query(base);
    assert_eq!(deferred_count(&file, &filters, today), 1);
    assert_eq!(project(&file, &filters, "2026-10-14"), Vec::<u32>::new());
    let shown = project_todos(&file, &filters, today, TodoSortOrder::File, true);
    assert_eq!(lines(&file, &shown), [1]);
    let mismatches = [
        "is:open pri:A due:overdue +Work @Home missing",
        "is:open pri:A due:overdue +Work +Other @Home open",
        "is:open pri:A due:overdue +Work @Home @Away open",
        "is:open pri:B due:overdue +Work @Home open",
        "is:open pri:A due:today +Work @Home open",
        "is:completed +Work @Home open",
    ]
    .map(query);
    for mismatch in mismatches {
        assert_eq!(deferred_count(&file, &mismatch, today), 0, "{mismatch:?}");
    }
}

#[test]
fn groups_projected_items_by_due_in_order_with_malformed_dates_in_no_due_date() {
    let file = parse(
        "Later due:2026-10-20\n\
         Broken due:2026-02-30\n\
         Late due:2026-10-02\n\
         Plain\n\
         Now due:2026-10-14\n\
         x Done late due:2026-10-01\n",
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
        (DueGroupKind::Overdue, vec![6, 3])
    );

    // Empty groups are omitted.
    let narrowed = query("plain");
    let indices = project_todos(&file, &narrowed, today, TodoSortOrder::File, false);
    let groups = group_todos_by_due(&file, &indices, today);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].kind, DueGroupKind::NoDueDate);
}

#[test]
fn queries_parse_to_filters_whose_canonical_query_parses_back_identically() {
    let cases = [
        ("", ""),
        (" is:all\t", ""),
        (
            "+Work @office pri:A due:today invoice",
            "pri:A due:today +Work @office invoice",
        ),
        ("DUE:Today pri:a IS:OPEN", "is:open pri:A due:today"),
        ("is:completed +Done", "is:completed +Done"),
        (
            r#"+Z +A +A is:all "hello world" "+Work" Café"#,
            r#"+A +Z "hello world" "+Work" Café"#,
        ),
        // Names take the Todo parser's domain: sigils count only at the start of a word.
        ("+a+b ++ +Work: a+b + @ @@", "++ +Work: +a+b @@ a+b + @"),
        ("note: x:y:z", "note: x:y:z"),
        (
            r#""due:2026-11-06" "pri:" "is""#,
            r#""due:2026-11-06" "pri:" is"#,
        ),
        // Escapes, quoted names, and words that need quotes to read back the same.
        (r#""\"" "C:\\work\\" C:\x"#, r#""\"" "C:\\work\\" "C:\\x""#),
        (r#"+"a\"b" @"x" say"hi"#, r#"+"a\"b" @x "say\"hi""#),
        ("+\"a\u{feff}b\" a\u{85}b", "+\"a\u{feff}b\" a\u{85}b"),
        ("\u{feff}one\u{feff}two\u{3000}", "one two"),
    ];
    for (input, canonical) in cases {
        let filters = query(input);
        assert_eq!(filters.to_query(), canonical, "{input:?}");
        assert_eq!(query(canonical), filters, "{input:?}");
    }
    let parsed = query(r#"pri:b +Z +A "a b" c"#);
    assert_eq!(
        parsed,
        TodoFilters {
            priority: Some('B'),
            projects: vec!["A".into(), "Z".into()],
            search: vec!["a b".into(), "c".into()],
            ..TodoFilters::default()
        }
    );
}

#[test]
fn invalid_queries_report_the_offending_bytes_and_why() {
    use QueryErrorKind::*;
    let cases = [
        ("pri:A pri:A", 6..11, Repeated(QueryKey::Priority)),
        ("is:open x IS:open", 10..17, Repeated(QueryKey::Completion)),
        ("é pri:", 3..7, UnknownValue(QueryKey::Priority, "".into())),
        (
            "pri:AB",
            0..6,
            UnknownValue(QueryKey::Priority, "AB".into()),
        ),
        (
            "due:today:",
            0..10,
            UnknownValue(QueryKey::Due, "today:".into()),
        ),
        (
            "is:done",
            0..7,
            UnknownValue(QueryKey::Completion, "done".into()),
        ),
        ("pri:A is:completed", 6..18, CompletedWithPriorityOrDue),
        (
            "is:completed x due:today",
            15..24,
            CompletedWithPriorityOrDue,
        ),
        (r#"say "hi there"#, 4..13, UnterminatedQuote),
        (r#""abc\""#, 0..6, UnterminatedQuote),
        (r#""foo"bar baz"#, 5..8, TextAfterQuote),
        (r#""a\nb""#, 2..4, InvalidEscape),
        (r#"x """#, 2..4, EmptyPhrase),
        (r#"+"""#, 0..3, InvalidName('+')),
        (r#"@"x y""#, 0..6, InvalidName('@')),
        ("+a\u{85}b", 0..5, InvalidName('+')),
    ];
    for (input, span, kind) in cases {
        assert_eq!(
            TodoFilters::parse(input),
            Err(QueryError { span, kind }),
            "{input:?}"
        );
    }
    let message = |input| TodoFilters::parse(input).unwrap_err().to_string();
    assert_eq!(
        message("is:completed pri:A"),
        "Completed views cannot filter by Due date or Priority."
    );
    assert_eq!(
        message("due:soon"),
        "Unknown Due date \u{201c}soon\u{201d}; use overdue, today, upcoming, none, or invalid."
    );
}
