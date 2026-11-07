//! Todo-item creation and editing as typed todo.txt lines: validation tables, and creation,
//! editing and Undo against real files, porting the focused cases of
//! `apps/desktop/electron/session-tests/{create-todo,edit-todo,undo,recurrence}.spec.ts`.

use std::fs;
use std::path::PathBuf;

use super::{workspace_json, ID_A};
use crate::*;

fn date(value: &str) -> TodoDate {
    TodoDate::parse(value).unwrap()
}

fn item(raw: &str) -> TodoItem {
    parse_todo_text(PathBuf::new(), raw).items.remove(0)
}

#[test]
fn a_new_line_gets_a_creation_date_and_is_otherwise_kept_as_typed() {
    let today = date("2026-11-07");
    let cases: [(&str, Result<&str, &str>); 13] = [
        (
            "Buy milk +Home @store due:2026-11-10",
            Ok("2026-11-07 Buy milk +Home @store due:2026-11-10"),
        ),
        ("(A) Call Mom", Ok("(A) 2026-11-07 Call Mom")),
        (
            "x 2026-11-01 Done +Work",
            Ok("x 2026-11-01 2026-11-07 Done +Work"),
        ),
        // Typed bytes stay, an explicit Creation date included; only trailing space goes.
        ("(A) 2026-10-01 Call  Mom ", Ok("(A) 2026-10-01 Call  Mom")),
        (
            "Plan \t the   release",
            Ok("2026-11-07 Plan \t the   release"),
        ),
        // A tab after a marker is not the marker's space: these are descriptions.
        ("(A)\tCall Mom", Ok("2026-11-07 (A)\tCall Mom")),
        ("x\t2026-11-01 Done", Ok("2026-11-07 x\t2026-11-01 Done")),
        (
            "(a) lowercase is text",
            Ok("2026-11-07 (a) lowercase is text"),
        ),
        ("   ", Err("Type a Todo item.")),
        (
            "+Home @store due:2026-11-10",
            Err("Add a description besides Projects, Contexts, and metadata."),
        ),
        (
            "2026-02-30 Bad date",
            Err("Use a valid date in YYYY-MM-DD format."),
        ),
        (
            "x Done without a date",
            Err("A completed Todo item keeps its Completion date: x YYYY-MM-DD."),
        ),
        ("Two\nlines", Err("A Todo item is one line.")),
    ];
    for (typed, expected) in cases {
        let line = TodoLine::new_item(typed, today);
        assert_eq!(
            line.as_ref().map(TodoLine::raw),
            expected.as_ref().map(|s| *s),
            "{typed:?}"
        );
    }
}

#[test]
fn an_edited_line_keeps_the_completion_date_rule() {
    let recorded = item("x 2026-10-09 Old");
    let legacy = item("x Old");
    let open = item("Old");
    let required = Err("A completed Todo item keeps its Completion date: x YYYY-MM-DD.");
    let edit = |typed: &str, original: &TodoItem| {
        TodoLine::edit_of(typed, original).map(|line| line.raw().to_owned())
    };
    assert_eq!(edit("x Old", &recorded), required.map(str::to_owned));
    assert_eq!(edit("x Newer", &open), required.map(str::to_owned));
    assert_eq!(
        edit("x Legacy  kept", &legacy),
        Ok("x Legacy  kept".to_owned())
    );
    assert_eq!(
        edit("Old", &recorded),
        Ok("Old".to_owned()),
        "reopening drops it"
    );
    // No Creation date is added to an edit, and an unchanged line stays byte for byte.
    assert_eq!(edit("Old  ", &open), Ok("Old".to_owned()));
    let spaced = item("Keep two spaces  ");
    assert_eq!(edit(&spaced.raw, &spaced), Ok(spaced.raw.clone()));
}

#[test]
fn the_date_helper_and_priority_autocomplete_rewrite_only_their_token() {
    let d = date("2026-11-10");
    let cases = [
        ("Call +Home", LineDate::Due, "Call +Home due:2026-11-10"),
        (
            "Call due:2026-01-01 +Home due:bad",
            LineDate::Due,
            "Call due:2026-01-01 +Home due:2026-11-10",
        ),
        (
            "Call t:2026-01-01 +Home",
            LineDate::ShowFrom,
            "Call t:2026-11-10 +Home",
        ),
        ("(A) Call", LineDate::Creation, "(A) 2026-11-10 Call"),
        (
            "x 2026-11-01 2026-10-01 Call",
            LineDate::Creation,
            "x 2026-11-01 2026-11-10 Call",
        ),
        (
            "2026-02-30 unparsed",
            LineDate::Creation,
            "2026-02-30 unparsed",
        ),
    ];
    for (line, target, expected) in cases {
        assert_eq!(line_with_date(line, target, d), expected, "{line}");
    }
    let priority = |line: &str, letter| {
        let word = line_word_at(line, line.len()).unwrap();
        line_with_priority(line, word, letter)
    };
    assert_eq!(priority("(B) Call pri:A", 'A'), ("(A) Call ".to_owned(), 9));
    assert_eq!(priority("Call pri:C", 'C'), ("(C) Call ".to_owned(), 9));
    // A completed line keeps its marker and Completion date; the Priority follows them.
    let (done, _) = priority("x 2026-11-01 Done pri:A", 'A');
    assert_eq!(done, "x 2026-11-01 (A) Done ");
    let done = item(&done);
    assert!(done.completed && done.priority == Some('A'));
    assert_eq!(done.completion_date, Some(date("2026-11-01")));
    assert_eq!(line_word_at("Call ", 5), None);
}

/// Workspace A, active and opened, with its Todo file in a temporary directory.
struct Fixture {
    session: WorkspaceSession,
    catalogue: PathBuf,
    todo: PathBuf,
    _dir: tempfile::TempDir,
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Applied(Option<String>),
    Conflict(String),
    Invalid(String),
    Stale,
}

const TODAY: &str = "2028-01-31";

impl Fixture {
    fn new(contents: &str) -> Self {
        let dir = super::temp_dir();
        let todo = dir.path().join("a.txt");
        fs::write(&todo, contents).unwrap();
        let catalogue = dir.path().join("workspaces.json");
        let json = format!(
            r#"{{"version":1,"active_workspace_id":"{ID_A}","workspaces":[{}]}}"#,
            workspace_json(ID_A, "A", todo.to_str().unwrap()),
        );
        fs::write(&catalogue, json).unwrap();
        let mut session = WorkspaceSession::new(load_catalogue(&catalogue).unwrap());
        session.open(ID_A).unwrap();
        Self {
            session,
            catalogue,
            todo,
            _dir: dir,
        }
    }

    fn disk(&self) -> String {
        fs::read_to_string(&self.todo).unwrap()
    }

    fn create(&mut self, typed: &str) -> Outcome {
        let line = TodoLine::new_item(typed, date(TODAY)).unwrap();
        let revision = self.session.revision();
        let request =
            self.session
                .prepare_create_line(&self.catalogue, ID_A, revision, line, date(TODAY));
        self.finish(request)
    }

    fn edit(&mut self, line: u32, typed: &str) -> Outcome {
        let item = self.session.selected().unwrap().file.items.iter();
        let item = item
            .clone()
            .find(|i| i.line_number == line)
            .unwrap()
            .clone();
        let target = TodoTarget {
            workspace_id: ID_A.to_owned(),
            revision: self.session.revision(),
            line_number: line,
            expected_raw: item.raw.clone(),
        };
        self.edit_target(target, &item, typed)
    }

    fn edit_target(&mut self, target: TodoTarget, original: &TodoItem, typed: &str) -> Outcome {
        let line = match TodoLine::edit_of(typed, original) {
            Ok(line) => line,
            Err(message) => return Outcome::Invalid(message.to_owned()),
        };
        let request = self
            .session
            .prepare_edit_line(&self.catalogue, target, line, date(TODAY));
        self.finish(request)
    }

    fn undo(&mut self) -> Outcome {
        let request = self.session.prepare_undo(&self.catalogue);
        self.finish(request)
    }

    fn finish(&mut self, request: Result<TodoWriteRequest, CoreError>) -> Outcome {
        let result = request.and_then(|request| {
            std::thread::spawn(move || request.execute())
                .join()
                .unwrap()
        });
        match result {
            Ok(result) => {
                let notice = result.notice.clone();
                match self.session.accept_todo_write(result).unwrap() {
                    TodoWriteStatus::Applied => Outcome::Applied(notice),
                    TodoWriteStatus::Conflict => Outcome::Conflict(notice.unwrap()),
                }
            }
            Err(CoreError::InvalidCommand { message }) => Outcome::Invalid(message),
            Err(CoreError::StaleCommand) => Outcome::Stale,
            Err(error) => panic!("unexpected error: {error}"),
        }
    }
}

#[test]
fn creation_appends_with_the_file_line_ending_and_undoes_exact_bytes() {
    for (initial, expected) in [
        ("", "2028-01-31 line"),
        ("Existing", "Existing\n2028-01-31 line"),
        ("Existing\r\n", "Existing\r\n2028-01-31 line\r\n"),
        ("Existing\r\nLast", "Existing\r\nLast\r\n2028-01-31 line"),
        (
            "x 2026-10-08 Done\r\n\nKeep",
            "x 2026-10-08 Done\r\n\nKeep\r\n2028-01-31 line",
        ),
    ] {
        let mut fixture = Fixture::new(initial);
        assert_eq!(fixture.create("line"), Outcome::Applied(None));
        assert_eq!(fixture.disk(), expected);
        assert_eq!(fixture.session.undo_label(), Some("Undo creation"));
        assert_eq!(fixture.undo(), Outcome::Applied(None));
        assert_eq!(fixture.disk(), initial);
    }
}

#[test]
fn a_future_show_from_reports_that_the_saved_item_is_hidden() {
    let mut fixture = Fixture::new("");
    assert_eq!(
        fixture.create(&format!("Later t:{TODAY}")),
        Outcome::Applied(None)
    );
    assert_eq!(
        fixture.create("Later t:2028-02-01"),
        Outcome::Applied(Some(
            "Hidden until Show from 2028-02-01. Use Show deferred to see it.".into()
        ))
    );
}

#[test]
fn creation_refuses_an_externally_changed_file_and_a_stale_revision() {
    let mut fixture = Fixture::new("Original\n");
    fs::write(&fixture.todo, "Changed externally\r\n").unwrap();
    assert_eq!(
        fixture.create("New"),
        Outcome::Conflict("The Todo file changed on disk. Review its current contents.".into())
    );
    assert_eq!(fixture.disk(), "Changed externally\r\n");
    let shown = &fixture.session.selected().unwrap().file.items[0];
    assert_eq!(shown.description, "Changed externally");

    let line = TodoLine::new_item("New", date(TODAY)).unwrap();
    let stale = fixture.session.revision() - 1;
    let request =
        fixture
            .session
            .prepare_create_line(&fixture.catalogue, ID_A, stale, line, date(TODAY));
    assert_eq!(fixture.finish(request), Outcome::Stale);
    assert_eq!(fixture.disk(), "Changed externally\r\n");
}

const EDIT_FILE: &str =
    "Keep\r\nx 2026-10-09 2026-10-01 Old +Work custom:first custom:last\r\nLast";

#[test]
fn editing_replaces_only_the_target_line_keeping_position_and_ending() {
    let mut fixture = Fixture::new(EDIT_FILE);
    // External changes to other lines survive; only the target must still match.
    let target = TodoTarget {
        workspace_id: ID_A.to_owned(),
        revision: fixture.session.revision(),
        line_number: 2,
        expected_raw: "x 2026-10-09 2026-10-01 Old +Work custom:first custom:last".into(),
    };
    let item = fixture.session.selected().unwrap().file.items[1].clone();
    fs::write(
        &fixture.todo,
        format!("Changed elsewhere\n{}\r\n\nLast", item.raw),
    )
    .unwrap();
    let typed = "x 2026-10-09 2026-10-01 Updated +Home @desk custom:first custom:last";
    assert_eq!(
        fixture.edit_target(target, &item, typed),
        Outcome::Applied(None)
    );
    assert_eq!(
        fixture.disk(),
        format!("Changed elsewhere\n{typed}\r\n\nLast")
    );
    assert_eq!(fixture.session.undo_label(), Some("Undo edit"));
    assert_eq!(fixture.undo(), Outcome::Applied(None));
    assert_eq!(
        fixture.disk(),
        format!("Changed elsewhere\n{}\r\n\nLast", item.raw)
    );
}

#[test]
fn editing_refuses_a_changed_target() {
    let mut fixture = Fixture::new(EDIT_FILE);
    let item = fixture.session.selected().unwrap().file.items[1].clone();
    let target = TodoTarget {
        workspace_id: ID_A.to_owned(),
        revision: fixture.session.revision(),
        line_number: 2,
        expected_raw: item.raw.clone(),
    };
    fs::write(&fixture.todo, "Keep\r\nChanged externally\r\nLast").unwrap();
    assert_eq!(
        fixture.edit_target(target, &item, "Updated"),
        Outcome::Conflict("The Todo item changed on disk. Review its current contents.".into())
    );
    assert_eq!(fixture.disk(), "Keep\r\nChanged externally\r\nLast");
}

#[test]
fn editing_keeps_legacy_completed_forms_and_the_generation_marker() {
    for (initial, typed, expected) in [
        ("x +Work custom:first", "x Legacy", "x Legacy"),
        (
            "x 2026-10-09 (A) Old pri:B",
            "x 2026-10-09 (A) Updated pri:B",
            "x 2026-10-09 (A) Updated pri:B",
        ),
        // The app-owned marker survives a typed line that dropped it.
        (
            "Clean rec:1d tuxedo-generated:1",
            "Changed rec:2w",
            "Changed rec:2w tuxedo-generated:1",
        ),
    ] {
        let mut fixture = Fixture::new(initial);
        assert_eq!(fixture.edit(1, typed), Outcome::Applied(None), "{initial}");
        assert_eq!(fixture.disk(), expected);
    }
}

#[test]
fn completing_by_edit_generates_the_recurring_successor_with_the_saved_priority() {
    let mut fixture = Fixture::new("(A) Clean rec:2w\r\nLast");
    let outcome = fixture.edit(1, "x 2024-02-29 New chore rec:1y custom:yes pri:B");
    assert_eq!(
        outcome,
        Outcome::Applied(Some("Next occurrence due 2025-02-28.".into()))
    );
    assert_eq!(
        fixture.disk(),
        "x 2024-02-29 New chore rec:1y custom:yes pri:B tuxedo-generated:1\r\n\
         (B) 2028-01-31 New chore rec:1y custom:yes due:2025-02-28\r\nLast"
    );
    assert_eq!(fixture.undo(), Outcome::Applied(None));
    assert_eq!(fixture.disk(), "(A) Clean rec:2w\r\nLast");
}

#[test]
fn an_unchanged_edit_writes_nothing_and_keeps_the_previous_undo() {
    let mut fixture = Fixture::new("First\nSecond\n");
    assert_eq!(fixture.create("Third"), Outcome::Applied(None));
    let revision = fixture.session.revision();
    assert_eq!(fixture.edit(1, "First"), Outcome::Applied(None));
    assert_eq!(fixture.session.revision(), revision);
    assert_eq!(fixture.session.undo_label(), Some("Undo creation"));
    assert_eq!(fixture.undo(), Outcome::Applied(None));
    assert_eq!(fixture.disk(), "First\nSecond\n");
}
