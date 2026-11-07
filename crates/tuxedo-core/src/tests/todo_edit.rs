//! The shared Todo-item editor: line assembly and validation tables ported from
//! `packages/contracts` and `apps/desktop/src/lib/shared/todo-creation.spec.ts`, and creation,
//! editing and Undo against real files, porting the focused cases of
//! `apps/desktop/electron/session-tests/{create-todo,edit-todo,undo,recurrence}.spec.ts`.

use std::fs;
use std::path::PathBuf;

use super::{workspace_json, ID_A};
use crate::todo_edit::create_line;
use crate::*;

fn date(value: &str) -> TodoDate {
    TodoDate::parse(value).unwrap()
}

fn draft(description: &str) -> TodoDraft {
    TodoDraft {
        description: description.to_owned(),
        ..TodoDraft::default()
    }
}

fn tags(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).to_owned()).collect()
}

#[test]
fn creation_assembles_the_canonical_line() {
    let cases: Vec<(TodoDraft, &str)> =
        vec![
        (
            TodoDraft {
                creation_date: "2026-10-02".into(),
                projects: tags(&["Tuxedo", "Review"]),
                contexts: tags(&["Phone", "phone"]),
                metadata: tags(&["custom:first", "custom:last"]),
                ..draft("  Plan   the\trelease\u{85} ")
            },
            "2026-10-02 Plan the release +Tuxedo +Review @Phone @phone custom:first custom:last",
        ),
        (
            TodoDraft {
                priority: PriorityChoice::Letter('Z'),
                creation_date: "2026-10-01".into(),
                completed: true,
                completion_date: "2026-10-09".into(),
                metadata: tags(&["due:2026-10-10", "custom:value"]),
                ..draft("Plan")
            },
            "x 2026-10-09 2026-10-01 Plan due:2026-10-10 custom:value pri:Z",
        ),
        (
            TodoDraft {
                priority: PriorityChoice::Letter('A'),
                ..draft("Plan")
            },
            "(A) Plan",
        ),
        (
            TodoDraft {
                projects: tags(&["+Work", "@Home"]),
                ..draft("")
            },
            "++Work +@Home",
        ),
        (
            TodoDraft {
                priority: PriorityChoice::Letter('B'),
                ..draft("")
            },
            "(B) ",
        ),
        (
            TodoDraft {
                creation_date: "2026-10-02".into(),
                ..draft("")
            },
            "2026-10-02",
        ),
        (draft("Plan + https://example.test/a:b:extra"), "Plan + https://example.test/a:b:extra"),
    ];
    for (draft, line) in cases {
        let fields = draft.validate(false).unwrap();
        assert_eq!(create_line(&fields), line, "{draft:?}");
    }
}

#[test]
fn validation_reports_electron_messages_per_field() {
    use DraftField::*;
    let tokens = "Use the Project, Context, and Metadata inputs for these tokens.";
    let markers = "Use the Priority, date, and Completed controls for leading Todo markers.";
    let completion = "Choose a Completion date for a completed Todo item.";
    let completed = |priority, completion_date: &str| TodoDraft {
        priority,
        completed: true,
        completion_date: completion_date.into(),
        ..draft("Plan")
    };
    type Case = (TodoDraft, bool, Vec<(DraftField, &'static str)>);
    let cases: Vec<Case> = vec![
        (draft(" \t "), false, vec![(Description, "Enter a Description or another Todo-item value.")]),
        (draft("\u{85}"), false, vec![(Description, "Enter a Description or another Todo-item value.")]),
        (draft("Plan +Project"), false, vec![(Description, tokens)]),
        (draft("Plan @home"), false, vec![(Description, tokens)]),
        (draft("Plan due:tomorrow"), false, vec![(Description, tokens)]),
        (draft("Call\u{85}+Work"), false, vec![(Description, tokens)]),
        (draft("Plan board:"), false, vec![(Description, tokens)]),
        (
            TodoDraft { projects: tags(&["Work", "Work"]), ..draft("Plan") },
            false,
            vec![(Projects, "Todo tags must be unique")],
        ),
        (
            TodoDraft { contexts: tags(&["at\u{85}home"]), ..draft("Plan") },
            false,
            vec![(Contexts, "Todo tags must be trimmed and must not contain whitespace")],
        ),
        (
            TodoDraft { priority: PriorityChoice::Incomplete, ..draft("Plan") },
            false,
            vec![(Priority, "Choose None, A, B, C, or enter one letter from D to Z.")],
        ),
        (
            TodoDraft { priority: PriorityChoice::Letter('a'), ..draft("Plan") },
            false,
            vec![(Priority, "Choose None, A, B, C, or enter one letter from D to Z.")],
        ),
        (
            TodoDraft { creation_date: "2026-02-29".into(), ..draft("Plan") },
            false,
            vec![(CreationDate, "Use a valid date in YYYY-MM-DD format.")],
        ),
        (completed(PriorityChoice::None, ""), false, vec![(CompletionDate, completion)]),
        (
            TodoDraft { completion_date: "2026-10-09".into(), ..draft("Plan") },
            false,
            vec![(CompletionDate, "Only completed Todo items have a Completion date.")],
        ),
        (
            TodoDraft {
                metadata: tags(&["pri:B"]),
                ..completed(PriorityChoice::Letter('A'), "2026-10-09")
            },
            false,
            vec![(Metadata, "Remove pri Metadata or clear Priority; Priority is saved as pri Metadata on completion.")],
        ),
        (
            TodoDraft { metadata: tags(&["bad:has space"]), ..draft("Plan") },
            false,
            vec![(Metadata, "Use key:value without spaces or extra colons.")],
        ),
        (
            TodoDraft { metadata: tags(&["key:too:many"]), ..draft("Plan") },
            false,
            vec![(Metadata, "Use key:value without spaces or extra colons.")],
        ),
        (
            TodoDraft { metadata: tags(&["+key:value"]), ..draft("Plan") },
            false,
            vec![(Metadata, "Metadata keys must not start with + or @.")],
        ),
        (draft("x Completed"), false, vec![(Description, markers)]),
        (TodoDraft { projects: tags(&["Work"]), ..draft("x") }, false, vec![(Description, markers)]),
        (TodoDraft { contexts: tags(&["Home"]), ..draft("(A)") }, false, vec![(Description, markers)]),
        (draft("(A) Priority"), false, vec![(Description, markers)]),
        (draft("2026-10-09 Date"), false, vec![(Description, markers)]),
        (
            TodoDraft {
                priority: PriorityChoice::Letter('A'),
                ..completed(PriorityChoice::None, "2026-10-09")
            }
            .with_description("(B) hello"),
            false,
            vec![(Description, markers)],
        ),
        // A dated item may start with marker-looking text: the date ends the prefix.
        (TodoDraft { creation_date: "2026-10-09".into(), ..draft("x (A) 2026-10-09 ok") }, false, vec![]),
        // Editing keeps legacy completed items without dates, and their Priority before text.
        (completed(PriorityChoice::None, ""), true, vec![]),
        (
            completed(PriorityChoice::Letter('A'), "2026-10-09").with_description("(B) Updated"),
            true,
            vec![],
        ),
        (
            TodoDraft { creation_date: "2026-10-12".into(), ..completed(PriorityChoice::None, "") },
            true,
            vec![(CompletionDate, completion)],
        ),
        (
            TodoDraft { repeat_interval: "0".into(), repeat_unit: RepeatUnit::Week, ..draft("Plan") },
            true,
            vec![(RepeatInterval, "Enter a positive whole-number interval.")],
        ),
        (
            TodoDraft { repeat_unit: RepeatUnit::Unsupported, metadata: tags(&["rec:+1w"]), ..draft("Plan") },
            true,
            vec![],
        ),
    ];
    for (draft, editing, expected) in cases {
        let errors = match draft.validate(editing) {
            Ok(_) => vec![],
            Err(errors) => errors.into_iter().map(|e| (e.field, e.message)).collect(),
        };
        assert_eq!(errors, expected, "{draft:?}");
    }
}

impl TodoDraft {
    fn with_description(self, description: &str) -> Self {
        Self {
            description: description.to_owned(),
            ..self
        }
    }
}

#[test]
fn typed_tags_and_metadata_follow_the_editor_inputs() {
    let selected = tags(&["Work"]);
    assert_eq!(
        validate_tag(" +Home ", &selected, '+', false),
        Ok("Home".into())
    );
    assert_eq!(
        validate_tag("+Home", &selected, '+', true),
        Ok("+Home".into())
    );
    assert_eq!(
        validate_tag("+Work", &selected, '+', false),
        Err("That tag is already selected.")
    );
    assert_eq!(
        validate_tag("at home", &selected, '@', false),
        Err("Use a tag name without spaces.")
    );
    assert_eq!(
        validate_tag("@", &selected, '@', false),
        Err("Use a tag name without spaces.")
    );
    assert_eq!(validate_metadata_token(" a:b "), Ok("a:b".into()));
    assert_eq!(validate_metadata_token("board:"), Ok("board:".into()));
    assert!(validate_metadata_token("@a:b").is_err());
}

#[test]
fn date_and_repeat_controls_edit_their_metadata_tokens() {
    let item = parse_todo_text(
        PathBuf::new(),
        "Mow due:soon t:+2d t:2026-02-30 rec:1d rec:+1w board:x board:y",
    )
    .items
    .remove(0);
    let mut draft = TodoDraft::from_item(&item);
    // Malformed effective values stay in Metadata until the control changes them.
    assert_eq!((draft.due_date(), draft.show_from()), (None, None));
    assert_eq!(draft.show_from_token(), Some("2026-02-30"));
    assert_eq!(draft.repeat_unit, RepeatUnit::Unsupported);
    draft.set_due_date(Some(date("2026-11-01")));
    draft.set_show_from(None);
    assert_eq!(
        draft.metadata,
        tags(&["rec:1d", "rec:+1w", "board:x", "board:y", "due:2026-11-01"])
    );
    // An invalid interval leaves the rule untouched; a valid one replaces every rec: token.
    draft.set_repeat("0", RepeatUnit::Week);
    assert!(draft.metadata.contains(&"rec:+1w".to_owned()));
    draft.set_repeat("2", RepeatUnit::Week);
    assert_eq!(
        draft.metadata,
        tags(&["board:x", "board:y", "due:2026-11-01", "rec:2w"])
    );
    draft.set_metadata(tags(&["rec:3m"]));
    assert_eq!(
        (draft.repeat_interval.as_str(), draft.repeat_unit),
        ("3", RepeatUnit::Month)
    );
    draft.set_repeat("3", RepeatUnit::Off);
    assert!(draft.metadata.is_empty());

    let mut completed = TodoDraft::new_item(date("2026-11-07"));
    assert_eq!(completed.creation_date, "2026-11-07");
    completed.set_completed(true, date("2026-11-07"));
    assert_eq!(completed.completion_date, "2026-11-07");
    completed.set_completed(false, date("2026-11-07"));
    assert_eq!(completed.completion_date, "");
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

    fn create(&mut self, draft: TodoDraft) -> Outcome {
        let fields = draft.validate(false).unwrap();
        let revision = self.session.revision();
        let request =
            self.session
                .prepare_create(&self.catalogue, ID_A, revision, fields, date(TODAY));
        self.finish(request)
    }

    fn edit(&mut self, line: u32, draft: impl FnOnce(TodoDraft) -> TodoDraft) -> Outcome {
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
        self.edit_target(target, draft(TodoDraft::from_item(&item)))
    }

    fn edit_target(&mut self, target: TodoTarget, draft: TodoDraft) -> Outcome {
        let fields = match draft.validate(true) {
            Ok(fields) => fields,
            Err(errors) => return Outcome::Invalid(errors[0].message.to_owned()),
        };
        let request = self
            .session
            .prepare_edit(&self.catalogue, target, fields, date(TODAY));
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
        ("", "line"),
        ("Existing", "Existing\nline"),
        ("Existing\r\n", "Existing\r\nline\r\n"),
        ("Existing\r\nLast", "Existing\r\nLast\r\nline"),
        (
            "x 2026-10-08 Done\r\n\nKeep",
            "x 2026-10-08 Done\r\n\nKeep\r\nline",
        ),
    ] {
        let mut fixture = Fixture::new(initial);
        assert_eq!(fixture.create(draft("line")), Outcome::Applied(None));
        assert_eq!(fixture.disk(), expected);
        assert_eq!(fixture.session.undo_label(), Some("Undo creation"));
        assert_eq!(fixture.undo(), Outcome::Applied(None));
        assert_eq!(fixture.disk(), initial);
    }
}

#[test]
fn a_future_show_from_reports_that_the_saved_item_is_hidden() {
    let mut fixture = Fixture::new("");
    let later = |show_from: &str| TodoDraft {
        metadata: vec![format!("t:{show_from}")],
        ..draft("Later")
    };
    assert_eq!(fixture.create(later(TODAY)), Outcome::Applied(None));
    assert_eq!(
        fixture.create(later("2028-02-01")),
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
        fixture.create(draft("New")),
        Outcome::Conflict("The Todo file changed on disk. Review its current contents.".into())
    );
    assert_eq!(fixture.disk(), "Changed externally\r\n");
    let shown = &fixture.session.selected().unwrap().file.items[0];
    assert_eq!(shown.description, "Changed externally");

    let fields = draft("New").validate(false).unwrap();
    let stale = fixture.session.revision() - 1;
    let request =
        fixture
            .session
            .prepare_create(&fixture.catalogue, ID_A, stale, fields, date(TODAY));
    assert_eq!(fixture.finish(request), Outcome::Stale);
    assert_eq!(fixture.disk(), "Changed externally\r\n");
}

const EDIT_FILE: &str =
    "Keep\r\nx 2026-10-09 2026-10-01 Old +Work custom:first custom:last\r\nLast";

#[test]
fn editing_replaces_only_the_target_line_keeping_position_and_ending() {
    let mut fixture = Fixture::new(EDIT_FILE);
    let edited = |d: TodoDraft| TodoDraft {
        projects: tags(&["Home"]),
        contexts: tags(&["desk"]),
        ..d.with_description("Updated")
    };
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
    let draft = edited(TodoDraft::from_item(&item));
    assert_eq!(fixture.edit_target(target, draft), Outcome::Applied(None));
    assert_eq!(
        fixture.disk(),
        "Changed elsewhere\nx 2026-10-09 2026-10-01 Updated +Home @desk custom:first custom:last\r\n\nLast"
    );
    assert_eq!(fixture.session.undo_label(), Some("Undo edit"));
    assert_eq!(fixture.undo(), Outcome::Applied(None));
    assert_eq!(
        fixture.disk(),
        format!("Changed elsewhere\n{}\r\n\nLast", item.raw)
    );
}

#[test]
fn editing_refuses_a_changed_target_and_a_cleared_completion_date() {
    let mut fixture = Fixture::new(EDIT_FILE);
    let target = TodoTarget {
        workspace_id: ID_A.to_owned(),
        revision: fixture.session.revision(),
        line_number: 2,
        expected_raw: fixture.session.selected().unwrap().file.items[1]
            .raw
            .clone(),
    };
    fs::write(&fixture.todo, "Keep\r\nChanged externally\r\nLast").unwrap();
    assert_eq!(
        fixture.edit_target(target, draft("Updated")),
        Outcome::Conflict("The Todo item changed on disk. Review its current contents.".into())
    );
    assert_eq!(fixture.disk(), "Keep\r\nChanged externally\r\nLast");

    // The editor reports it on the field before anything is queued; the core refuses it too.
    let recorded = parse_todo_text(PathBuf::new(), "x 2026-10-09 Old")
        .items
        .remove(0);
    let cleared = TodoDraft {
        completion_date: String::new(),
        ..TodoDraft::from_item(&recorded)
    };
    let errors = cleared.validate_edit(&recorded).unwrap_err();
    assert_eq!(errors[0].field, DraftField::CompletionDate);
    let legacy = parse_todo_text(PathBuf::new(), "x Old").items.remove(0);
    assert!(TodoDraft::from_item(&legacy).validate_edit(&legacy).is_ok());

    let mut fixture = Fixture::new("x 2026-10-09 Old");
    let outcome = fixture.edit(1, |d| TodoDraft {
        completion_date: String::new(),
        ..d
    });
    assert_eq!(
        outcome,
        Outcome::Invalid("Choose a Completion date for a completed Todo item.".into())
    );
    assert_eq!(fixture.disk(), "x 2026-10-09 Old");
}

#[test]
fn editing_keeps_legacy_completed_forms_and_the_generation_marker() {
    for (initial, edit, expected) in [
        ("x +Work custom:first custom:last", "", "x "),
        (
            "x (A) 2026-10-01 Old",
            "Updated",
            "x (A) 2026-10-01 Updated",
        ),
        (
            "x 2026-10-09 (A) Old pri:B",
            "Updated",
            "x 2026-10-09 (A) Updated pri:B",
        ),
        (
            "x 2026-10-09 (A) (B) Old",
            "(B) Updated",
            "x 2026-10-09 (A) (B) Updated",
        ),
        (
            "Clean rec:1d tuxedo-generated:1",
            "Changed",
            "Changed rec:2w tuxedo-generated:1",
        ),
    ] {
        let mut fixture = Fixture::new(initial);
        let outcome = fixture.edit(1, |d| {
            let mut d = d.with_description(edit);
            if initial.starts_with("x +Work") {
                d.projects.clear();
                d.metadata.clear();
            }
            if initial.starts_with("Clean") {
                d.set_metadata(tags(&["rec:2w"]));
            }
            d
        });
        assert_eq!(outcome, Outcome::Applied(None), "{initial}");
        assert_eq!(fixture.disk(), expected);
    }
}

#[test]
fn editor_completion_generates_the_recurring_successor_with_the_saved_priority() {
    let mut fixture = Fixture::new("(A) Clean rec:2w\r\nLast");
    let outcome = fixture.edit(1, |mut d| {
        d.set_completed(true, date(TODAY));
        TodoDraft {
            priority: PriorityChoice::Letter('B'),
            completion_date: "2024-02-29".into(),
            metadata: tags(&["rec:1y", "custom:yes"]),
            ..d.with_description("New chore")
        }
    });
    assert_eq!(
        outcome,
        Outcome::Applied(Some("Next occurrence due 2025-02-28.".into()))
    );
    assert_eq!(
        fixture.disk(),
        "x 2024-02-29 (B) New chore rec:1y custom:yes tuxedo-generated:1\r\n\
         (B) 2028-01-31 New chore rec:1y custom:yes due:2025-02-28\r\nLast"
    );
    assert_eq!(fixture.undo(), Outcome::Applied(None));
    assert_eq!(fixture.disk(), "(A) Clean rec:2w\r\nLast");
}

#[test]
fn an_unchanged_edit_writes_nothing_and_keeps_the_previous_undo() {
    let mut fixture = Fixture::new("First\nSecond\n");
    assert_eq!(fixture.create(draft("Third")), Outcome::Applied(None));
    let revision = fixture.session.revision();
    assert_eq!(fixture.edit(1, |d| d), Outcome::Applied(None));
    assert_eq!(fixture.session.revision(), revision);
    assert_eq!(fixture.session.undo_label(), Some("Undo creation"));
    assert_eq!(fixture.undo(), Outcome::Applied(None));
    assert_eq!(fixture.disk(), "First\nSecond\n");
}
