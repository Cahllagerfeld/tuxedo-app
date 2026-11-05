use std::path::{Path, PathBuf};

use crate::catalogue::parse_catalogue;
use crate::*;

fn parse(text: &str) -> TodoFile {
    parse_todo_text(PathBuf::from("/tmp/todo.txt"), text)
}

fn one(text: &str) -> TodoItem {
    let file = parse(text);
    assert_eq!(file.skipped, vec![], "{text:?}");
    assert_eq!(file.items.len(), 1, "{text:?}");
    file.items.into_iter().next().unwrap()
}

fn date(value: &str) -> Option<TodoDate> {
    Some(TodoDate::parse(value).unwrap())
}

#[test]
fn parses_canonical_todo_txt_examples() {
    let item = one("x 2011-03-02 2011-03-01 Review Tim's pull request +TodoTxtTouch @github");
    assert!(item.completed);
    assert_eq!(item.completion_date, date("2011-03-02"));
    assert_eq!(item.creation_date, date("2011-03-01"));
    assert_eq!(item.description, "Review Tim's pull request");
    assert_eq!(item.projects, ["TodoTxtTouch"]);
    assert_eq!(item.contexts, ["github"]);

    let item = one("(A) 2011-03-02 Call Mom");
    assert_eq!(
        (item.priority, item.creation_date),
        (Some('A'), date("2011-03-02"))
    );
    for (raw, description) in [
        (
            "Really gotta call Mom (A) @phone",
            "Really gotta call Mom (A)",
        ),
        ("(b) Get back to the boss", "(b) Get back to the boss"),
        ("(B)->Submit TPS report", "(B)->Submit TPS report"),
        ("  (A) Call Mom", "(A) Call Mom"),
        ("Learn how to add 2+2", "Learn how to add 2+2"),
    ] {
        let item = one(raw);
        assert_eq!(
            (item.priority, item.description.as_str()),
            (None, description),
            "{raw}"
        );
    }
    // Leading whitespace hides every prefix, as in TS.
    let item = one("\tx 2011-03-03 Call Mom");
    assert!(!item.completed && item.completion_date.is_none());
}

#[test]
fn token_only_items_fall_back_to_their_text() {
    for (raw, description) in [
        ("+GarageSale", "+GarageSale"),
        ("due:2026-10-12", "due:2026-10-12"),
        ("(A) +GarageSale @phone", "+GarageSale @phone"),
        ("x 2026-10-11 +GarageSale", "+GarageSale"),
        ("2026-10-11", "2026-10-11"),
        ("x ", "x"),
    ] {
        let item = one(raw);
        assert_eq!(item.description, description, "{raw}");
        assert_eq!(item.edit.description, "", "{raw}");
    }
}

#[test]
fn metadata_keeps_duplicates_and_resolves_last_value() {
    let item = one("Pick +Kanban +Kanban @a board:to-do x:y:z due:soon board: due:2026-02-28 + @");
    assert_eq!(item.projects, ["Kanban", "Kanban"]);
    assert_eq!(item.contexts, ["a"]);
    assert_eq!(
        item.metadata,
        [
            ("board", "to-do"),
            ("due", "soon"),
            ("board", ""),
            ("due", "2026-02-28")
        ]
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
    );
    assert_eq!(
        item.edit.metadata,
        ["board:to-do", "due:soon", "board:", "due:2026-02-28"]
    );
    assert_eq!(item.edit.description, "Pick x:y:z + @");
    assert_eq!(item.metadata_value("board"), Some(""));
    assert_eq!(item.due_date(), date("2026-02-28"));
}

#[test]
fn due_date_requires_a_valid_effective_value() {
    let today = TodoDate::parse("2026-10-14").unwrap();
    let cases = [
        ("a due:2026-10-13", DueCategory::Overdue),
        ("a due:2026-10-14", DueCategory::Today),
        ("a due:2026-10-15", DueCategory::Upcoming),
        ("a", DueCategory::None),
        ("a due:2026-02-30", DueCategory::Invalid),
        ("a due:2026-10-15 due:soon", DueCategory::Invalid),
    ];
    for (raw, category) in cases {
        let item = one(raw);
        assert_eq!(item.due_category(today), category, "{raw}");
        assert_eq!(
            item.due_date().is_some(),
            category < DueCategory::None,
            "{raw}"
        );
    }
}

#[test]
fn validates_gregorian_dates_and_skips_impossible_prefix_dates() {
    for valid in ["0000-02-29", "0099-02-28", "2000-02-29", "9999-12-31"] {
        assert_eq!(one(&format!("{valid} Valid")).creation_date, date(valid));
    }
    let file = parse(
        "1900-02-29 Invalid\n(A) 2026-13-01 Impossible\nx 2026-01-01 2026-02-29 Impossible\n2026-00-01 x\n",
    );
    assert!(file.items.is_empty());
    let skipped: Vec<_> = file
        .skipped
        .iter()
        .map(|s| (s.line_number, s.reason.as_str()))
        .collect();
    assert_eq!(
        skipped,
        [1, 2, 3, 4].map(|n| (n, "date must use YYYY-MM-DD format"))
    );
    assert_eq!(
        file.summary(),
        TodoFileSummary {
            total: 0,
            open: 0,
            completed: 0,
            skipped: 4
        }
    );
    // Non-ASCII digits are not date-shaped, so the line is an ordinary description.
    assert_eq!(
        one("éab-12-34 Invalid date\n").description,
        "éab-12-34 Invalid date"
    );
    assert_eq!(one("２０２６-01-01 wide").creation_date, None);
}

#[test]
fn preserves_source_lines_endings_and_bom() {
    let text = "\u{feff}first\r\n\n  \r\nsecond\nthird\r";
    let file = parse(text);
    assert_eq!(file.source, text);
    assert!(file.has_bom() && !file.has_final_newline());
    let lines: Vec<_> = file
        .lines
        .iter()
        .map(|l| (l.text.as_str(), l.ending))
        .collect();
    assert_eq!(
        lines,
        [
            ("\u{feff}first", LineEnding::CrLf),
            ("", LineEnding::Lf),
            ("  ", LineEnding::CrLf),
            ("second", LineEnding::Lf),
            ("third\r", LineEnding::None),
        ]
    );
    // A BOM is source content (not whitespace); blank lines keep their physical numbers.
    let items: Vec<_> = file
        .items
        .iter()
        .map(|i| (i.line_number, i.raw.as_str()))
        .collect();
    assert_eq!(items, [(1, "\u{feff}first"), (4, "second"), (5, "third\r")]);

    let file = parse("a\r\n");
    assert!(file.has_final_newline());
    assert_eq!(file.items[0].raw, "a");
    assert_eq!(file.lines.len(), 1);
}

#[test]
fn example_todo_file_parses_without_skipped_lines() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/todo.txt");
    let file = read_todo_file(&path).unwrap();
    assert!(file.skipped.is_empty());
    let summary = file.summary();
    assert_eq!(summary.total, file.items.len());
    assert_eq!(summary.open + summary.completed, summary.total);
    assert!(summary.completed > 0 && summary.open > 0);
    let invalid = file
        .items
        .iter()
        .find(|i| i.raw.contains("due:2026-02-30"))
        .unwrap();
    assert_eq!(
        (invalid.metadata_value("due"), invalid.due_date()),
        (Some("2026-02-30"), None)
    );
    let repeated = file
        .items
        .iter()
        .find(|i| i.raw.contains("board:to-do board:in-progress"))
        .unwrap();
    assert_eq!(repeated.metadata_value("board"), Some("in-progress"));
}

#[test]
fn rejects_invalid_utf8_todo_files() {
    let dir = std::env::temp_dir().join(format!("tuxedo-core-utf8-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("todo.txt");
    std::fs::write(&path, b"ok\n\xff\n").unwrap();
    let result = read_todo_file(&path);
    std::fs::remove_dir_all(&dir).unwrap();
    assert!(matches!(result, Err(CoreError::InvalidUtf8 { .. })));
}

const ID_A: &str = "b0cb4064-d525-4edf-ad56-bc5a78832039";
const ID_B: &str = "760893da-3602-40cf-8fee-593e3a80ae85";

fn workspace_json(id: &str, name: &str, path: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"{name}","color":"blue","todo_path":"{path}","created_at":"2026-10-18T09:11:29.136Z","extra":1}}"#
    )
}

#[test]
fn decodes_a_version_1_catalogue() {
    let json = format!(
        r#"{{"version":1,"active_workspace_id":"{ID_B}","workspaces":[{},{}]}}"#,
        workspace_json(ID_A, "Home", "/a/todo.txt")
            .replace(r#""extra":1"#, r#""sort_order":"due","show_deferred":true"#),
        workspace_json(ID_B, "Work", "/b/todo.txt"),
    );
    let catalogue = parse_catalogue(Path::new("/w.json"), &json).unwrap();
    assert_eq!(catalogue.active_workspace().unwrap().name, "Work");
    let home = &catalogue.workspaces[0];
    assert_eq!(home.todo_file, PathBuf::from("/a/todo.txt"));
    assert_eq!(
        (home.sort_order, home.show_deferred),
        (Some(TodoSortOrder::Due), Some(true))
    );
    assert_eq!(catalogue.workspaces[1].sort_order, None);

    let missing = Path::new(env!("CARGO_MANIFEST_DIR")).join("no-such-workspaces.json");
    assert_eq!(load_catalogue(&missing).unwrap(), Catalogue::default());
}

#[test]
fn rejects_invalid_catalogues() {
    let path = Path::new("/w.json");
    let a = workspace_json(ID_A, "Home", "/a/todo.txt");
    let case = |active: &str, workspaces: &str| {
        format!(r#"{{"version":1,"active_workspace_id":{active},"workspaces":[{workspaces}]}}"#)
    };
    let invalid = [
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_B, "home", "/b/todo.txt")),
        ),
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_B, "Work", "/a/todo.txt")),
        ),
        case(&format!(r#""{ID_B}""#), &a),
        case("null", &a.replace("blue", "teal")),
        case("null", &a.replace("Home", " Home")),
        case("null", &a.replace(".136Z", "")),
        // Multibyte characters inside the time or offset must not panic on slicing.
        case("null", &a.replace("09:11:29.136Z", "0é:0:00Z")),
        case("null", &a.replace(".136Z", "+0é:0")),
    ];
    for json in invalid {
        assert!(
            matches!(
                parse_catalogue(path, &json),
                Err(CoreError::InvalidCatalogue { .. })
            ),
            "{json}"
        );
    }
    let v2 = case("null", &a).replace(r#""version":1"#, r#""version":2"#);
    assert!(matches!(
        parse_catalogue(path, &v2),
        Err(CoreError::UnsupportedVersion { .. })
    ));
    assert!(matches!(
        parse_catalogue(path, "{"),
        Err(CoreError::Json { .. })
    ));
}

#[test]
fn session_opens_a_workspace_todo_file() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/todo.txt");
    let json = format!(
        r#"{{"version":1,"active_workspace_id":null,"workspaces":[{},{}]}}"#,
        workspace_json(ID_A, "Example", example.to_str().unwrap()),
        workspace_json(ID_B, "Gone", "/definitely/missing/todo.txt"),
    );
    let mut session = WorkspaceSession::new(parse_catalogue(Path::new("/w.json"), &json).unwrap());
    let summary = session.open(ID_A).unwrap().summary;
    assert_eq!(summary, session.selected().unwrap().file.summary());

    // The background step is Send, and a failed load leaves the selection unchanged.
    fn assert_send<T: Send + 'static>(_: &T) {}
    let request = session.prepare_open(ID_B).unwrap();
    assert_send(&request);
    let failed = std::thread::spawn(move || request.load()).join().unwrap();
    assert!(matches!(failed, Err(CoreError::Io { .. })));
    assert!(matches!(session.open(ID_B), Err(CoreError::Io { .. })));
    assert!(matches!(
        session.prepare_open("nope"),
        Err(CoreError::UnknownWorkspace { .. })
    ));
    assert_eq!(session.selected().unwrap().workspace.id, ID_A);
}
