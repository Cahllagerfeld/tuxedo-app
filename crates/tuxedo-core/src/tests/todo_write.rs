//! Todo-file commands against real temporary files, porting the focused parity cases of
//! `apps/desktop/electron/session-tests/{completion,recurrence,undo}.spec.ts`.

use std::fs;
use std::path::PathBuf;

use super::{workspace_json, ID_A, ID_B};
use crate::*;

/// The TS completion tests' clock (`new Date(2030, 0, 2)`).
const COMPLETION_DAY: &str = "2030-01-02";
/// The TS recurrence tests' clock (`new Date(2028, 0, 31)`).
const RECURRENCE_DAY: &str = "2028-01-31";

/// Workspaces A (active, opened) and B with their own Todo files in a temporary directory.
struct Fixture {
    session: WorkspaceSession,
    catalogue: PathBuf,
    todo: PathBuf,
    _dir: tempfile::TempDir,
}

/// What one command did, in a comparable shape.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Applied(Option<String>),
    Conflict(String),
    Invalid(String),
    Stale,
}

impl Fixture {
    fn new(contents: &str) -> Self {
        Self::with_bytes(contents.as_bytes())
    }

    fn with_bytes(contents: &[u8]) -> Self {
        let dir = super::temp_dir();
        let root = dir.path();
        let (todo, other) = (root.join("a.txt"), root.join("b.txt"));
        fs::write(&todo, contents).unwrap();
        fs::write(&other, "Task B\n").unwrap();
        let json = format!(
            r#"{{"version":1,"active_workspace_id":"{ID_A}","workspaces":[{},{}]}}"#,
            workspace_json(ID_A, "A", todo.to_str().unwrap()),
            workspace_json(ID_B, "B", other.to_str().unwrap()),
        );
        let catalogue = root.join("workspaces.json");
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

    fn items(&self) -> &[TodoItem] {
        &self.session.selected().unwrap().file.items
    }

    /// A target for the displayed item on physical line `line`.
    fn target(&self, line: u32) -> TodoTarget {
        let item = self.items().iter().find(|i| i.line_number == line).unwrap();
        TodoTarget {
            workspace_id: ID_A.to_owned(),
            revision: self.session.revision(),
            line_number: line,
            expected_raw: item.raw.clone(),
        }
    }

    fn set_completion(&mut self, line: u32, completed: bool, today: &str) -> Outcome {
        let target = self.target(line);
        self.run_completion(target, completed, today)
    }

    fn run_completion(&mut self, target: TodoTarget, completed: bool, today: &str) -> Outcome {
        let today = TodoDate::parse(today).unwrap();
        let request = self
            .session
            .prepare_completion(&self.catalogue, target, completed, today);
        self.finish(request)
    }

    fn undo(&mut self) -> Outcome {
        let request = self.session.prepare_undo(&self.catalogue);
        self.finish(request)
    }

    /// Executes on another thread (proving the request is `Send`) and accepts the result.
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

fn applied() -> Outcome {
    Outcome::Applied(None)
}

fn invalid(message: &str) -> Outcome {
    Outcome::Invalid(message.to_owned())
}

#[test]
fn completion_writes_adjacent_dates_and_keeps_priority_as_metadata_for_reopening() {
    let initial = "(A) 2026-05-24 Call Mom +Family @phone  \r\n\nOther\nFinal";
    let mut f = Fixture::new(initial);
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    assert_eq!(
        f.disk(),
        "x 2030-01-02 2026-05-24 Call Mom +Family @phone pri:A  \r\n\nOther\nFinal"
    );
    let item = &f.items()[0];
    assert!(item.completed && item.priority.is_none());
    assert_eq!(item.metadata_value("pri"), Some("A"));
    assert_eq!(f.session.undo_label(), Some("Undo completion"));

    assert_eq!(f.set_completion(1, false, COMPLETION_DAY), applied());
    assert_eq!(f.disk(), initial);
    assert_eq!(f.session.undo_label(), Some("Undo uncompletion"));

    // Matching priority metadata is reused, not duplicated.
    let mut f = Fixture::new("(A) Buy milk pri:A");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    assert_eq!(f.disk(), "x 2030-01-02 Buy milk pri:A");
}

#[test]
fn items_without_description_text_complete_and_reopen() {
    for initial in [
        "+GarageSale",
        "@phone",
        "due:2026-10-12",
        "(A) +GarageSale @phone",
    ] {
        let mut f = Fixture::new(initial);
        assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
        assert!(f.items()[0].completed, "{initial}");
        assert_eq!(f.set_completion(1, false, COMPLETION_DAY), applied());
        assert_eq!(f.disk(), initial);
    }
}

#[test]
fn reopening_removes_only_the_marker_and_completion_date() {
    for (initial, expected) in [
        ("x Buy milk", "Buy milk"),
        (
            "x 2026-01-01 (B) 2025-12-31 Buy  milk  ",
            "(B) 2025-12-31 Buy  milk  ",
        ),
        ("x 2020-01-01\tBuy milk\r\nSecond", "Buy milk\r\nSecond"),
        // Legacy completions and board positions: the Done position goes, the column stays.
        ("x 2029-12-01 Legacy", "Legacy"),
        (
            "x 2029-12-02 Plan board:in-progress board-done:3",
            "Plan board:in-progress",
        ),
        ("x board-done:1 Plan", "Plan"),
        // Like the TS regex, a second leading token is kept once the first consumed its space.
        ("x board-done:1 board-done:2 Plan", "board-done:2 Plan"),
    ] {
        let mut f = Fixture::new(initial);
        assert_eq!(
            f.set_completion(1, false, COMPLETION_DAY),
            applied(),
            "{initial}"
        );
        assert_eq!(f.disk(), expected, "{initial}");
    }
}

#[test]
fn completion_prepends_its_marker_before_indented_content() {
    for initial in ["  (A) Call Mom", "\tBuy milk", "  x 2026-01-01 Buy milk"] {
        let mut f = Fixture::new(&format!("{initial}\r\nOther"));
        assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
        assert_eq!(f.disk(), format!("x 2030-01-02 {initial}\r\nOther"));
        assert!(f.items()[0].completed && f.items()[0].priority.is_none());
        assert_eq!(f.set_completion(1, false, COMPLETION_DAY), applied());
        assert_eq!(f.disk(), format!("{initial}\r\nOther"));
    }
}

#[test]
fn reopening_restores_only_valid_priority_metadata() {
    for (initial, expected) in [
        (
            "x 2026-01-01 2025-12-31 Buy milk pri:B",
            "(B) 2025-12-31 Buy milk",
        ),
        ("x 2026-01-01 pri:Z Buy milk", "(Z) Buy milk"),
        ("x Buy milk pri:A due:tomorrow", "(A) Buy milk due:tomorrow"),
        ("x 2026-01-01 Buy milk pri:urgent", "Buy milk pri:urgent"),
        (
            "x 2026-01-01 Buy milk +pri:A @pri:B",
            "Buy milk +pri:A @pri:B",
        ),
        ("x 2026-01-01 Buy milk pri:A pri:A", "(A) Buy milk"),
    ] {
        let mut f = Fixture::new(initial);
        assert_eq!(
            f.set_completion(1, false, COMPLETION_DAY),
            applied(),
            "{initial}"
        );
        assert_eq!(f.disk(), expected, "{initial}");
    }
}

#[test]
fn conflicting_priority_metadata_and_empty_reopening_refuse_without_writing() {
    let completing =
        "Conflicting priority metadata; edit the Todo file before completing this item.";
    let reopening =
        "Conflicting priority metadata; edit the Todo file before uncompleting this item.";
    let empty =
        "Cannot uncomplete a Todo item without remaining content. Edit the Todo file first.";
    for (initial, completed, message) in [
        ("(A) Buy milk pri:B", true, completing),
        ("(A) Buy milk pri:urgent", true, completing),
        ("(A) Buy milk pri:B pri:A", true, completing),
        ("x 2026-01-01 Buy milk pri:B pri:A", false, reopening),
        ("x \r\nOther\n", false, empty),
        ("x \t\u{85}\u{a0}\r\nOther\n", false, empty),
        ("x 2026-01-01\r\nOther\n", false, empty),
        ("x 2026-01-01   \r\nOther\n", false, empty),
    ] {
        let mut f = Fixture::new(initial);
        let revision = f.session.revision();
        assert_eq!(
            f.set_completion(1, completed, COMPLETION_DAY),
            invalid(message),
            "{initial:?}"
        );
        assert_eq!(f.disk(), initial);
        assert_eq!(
            f.session.revision(),
            revision,
            "confirmed state is unchanged"
        );
    }
}

#[test]
fn completion_rereads_disk_and_keeps_unrelated_external_edits() {
    let mut f = Fixture::new("Buy milk\nSecond\n");
    fs::write(&f.todo, "Buy milk\r\n\n2026-13-01 Invalid\nSecond changed").unwrap();
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    assert_eq!(
        f.disk(),
        "x 2030-01-02 Buy milk\r\n\n2026-13-01 Invalid\nSecond changed"
    );
    let file = &f.session.selected().unwrap().file;
    assert_eq!(file.items[1].line_number, 4);
    assert_eq!(file.skipped[0].line_number, 3);
}

#[test]
fn a_changed_or_missing_target_is_a_conflict_that_refreshes_and_clears_undo() {
    for contents in ["Buy bread\nSecond", ""] {
        let mut f = Fixture::new("Buy milk\nSecond");
        assert_eq!(f.set_completion(2, true, COMPLETION_DAY), applied());
        assert!(f.session.can_undo());
        let target = f.target(1);
        fs::write(&f.todo, contents).unwrap();
        assert_eq!(
            f.run_completion(target, true, COMPLETION_DAY),
            Outcome::Conflict("The Todo item changed on disk. Review its current contents.".into())
        );
        assert_eq!(f.disk(), contents);
        assert_eq!(f.session.selected().unwrap().file.source, contents);
        assert!(!f.session.can_undo());
    }
}

#[test]
fn rejected_completions_preserve_bytes_session_and_undo() {
    let mut f = Fixture::new("Buy milk\nSecond\n");
    assert_eq!(f.set_completion(2, true, COMPLETION_DAY), applied());
    let (revision, disk) = (f.session.revision(), f.disk());

    // Same state, a target that is not one Todo item, a stale revision, another Workspace.
    assert_eq!(
        f.set_completion(2, true, COMPLETION_DAY),
        invalid("Todo item already has the requested completion state.")
    );
    let mut bad = f.target(1);
    bad.expected_raw = "2026-13-01 Invalid".into();
    assert_eq!(
        f.run_completion(bad, true, COMPLETION_DAY),
        invalid("Invalid Todo item target.")
    );
    let mut stale = f.target(1);
    stale.revision -= 1;
    assert_eq!(
        f.run_completion(stale, true, COMPLETION_DAY),
        Outcome::Stale
    );
    let mut other = f.target(1);
    other.workspace_id = ID_B.into();
    assert_eq!(
        f.run_completion(other, true, COMPLETION_DAY),
        Outcome::Stale
    );

    // A write failure: the directory is read-only, so the temporary file cannot be created.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = f.todo.parent().unwrap().to_path_buf();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        let target = f.target(1);
        let today = TodoDate::parse(COMPLETION_DAY).unwrap();
        let result = f
            .session
            .prepare_completion(&f.catalogue, target, true, today)
            .unwrap()
            .execute();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(result, Err(CoreError::Io { .. })), "{result:?}");
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert!(names.iter().all(|n| !n.ends_with(".tmp")), "{names:?}");
    }

    assert_eq!((f.session.revision(), f.disk()), (revision, disk));
    assert_eq!(f.session.undo_label(), Some("Undo completion"));
}

#[test]
fn a_changed_active_workspace_refuses_the_write() {
    let mut f = Fixture::new("Buy milk\n");
    let json = fs::read_to_string(&f.catalogue).unwrap().replace(
        &format!(r#""active_workspace_id":"{ID_A}""#),
        &format!(r#""active_workspace_id":"{ID_B}""#),
    );
    fs::write(&f.catalogue, json).unwrap();
    assert_eq!(
        f.set_completion(1, true, COMPLETION_DAY),
        invalid("The Active workspace changed.")
    );
    assert_eq!(f.disk(), "Buy milk\n");
}

#[test]
fn a_changed_todo_path_after_prepare_refuses_without_touching_either_file() {
    // The replacement file holds the same line, so only the path check can catch the change.
    let mut f = Fixture::new("Buy milk\n");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    let other = f.todo.with_file_name("other.txt");
    fs::write(&other, "x 2030-01-02 Buy milk\n").unwrap();
    let today = TodoDate::parse(COMPLETION_DAY).unwrap();
    let completion = f
        .session
        .prepare_completion(&f.catalogue, f.target(1), false, today)
        .unwrap();
    let undo = f.session.prepare_undo(&f.catalogue).unwrap();
    let json = fs::read_to_string(&f.catalogue)
        .unwrap()
        .replace(f.todo.to_str().unwrap(), other.to_str().unwrap());
    fs::write(&f.catalogue, json).unwrap();

    let (revision, source) = (f.session.revision(), f.disk());
    for request in [completion, undo] {
        assert_eq!(
            f.finish(Ok(request)),
            invalid("The Active workspace changed.")
        );
    }
    assert_eq!(f.disk(), source);
    assert_eq!(
        fs::read_to_string(&other).unwrap(),
        "x 2030-01-02 Buy milk\n"
    );
    assert_eq!(f.session.revision(), revision);
    assert!(f.session.can_undo());
}

#[test]
fn a_lone_carriage_return_and_a_bom_are_preserved() {
    let mut f = Fixture::new("Buy\rmilk\nSecond");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    assert_eq!(f.disk(), "x 2030-01-02 Buy\rmilk\nSecond");

    let initial = "\u{feff}(A) Buy milk\r\nx 2020-01-01 Second\n";
    let mut f = Fixture::new(initial);
    assert_eq!(f.set_completion(2, false, COMPLETION_DAY), applied());
    assert_eq!(
        f.disk().as_bytes(),
        "\u{feff}(A) Buy milk\r\nSecond\n".as_bytes()
    );
    assert_eq!(f.undo(), applied());
    assert_eq!(f.disk().as_bytes(), initial.as_bytes());
}

#[cfg(unix)]
#[test]
fn writes_preserve_the_todo_file_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let mut f = Fixture::new("Buy milk\n");
    fs::set_permissions(&f.todo, fs::Permissions::from_mode(0o664)).unwrap();
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    let mode = fs::metadata(&f.todo).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode, 0o664);
}

// Undo

#[test]
fn undo_restores_exact_bytes_once() {
    let initial = "\u{feff}(A) Buy milk  \r\nOther\n";
    let mut f = Fixture::new(initial);
    assert!(!f.session.can_undo());
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    assert_eq!(f.undo(), applied());
    assert_eq!(f.disk(), initial);
    assert!(!f.session.can_undo(), "one step, no redo");
    assert_eq!(f.undo(), invalid("There is no change to undo."));
}

#[test]
fn undo_refuses_unseen_external_edits_and_shows_the_current_file() {
    let mut f = Fixture::new("Buy milk\n");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    fs::write(&f.todo, "Edited elsewhere\n").unwrap();
    assert_eq!(
        f.undo(),
        Outcome::Conflict("The Todo file changed on disk. Undo is no longer available.".into())
    );
    assert_eq!(f.disk(), "Edited elsewhere\n");
    assert_eq!(f.items()[0].raw, "Edited elsewhere");
    assert!(!f.session.can_undo());
}

#[test]
fn undo_restores_the_bytes_seen_before_the_change_including_external_edits() {
    let mut f = Fixture::new("Buy milk\nSecond\n");
    fs::write(&f.todo, "Buy milk\nSecond changed\n").unwrap();
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    assert_eq!(f.undo(), applied());
    assert_eq!(f.disk(), "Buy milk\nSecond changed\n");
}

#[test]
fn switching_workspaces_clears_undo_and_reaccepting_the_same_file_keeps_it() {
    let mut f = Fixture::new("Buy milk\n");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    let same = f.session.selected().unwrap().clone();
    let revision = f.session.revision();
    f.session.accept(same);
    assert!(f.session.can_undo());
    assert_eq!(f.session.revision(), revision);
    f.session.open(ID_B).unwrap();
    assert!(!f.session.can_undo());
    assert!(f.session.revision() > revision);
    f.session.open(ID_A).unwrap();
    assert!(!f.session.can_undo());
}

#[test]
fn a_result_from_an_older_revision_is_refused_at_acceptance() {
    let mut f = Fixture::new("Buy milk\nSecond\n");
    let today = TodoDate::parse(COMPLETION_DAY).unwrap();
    let result = f
        .session
        .prepare_completion(&f.catalogue, f.target(1), true, today)
        .unwrap()
        .execute()
        .unwrap();
    f.session.open(ID_B).unwrap();
    assert!(matches!(
        f.session.accept_todo_write(result),
        Err(CoreError::StaleCommand)
    ));
    assert_eq!(f.session.selected().unwrap().workspace.id, ID_B);
}

// Recurrence

#[test]
fn recurring_completion_inserts_one_successor_and_undoes_the_whole_change() {
    let initial =
        "(A) 2020-01-01 Clean +Home @desk rec:1m due:old custom:first custom:last\r\n\n2026-13-01 Skipped\nLast";
    let mut f = Fixture::new(initial);
    assert_eq!(
        f.set_completion(1, true, RECURRENCE_DAY),
        Outcome::Applied(Some("Next occurrence due 2028-02-29.".into()))
    );
    assert_eq!(
        f.disk(),
        "x 2028-01-31 2020-01-01 Clean +Home @desk rec:1m due:old custom:first custom:last pri:A tuxedo-generated:1\r\n(A) 2028-01-31 Clean +Home @desk rec:1m custom:first custom:last due:2028-02-29\r\n\n2026-13-01 Skipped\nLast"
    );
    assert_eq!(f.undo(), applied());
    assert_eq!(f.disk(), initial);

    // A BOM stays in the original's raw text but, as in TS, is trimmed from the successor.
    let initial = "\u{feff}Chore rec:1d\nLast";
    let mut f = Fixture::new(initial);
    f.set_completion(1, true, RECURRENCE_DAY);
    assert_eq!(
        f.disk().as_bytes(),
        "x 2028-01-31 \u{feff}Chore rec:1d tuxedo-generated:1\n2028-01-31 Chore rec:1d due:2028-02-01\nLast".as_bytes()
    );
    assert_eq!(f.undo(), applied());
    assert_eq!(f.disk().as_bytes(), initial.as_bytes());
}

#[test]
fn recurrence_anchors_each_unit_to_the_completion_date_with_calendar_clamping() {
    for (rule, due) in [
        ("1d", "2028-02-01"),
        ("2w", "2028-02-14"),
        ("1m", "2028-02-29"),
        ("13m", "2029-02-28"),
        ("1y", "2029-01-31"),
    ] {
        let mut f = Fixture::new(&format!("Clean rec:{rule}"));
        assert_eq!(
            f.set_completion(1, true, RECURRENCE_DAY),
            Outcome::Applied(Some(format!("Next occurrence due {due}.")))
        );
        let successor = &f.items()[1];
        assert!(!successor.completed);
        assert_eq!(successor.creation_date, TodoDate::parse(RECURRENCE_DAY));
        assert_eq!(successor.metadata_value("due"), Some(due));
        assert!(f
            .disk()
            .ends_with(&format!("\n2028-01-31 Clean rec:{rule} due:{due}")));
    }
    // A leap day plus a year clamps to Feb 28.
    let mut f = Fixture::new("Clean rec:1y");
    assert_eq!(
        f.set_completion(1, true, "2024-02-29"),
        Outcome::Applied(Some("Next occurrence due 2025-02-28.".into()))
    );
}

#[test]
fn unsupported_rules_complete_with_a_notice_and_no_successor() {
    for rule in ["+1w", "0d", "-1d", "1D", "1.5m", "1b", "1w2d", "é", "1日"] {
        let mut f = Fixture::new(&format!("Mow rec:{rule} t:2099-01-01"));
        assert_eq!(
            f.set_completion(1, true, RECURRENCE_DAY),
            Outcome::Applied(Some(
                "Unsupported Repeat rule; no next occurrence generated.".into()
            ))
        );
        assert_eq!(
            f.disk(),
            format!("x 2028-01-31 Mow rec:{rule} t:2099-01-01")
        );
    }
    // A bare `rec:` is description text, not a rule.
    let mut f = Fixture::new("Clean rec:");
    assert_eq!(f.set_completion(1, true, RECURRENCE_DAY), applied());
    assert_eq!(f.disk(), "x 2028-01-31 Clean rec:");
}

#[test]
fn intervals_beyond_the_date_range_refuse_without_writing() {
    for rule in [
        "999999999999999999999d",
        "9999y",
        "999999m",
        "999999999999999w",
    ] {
        let initial = format!("Clean rec:{rule}");
        let mut f = Fixture::new(&initial);
        assert_eq!(
            f.set_completion(1, true, RECURRENCE_DAY),
            invalid("The recurrence interval exceeds the supported date range.")
        );
        assert_eq!(f.disk(), initial);
    }
}

#[test]
fn the_successor_uses_the_lines_ending_and_the_last_rule_wins() {
    for (ending, separator) in [("\n", "\n"), ("\r\n", "\r\n"), ("", "\n")] {
        let mut f = Fixture::new(&format!("Clean rec:+1w rec:1d due:first due:last{ending}"));
        assert_eq!(
            f.set_completion(1, true, RECURRENCE_DAY),
            Outcome::Applied(Some("Next occurrence due 2028-02-01.".into()))
        );
        assert_eq!(
            f.disk(),
            format!("x 2028-01-31 Clean rec:+1w rec:1d due:first due:last tuxedo-generated:1{separator}2028-01-31 Clean rec:+1w rec:1d due:2028-02-01{ending}")
        );
    }
    // A final line without an ending takes the file's first ending.
    let mut f = Fixture::new("First\r\nClean rec:1d");
    f.set_completion(2, true, RECURRENCE_DAY);
    assert_eq!(
        f.disk(),
        "First\r\nx 2028-01-31 Clean rec:1d tuxedo-generated:1\r\n2028-01-31 Clean rec:1d due:2028-02-01"
    );
}

#[test]
fn the_original_keeps_board_tokens_and_the_successor_starts_unassigned() {
    let mut f = Fixture::new(
        "(B) Chore rec:1w board:to-do/2 board-done:1 board:future:invalid custom:keep\r\nx 2029-12-01 Legacy\n",
    );
    f.set_completion(1, true, RECURRENCE_DAY);
    let [source, successor, ..] = f.items() else {
        panic!("expected a successor")
    };
    assert_eq!(
        source.raw,
        "x 2028-01-31 Chore rec:1w board:to-do/2 board-done:1 board:future:invalid custom:keep pri:B tuxedo-generated:1"
    );
    assert_eq!(
        successor.raw,
        "(B) 2028-01-31 Chore rec:1w custom:keep due:2028-02-07"
    );
}

#[test]
fn the_successor_priority_follows_the_open_source_not_pri_metadata() {
    let mut f = Fixture::new("Clean pri:A rec:1d");
    f.set_completion(1, true, RECURRENCE_DAY);
    assert_eq!(f.items()[1].priority, None);
    assert_eq!(f.items()[1].metadata_value("pri"), Some("A"));

    let mut f = Fixture::new("(A) Clean pri:A rec:1d");
    f.set_completion(1, true, RECURRENCE_DAY);
    assert_eq!(f.items()[1].priority, Some('A'));
    assert_eq!(f.items()[1].metadata_value("pri"), None);
}

#[test]
fn the_generated_marker_prevents_a_second_successor_but_undo_does_not() {
    let mut f = Fixture::new("Clean rec:1d");
    f.set_completion(1, true, RECURRENCE_DAY);
    assert_eq!(f.undo(), applied());
    f.set_completion(1, true, RECURRENCE_DAY);
    assert_eq!(f.items().len(), 2, "Undo permits generation again");

    // Delete the successor externally, then reopen and complete again: nothing is generated.
    let first = f.disk().lines().next().unwrap().to_owned();
    fs::write(&f.todo, &first).unwrap();
    f.session.open(ID_A).unwrap();
    assert_eq!(f.set_completion(1, false, RECURRENCE_DAY), applied());
    assert_eq!(f.disk(), "Clean rec:1d tuxedo-generated:1");
    assert_eq!(f.set_completion(1, true, RECURRENCE_DAY), applied());
    assert_eq!(f.items().len(), 1);
}

#[test]
fn show_from_lead_time_carries_onto_the_successor() {
    for (initial, notice, expected) in [
        (
            "Mow rec:1m due:2028-02-01 t:2028-01-29",
            "Next occurrence due 2028-02-29. Show from 2028-02-26.",
            "x 2028-01-31 Mow rec:1m due:2028-02-01 t:2028-01-29 tuxedo-generated:1\n2028-01-31 Mow rec:1m t:2028-02-26 due:2028-02-29",
        ),
        // A valid Show from without a valid Due date is dropped; relative thresholds stay.
        (
            "Mow rec:1d t:+2d t:2099-01-01",
            "Next occurrence due 2028-02-01.",
            "x 2028-01-31 Mow rec:1d t:+2d t:2099-01-01 tuxedo-generated:1\n2028-01-31 Mow rec:1d t:+2d due:2028-02-01",
        ),
        // A Show from after the Due date keeps its offset.
        (
            "Mow rec:1d due:2028-01-28 t:2028-01-31",
            "Next occurrence due 2028-02-01. Show from 2028-02-04.",
            "x 2028-01-31 Mow rec:1d due:2028-01-28 t:2028-01-31 tuxedo-generated:1\n2028-01-31 Mow rec:1d t:2028-02-04 due:2028-02-01",
        ),
        // The last valid Show from is the one carried forward.
        (
            "Mow rec:1m due:2028-02-01 t:2028-01-01 t:2028-01-29",
            "Next occurrence due 2028-02-29. Show from 2028-02-26.",
            "x 2028-01-31 Mow rec:1m due:2028-02-01 t:2028-01-01 t:2028-01-29 tuxedo-generated:1\n2028-01-31 Mow rec:1m t:2028-01-01 t:2028-02-26 due:2028-02-29",
        ),
        // A Show from on the completion date is kept but not announced.
        (
            "Trim rec:1d due:2028-02-10 t:2028-02-09",
            "Next occurrence due 2028-02-01.",
            "x 2028-01-31 Trim rec:1d due:2028-02-10 t:2028-02-09 tuxedo-generated:1\n2028-01-31 Trim rec:1d t:2028-01-31 due:2028-02-01",
        ),
        // An unsupported effective Show from is copied unchanged.
        (
            "Mow rec:1d due:2028-02-01 t:2099-01-01 t:+2d",
            "Next occurrence due 2028-02-01.",
            "x 2028-01-31 Mow rec:1d due:2028-02-01 t:2099-01-01 t:+2d tuxedo-generated:1\n2028-01-31 Mow rec:1d t:2099-01-01 t:+2d due:2028-02-01",
        ),
        (
            "Mow rec:1d due:soon t:2026-02-30 t:2099-01-01",
            "Next occurrence due 2028-02-01.",
            "x 2028-01-31 Mow rec:1d due:soon t:2026-02-30 t:2099-01-01 tuxedo-generated:1\n2028-01-31 Mow rec:1d t:2026-02-30 due:2028-02-01",
        ),
        (
            "Mow rec:1d due:2026-02-30 t:2026-02-30 t:2099-01-01",
            "Next occurrence due 2028-02-01.",
            "x 2028-01-31 Mow rec:1d due:2026-02-30 t:2026-02-30 t:2099-01-01 tuxedo-generated:1\n2028-01-31 Mow rec:1d t:2026-02-30 due:2028-02-01",
        ),
    ] {
        let mut f = Fixture::new(initial);
        assert_eq!(
            f.set_completion(1, true, RECURRENCE_DAY),
            Outcome::Applied(Some(notice.into())),
            "{initial}"
        );
        assert_eq!(f.disk(), expected);
    }
}

#[test]
fn a_show_from_outside_the_date_range_refuses_without_writing() {
    for initial in [
        "Mow rec:1d due:2028-01-31 t:9999-12-31",
        "Mow rec:1d due:9999-12-31 t:0001-01-01",
        // Year 0000 is a TodoDate but not a date the reference calendar round-trips.
        "Mow rec:1d due:0000-01-01 t:0000-01-02",
    ] {
        let mut f = Fixture::new(initial);
        let revision = f.session.revision();
        assert_eq!(
            f.set_completion(1, true, RECURRENCE_DAY),
            invalid("The next Show from date is outside the supported date range.")
        );
        assert_eq!(
            (f.disk().as_str(), f.session.revision()),
            (initial, revision)
        );
    }
}

// Catalogue acceptance (Workspace commands)

#[test]
fn a_changed_inactive_workspace_advances_the_revision_and_keeps_undo() {
    let mut f = Fixture::new("Buy milk\n");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    let revision = f.session.revision();
    let selected = f.session.selected().cloned();
    let mut catalogue = f.session.catalogue().clone();
    catalogue.workspaces[1].name = "Renamed".into();
    f.session.accept_catalogue(catalogue, selected);
    assert_eq!(f.session.revision(), revision + 1);
    assert!(f.session.can_undo());
}

#[test]
fn a_changed_catalogue_without_a_selection_advances_the_revision() {
    let mut f = Fixture::new("Buy milk\n");
    let mut catalogue = f.session.catalogue().clone();
    f.session.accept_catalogue(catalogue.clone(), None);
    let revision = f.session.revision();
    catalogue.workspaces.pop();
    f.session.accept_catalogue(catalogue, None);
    assert_eq!(f.session.revision(), revision + 1);
}

#[test]
fn reaccepting_an_identical_catalogue_and_selection_changes_nothing() {
    let mut f = Fixture::new("Buy milk\n");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    let revision = f.session.revision();
    let (catalogue, selected) = (f.session.catalogue().clone(), f.session.selected().cloned());
    f.session.accept_catalogue(catalogue, selected);
    assert_eq!(f.session.revision(), revision);
    assert!(f.session.can_undo());
}

#[test]
fn a_reread_selects_the_persisted_active_workspace() {
    let mut f = Fixture::new("Buy milk\n");
    assert_eq!(f.set_completion(1, true, COMPLETION_DAY), applied());
    let request = f.session.prepare_reread(&f.catalogue);
    let json = fs::read_to_string(&f.catalogue).unwrap().replace(
        &format!(r#""active_workspace_id":"{ID_A}""#),
        &format!(r#""active_workspace_id":"{ID_B}""#),
    );
    fs::write(&f.catalogue, json).unwrap();
    f.session.accept_reread(request.execute().unwrap());
    assert_eq!(
        f.session.catalogue().active_workspace_id.as_deref(),
        Some(ID_B)
    );
    assert_eq!(f.session.selected().unwrap().workspace.id, ID_B);
    assert!(!f.session.can_undo());

    // An Active workspace whose file cannot open fails a reread that showed a Workspace…
    fs::remove_file(f.todo.with_file_name("b.txt")).unwrap();
    assert!(f.session.prepare_reread(&f.catalogue).execute().is_err());
    // …but an Empty session stays Empty.
    f.session
        .accept_catalogue(f.session.catalogue().clone(), None);
    let result = f.session.prepare_reread(&f.catalogue).execute().unwrap();
    f.session.accept_reread(result);
    assert!(f.session.selected().is_none());
}
