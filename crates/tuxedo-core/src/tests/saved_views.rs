use std::fs;

use super::{workspace_json, ID_A, ID_B};
use crate::saved_views::parse_saved_views;
use crate::*;

const VIEW_1: &str = "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const VIEW_2: &str = "9a8b7c6d-5e4f-4a3b-9c1d-0e1f2a3b4c5d";

fn view_json(id: &str, workspace_id: &str, name: &str, query: &str) -> String {
    format!(
        r#"{{"id":"{id}","workspace_id":"{workspace_id}","name":"{name}","query":"{query}","grammar_version":1}}"#
    )
}

fn file(views: &[String]) -> String {
    format!(r#"{{"version":2,"views":[{}]}}"#, views.join(","))
}

#[test]
fn saved_views_files_decode_strictly() {
    let good = view_json(VIEW_1, ID_A, "Today", "due:today +work");
    let parsed = parse_saved_views(&file(&[
        good.clone(),
        view_json(VIEW_2, ID_B, "today", "is:open"),
    ]))
    .unwrap();
    assert_eq!(parsed[0].query, "due:today +work");
    assert_eq!(parse_saved_views(r#"{"version":2,"views":[]}"#), Ok(vec![]));

    let with = |field: &str| good.replacen('{', &format!("{{{field},"), 1);
    let without_grammar = good.replace(r#","grammar_version":1"#, "");
    let rejected = [
        ("broken JSON", "{broken".to_owned()),
        (
            "Electron's version 1",
            r#"{"version":1,"views":[]}"#.to_owned(),
        ),
        ("unknown version", r#"{"version":3,"views":[]}"#.to_owned()),
        (
            "excess file key",
            r#"{"version":2,"views":[],"x":1}"#.to_owned(),
        ),
        ("array root", "[2,[]]".to_owned()),
        ("array entry", r#"{"version":2,"views":[["a"]]}"#.to_owned()),
        ("excess view key", file(&[with(r#""filters":{}"#)])),
        ("missing grammar version", file(&[without_grammar])),
        ("future grammar", file(&[good.replace(":1}", ":2}")])),
        ("id not a UUID", file(&[view_json("v1", ID_A, "T", "x")])),
        ("blank name", file(&[view_json(VIEW_1, ID_A, " ", "x")])),
        (
            "untrimmed name",
            file(&[view_json(VIEW_1, ID_A, "T ", "x")]),
        ),
        ("empty query", file(&[view_json(VIEW_1, ID_A, "T", " ")])),
        (
            "invalid query",
            file(&[view_json(VIEW_1, ID_A, "T", "pri:AB")]),
        ),
        (
            "duplicate id",
            file(&[good.clone(), view_json(VIEW_1, ID_B, "Other", "x")]),
        ),
        (
            "duplicate name ignoring case",
            file(&[good.clone(), view_json(VIEW_2, ID_A, "TODAY", "x")]),
        ),
    ];
    for (label, text) in rejected {
        assert!(parse_saved_views(&text).is_err(), "{label}: {text}");
    }
}

/// A catalogue with Workspace A (open) and a session over it, in a temp dir.
fn fixture() -> (WorkspaceSession, std::path::PathBuf, tempfile::TempDir) {
    let dir = super::temp_dir();
    let todo = dir.path().join("todo.txt");
    fs::write(&todo, "Invoice +work due:2026-11-07\n").unwrap();
    let catalogue = dir.path().join("workspaces.json");
    let workspace = workspace_json(ID_A, "Work", todo.to_str().unwrap());
    fs::write(
        &catalogue,
        format!(r#"{{"version":1,"active_workspace_id":"{ID_A}","workspaces":[{workspace}]}}"#),
    )
    .unwrap();
    let mut session = WorkspaceSession::new(load_catalogue(&catalogue).unwrap());
    session.open(ID_A).unwrap();
    (session, catalogue, dir)
}

fn run(
    views: &mut SavedViews,
    session: &WorkspaceSession,
    change: SavedViewChange,
) -> Result<(), CoreError> {
    let result = views.prepare(session, change)?.execute()?;
    views.accept(result)
}

fn create(id: &str, name: &str, query: &str) -> SavedViewChange {
    SavedViewChange::Create {
        id: id.into(),
        workspace_id: ID_A.into(),
        name: name.into(),
        query: query.into(),
    }
}

#[test]
fn saved_views_round_trip_through_the_file_and_preserve_what_they_cannot_read() {
    let (session, catalogue, _dir) = fixture();
    let path = saved_views_path(&catalogue);
    let mut views = SavedViews::load(path.clone());
    assert_eq!(views.error(), None);
    assert!(!path.exists(), "an absent file holds no views");

    // Creating trims the name and stores the canonical Query; a restart reads it back, and
    // applying it gives the filters that were saved.
    run(
        &mut views,
        &session,
        create(VIEW_1, "  Work today ", "+work  due:TODAY"),
    )
    .unwrap();
    let restarted = SavedViews::load(path.clone());
    let saved: Vec<_> = restarted.for_workspace(ID_A).cloned().collect();
    assert_eq!(
        (saved[0].name.as_str(), saved[0].query.as_str()),
        ("Work today", "due:today +work")
    );
    assert_eq!(
        TodoFilters::parse(&saved[0].query).unwrap(),
        TodoFilters::parse("+work due:today").unwrap()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    // Refused before writing: a duplicate name, an empty Query, an unknown Workspace.
    for change in [
        create(VIEW_2, "WORK TODAY", "x"),
        create(VIEW_2, "Empty", "  "),
        SavedViewChange::Create {
            id: VIEW_2.into(),
            workspace_id: ID_B.into(),
            name: "Elsewhere".into(),
            query: "x".into(),
        },
    ] {
        assert!(views.prepare(&session, change).is_err());
    }

    // A file changed on disk since preparation refuses the command and is kept.
    let request = views
        .prepare(&session, create(VIEW_2, "Open", "is:open"))
        .unwrap();
    let changed = fs::read_to_string(&path)
        .unwrap()
        .replace("Work today", "Renamed");
    fs::write(&path, &changed).unwrap();
    assert!(matches!(request.execute(), Err(CoreError::StaleCommand)));
    assert_eq!(fs::read_to_string(&path).unwrap(), changed);
    views.accept_reread(read_saved_views(&path));

    // Deleting removes the entry.
    run(
        &mut views,
        &session,
        SavedViewChange::Delete { id: VIEW_1.into() },
    )
    .unwrap();
    assert_eq!(read_saved_views(&path).unwrap(), vec![]);
    assert_eq!(views.for_workspace(ID_A).count(), 0);

    // An unreadable (here: Electron's version-1) file is reported, never replaced.
    let electron = r#"{"version":1,"views":[]}"#;
    fs::write(&path, electron).unwrap();
    let views = SavedViews::load(path.clone());
    assert!(views.error().unwrap().contains(path.to_str().unwrap()));
    assert!(views
        .prepare(&session, create(VIEW_2, "Open", "is:open"))
        .is_err());
    let stale = SavedViews::new(path.clone(), Ok(vec![]));
    let request = stale
        .prepare(&session, create(VIEW_2, "Open", "is:open"))
        .unwrap();
    assert!(request.execute().is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), electron);
}
