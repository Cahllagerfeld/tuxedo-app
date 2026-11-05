use std::fs;
use std::path::{Path, PathBuf};

use super::{ID_A, ID_B};
use crate::*;

const ID_C: &str = "2c1d3c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

fn workspace(id: &str, name: &str, todo_file: &Path) -> Workspace {
    Workspace {
        id: id.to_owned(),
        name: name.to_owned(),
        todo_file: todo_file.to_path_buf(),
        color: WorkspaceColor::Blue,
        created_at: "2026-11-05T09:00:00.000Z".to_owned(),
        sort_order: None,
        show_deferred: None,
    }
}

/// Prepares, executes, and accepts `change`, returning the result's warning.
fn run(
    session: &mut WorkspaceSession,
    catalogue: &Path,
    change: WorkspaceChange,
) -> Result<Option<String>, CoreError> {
    let result = session
        .prepare_workspace_change(catalogue, change)?
        .execute()?;
    let warning = result.warning.clone();
    session.accept_workspace_change(result)?;
    Ok(warning)
}

/// A temp dir whose (canonical) root holds `a.txt` and `b.txt`, and a session whose catalogue
/// has Workspaces A (active, opened) and B, created through the commands themselves.
fn fixture() -> (WorkspaceSession, PathBuf, PathBuf, tempfile::TempDir) {
    let dir = super::temp_dir();
    let root = fs::canonicalize(dir.path()).unwrap();
    fs::write(root.join("a.txt"), "Task A\n").unwrap();
    fs::write(root.join("b.txt"), "Task B\n").unwrap();
    let catalogue = root.join("workspaces.json");
    let mut session = WorkspaceSession::new(load_catalogue(&catalogue).unwrap());
    for (id, name) in [(ID_B, "B"), (ID_A, "A")] {
        let file = root.join(format!("{}.txt", name.to_lowercase()));
        let create = WorkspaceChange::Create {
            workspace: workspace(id, name, &file),
        };
        run(&mut session, &catalogue, create).unwrap();
    }
    (session, catalogue, root, dir)
}

fn selected_id(session: &WorkspaceSession) -> Option<&str> {
    session.selected().map(|s| s.workspace.id.as_str())
}

#[test]
fn workspace_commands_persist_and_select_without_touching_todo_files() {
    let (mut session, catalogue, root, _dir) = fixture();
    // The first Create started from a missing catalogue; each commit is what disk now holds.
    let on_disk = |session: &WorkspaceSession| {
        assert_eq!(&load_catalogue(&catalogue).unwrap(), session.catalogue());
    };
    on_disk(&session);
    assert_eq!(selected_id(&session), Some(ID_A));

    // Create trims the name, canonicalizes the path, appends, and activates.
    fs::create_dir(root.join("sub")).unwrap();
    fs::write(root.join("c.txt"), "Task C\r\n").unwrap();
    let mut c = workspace(ID_C, "  New\u{feff} ", &root.join("sub/../c.txt"));
    c.color = WorkspaceColor::Green;
    run(
        &mut session,
        &catalogue,
        WorkspaceChange::Create { workspace: c },
    )
    .unwrap();
    on_disk(&session);
    let created_c = &session.catalogue().workspaces[2];
    assert_eq!(
        (created_c.name.as_str(), created_c.todo_file.clone()),
        ("New", root.join("c.txt"))
    );
    assert_eq!(selected_id(&session), Some(ID_C));
    assert_eq!(session.selected().unwrap().file.items[0].raw, "Task C");

    // Preferences (set elsewhere, as Electron does) survive every update below.
    let mut with_preferences = session.catalogue().clone();
    with_preferences.workspaces[2].sort_order = Some(TodoSortOrder::Due);
    with_preferences.workspaces[2].show_deferred = Some(true);
    crate::catalogue_write::write_catalogue(&catalogue, &with_preferences).unwrap();
    session = WorkspaceSession::new(load_catalogue(&catalogue).unwrap());
    session.open(ID_C).unwrap();
    let created = session.catalogue().workspaces[2].clone();

    // Renaming and recoloring the Active workspace keeps its id, date, and preferences;
    // replacing an inactive Workspace's file does not activate it.
    let revision = session.revision();
    let rename = WorkspaceChange::Update {
        id: ID_C.into(),
        name: "Renamed".into(),
        color: WorkspaceColor::Violet,
        todo_file: created.todo_file.clone(),
    };
    run(&mut session, &catalogue, rename).unwrap();
    on_disk(&session);
    let renamed = session.selected().unwrap().workspace.clone();
    assert_eq!(
        renamed,
        Workspace {
            name: "Renamed".into(),
            color: WorkspaceColor::Violet,
            ..created
        }
    );
    assert!(
        session.revision() > revision,
        "metadata changes advance the revision"
    );

    // Replacing the Active workspace's Todo file shows the replacement.
    fs::write(root.join("e.txt"), "Task E\n").unwrap();
    let replace_active = WorkspaceChange::Update {
        id: ID_C.into(),
        name: "Renamed".into(),
        color: WorkspaceColor::Violet,
        todo_file: root.join("e.txt"),
    };
    run(&mut session, &catalogue, replace_active).unwrap();
    on_disk(&session);
    let selected = session.selected().unwrap();
    assert_eq!(
        selected.workspace,
        Workspace {
            todo_file: root.join("e.txt"),
            ..renamed
        }
    );
    assert_eq!(
        (selected.file.path.clone(), selected.file.source.as_str()),
        (root.join("e.txt"), "Task E\n")
    );

    fs::write(root.join("d.txt"), "Task D\n").unwrap();
    let replace = WorkspaceChange::Update {
        id: ID_A.into(),
        name: "A".into(),
        color: WorkspaceColor::Blue,
        todo_file: root.join("d.txt"),
    };
    run(&mut session, &catalogue, replace).unwrap();
    on_disk(&session);
    assert_eq!(
        session.catalogue().workspace(ID_A).unwrap().todo_file,
        root.join("d.txt")
    );
    assert_eq!(selected_id(&session), Some(ID_C));

    // Select loads the Workspace and persists it as the Active workspace.
    run(
        &mut session,
        &catalogue,
        WorkspaceChange::Select { id: ID_A.into() },
    )
    .unwrap();
    on_disk(&session);
    assert_eq!(
        session.catalogue().active_workspace_id.as_deref(),
        Some(ID_A)
    );
    assert_eq!(session.selected().unwrap().file.items[0].raw, "Task D");

    // Deleting an inactive Workspace keeps the Active one; deleting the Active one empties it.
    // A result executed before the deletion was accepted (reselecting A writes nothing) carries
    // the old catalogue: accepting it would bring B back, so the catalogue-only change refuses it.
    let held = session
        .prepare_workspace_change(&catalogue, WorkspaceChange::Select { id: ID_A.into() })
        .unwrap()
        .execute()
        .unwrap();
    run(
        &mut session,
        &catalogue,
        WorkspaceChange::Delete { id: ID_B.into() },
    )
    .unwrap();
    on_disk(&session);
    assert_eq!(selected_id(&session), Some(ID_A));
    assert!(matches!(
        session.accept_workspace_change(held),
        Err(CoreError::StaleCommand)
    ));
    assert!(session.catalogue().workspace(ID_B).is_none());
    run(
        &mut session,
        &catalogue,
        WorkspaceChange::Delete { id: ID_A.into() },
    )
    .unwrap();
    on_disk(&session);
    assert_eq!(session.catalogue().active_workspace_id, None);
    assert!(session.selected().is_none());

    // No Todo file was created, changed, or removed.
    for (name, contents) in [
        ("a.txt", "Task A\n"),
        ("b.txt", "Task B\n"),
        ("c.txt", "Task C\r\n"),
        ("d.txt", "Task D\n"),
        ("e.txt", "Task E\n"),
    ] {
        assert_eq!(fs::read_to_string(root.join(name)).unwrap(), contents);
    }
}

#[test]
fn refused_commands_leave_the_catalogue_unchanged() {
    type Setup = fn(&Path, &Path);
    let update_a = |todo_file: &str| WorkspaceChange::Update {
        id: ID_A.into(),
        name: "A".into(),
        color: WorkspaceColor::Blue,
        todo_file: todo_file.into(),
    };
    let create = |name: &str, todo_file: &str| WorkspaceChange::Create {
        workspace: workspace(ID_C, name, Path::new(todo_file)),
    };
    let none: Setup = |_, _| {};
    let cases: Vec<(&str, WorkspaceChange, Setup)> = vec![
        ("blank name", create(" \t", "c.txt"), none),
        ("names are unique ignoring case", create("b", "c.txt"), none),
        (
            "an alias of a saved Todo file",
            create("C", "alias.txt"),
            |root, _| {
                std::os::unix::fs::symlink(root.join("a.txt"), root.join("alias.txt")).unwrap();
            },
        ),
        ("a missing Todo file", create("C", "missing.txt"), none),
        ("the catalogue itself", create("C", "workspaces.json"), none),
        (
            "a Todo file with Skipped lines",
            create("C", "c.txt"),
            |root, _| {
                fs::write(root.join("c.txt"), "Fine\n2026-13-01 Impossible\n").unwrap();
            },
        ),
        ("a missing replacement", update_a("missing.txt"), none),
        (
            "renaming while the Active workspace's Todo file is unreadable",
            update_a("a.txt"),
            |root, _| {
                fs::remove_file(root.join("a.txt")).unwrap();
            },
        ),
        (
            "an id that is not a UUID",
            WorkspaceChange::Create {
                workspace: workspace("not-a-uuid", "C", Path::new("c.txt")),
            },
            none,
        ),
        (
            "selecting an unreadable Todo file",
            WorkspaceChange::Select { id: ID_B.into() },
            |root, _| {
                fs::remove_file(root.join("b.txt")).unwrap();
            },
        ),
        (
            "a catalogue changed on disk",
            WorkspaceChange::Delete { id: ID_B.into() },
            |_, catalogue| {
                let text = fs::read_to_string(catalogue)
                    .unwrap()
                    .replace("\"B\"", "\"Elsewhere\"");
                fs::write(catalogue, text).unwrap();
            },
        ),
        (
            "a catalogue removed on disk",
            WorkspaceChange::Select { id: ID_B.into() },
            |_, catalogue| {
                fs::remove_file(catalogue).unwrap();
            },
        ),
    ];
    for (label, change, setup) in cases {
        let (session, catalogue, root, _dir) = fixture();
        fs::write(root.join("c.txt"), "Task C\n").unwrap();
        // Relative paths in the table are resolved against the fixture's directory.
        let change = match change {
            WorkspaceChange::Create { mut workspace } => {
                workspace.todo_file = root.join(&workspace.todo_file);
                WorkspaceChange::Create { workspace }
            }
            WorkspaceChange::Update {
                id,
                name,
                color,
                todo_file,
            } => WorkspaceChange::Update {
                todo_file: root.join(todo_file),
                id,
                name,
                color,
            },
            other => other,
        };
        let outcome = session
            .prepare_workspace_change(&catalogue, change)
            .and_then(|request| {
                setup(&root, &catalogue);
                let disk = fs::read(&catalogue).ok();
                let result = request.execute();
                assert_eq!(
                    fs::read(&catalogue).ok(),
                    disk,
                    "{label}: catalogue rewritten"
                );
                result
            });
        assert!(outcome.is_err(), "{label}: {outcome:?}");
    }
}

#[test]
fn committed_deletion_survives_an_active_workspace_that_cannot_reopen() {
    let (mut session, catalogue, root, _dir) = fixture();
    fs::remove_file(root.join("a.txt")).unwrap();
    let warning = run(
        &mut session,
        &catalogue,
        WorkspaceChange::Delete { id: ID_B.into() },
    );
    assert!(warning.unwrap().is_some(), "Empty state with a warning");
    assert!(session.selected().is_none());
    assert_eq!(&load_catalogue(&catalogue).unwrap(), session.catalogue());
    assert_eq!(
        session.catalogue().active_workspace_id.as_deref(),
        Some(ID_A)
    );
    assert!(session.catalogue().workspace(ID_B).is_none());

    // A result prepared before another accepted change is refused at acceptance.
    fs::write(root.join("a.txt"), "Back\n").unwrap();
    let result = session
        .prepare_workspace_change(&catalogue, WorkspaceChange::Select { id: ID_A.into() })
        .unwrap()
        .execute()
        .unwrap();
    session.open(ID_A).unwrap();
    assert!(matches!(
        session.accept_workspace_change(result),
        Err(CoreError::StaleCommand)
    ));
}
