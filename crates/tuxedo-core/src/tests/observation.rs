//! Todo-file observation acceptance against real temporary files, porting the session cases of
//! `packages/backend/src/observation-acceptance.spec.ts` and the notice rule of
//! `apps/desktop/src/lib/app/workspace-navigation.svelte.ts`.

use std::fs;

use super::{workspace_json, ID_A, ID_B};
use crate::*;

/// Workspace A (active, opened, holding `contents`) and B, in a temporary directory.
fn opened(contents: &str) -> (WorkspaceSession, std::path::PathBuf, tempfile::TempDir) {
    let dir = super::temp_dir();
    let (todo, other) = (dir.path().join("a.txt"), dir.path().join("b.txt"));
    fs::write(&todo, contents).unwrap();
    fs::write(&other, "Task B\n").unwrap();
    let json = format!(
        r#"{{"version":1,"active_workspace_id":"{ID_A}","workspaces":[{},{}]}}"#,
        workspace_json(ID_A, "A", todo.to_str().unwrap()),
        workspace_json(ID_B, "B", other.to_str().unwrap()),
    );
    let catalogue = dir.path().join("workspaces.json");
    fs::write(&catalogue, json).unwrap();
    let mut session = WorkspaceSession::new(load_catalogue(&catalogue).unwrap());
    session.open(ID_A).unwrap();
    // Leave an Undo step, which only an external change may clear.
    let selected = session.selected().unwrap();
    let target = TodoTarget {
        workspace_id: ID_A.into(),
        revision: session.revision(),
        line_number: 1,
        expected_raw: selected.file.items[0].raw.clone(),
    };
    let today = TodoDate::parse("2030-01-02").unwrap();
    let request = session
        .prepare_completion(&catalogue, target, true, today)
        .unwrap();
    session
        .accept_todo_write(request.execute().unwrap())
        .unwrap();
    assert!(session.can_undo());
    (session, todo, dir)
}

fn observe(session: &mut WorkspaceSession) -> Observed {
    let request = session.prepare_observe().expect("a Workspace is shown");
    session.accept_observed(request.execute())
}

#[test]
fn observed_reads_are_accepted_by_their_bytes() {
    // Tuxedo's own write: the disk holds exactly the confirmed bytes, so nothing changes.
    let (mut session, todo, _dir) = opened("Plan release\nShip it\n");
    let revision = session.revision();
    assert_eq!(observe(&mut session), Observed::Unchanged);
    assert_eq!(session.revision(), revision);
    assert!(session.can_undo());

    // Bytes that parse to the same Todo items are confirmed without a notice.
    let own = fs::read_to_string(&todo).unwrap();
    fs::write(&todo, own.replace('\n', "\r\n")).unwrap();
    assert_eq!(observe(&mut session), Observed::Changed { notice: None });
    assert!(!session.can_undo(), "an external change clears Undo");
    assert_eq!(session.revision(), revision + 1);

    // A changed Todo item is confirmed, shown, and reported.
    fs::write(&todo, "Plan release\nShip it\nWrite notes\n").unwrap();
    assert_eq!(
        observe(&mut session),
        Observed::Changed {
            notice: Some(TODO_FILE_RELOADED)
        }
    );
    let selected = session.selected().unwrap();
    assert_eq!(selected.summary.total, 3);
    assert_eq!(selected.workspace.id, ID_A);
    assert_eq!(session.revision(), revision + 2);
}

#[test]
fn an_unreadable_todo_file_enters_the_empty_state_with_a_warning() {
    let (mut session, todo, _dir) = opened("Plan release\n");
    fs::remove_file(&todo).unwrap();
    let Observed::Unavailable { warning } = observe(&mut session) else {
        panic!("expected Unavailable");
    };
    assert!(warning.contains("a.txt"), "{warning}");
    assert!(session.selected().is_none() && !session.can_undo());
    assert!(
        session.prepare_observe().is_none(),
        "Empty observes nothing"
    );
    // The catalogue keeps its Active workspace; observation never writes it.
    assert_eq!(
        session.catalogue().active_workspace_id.as_deref(),
        Some(ID_A)
    );
}

#[test]
fn a_read_prepared_before_the_session_moved_is_stale() {
    let (mut session, todo, _dir) = opened("Plan release\n");
    let request = session.prepare_observe().unwrap();
    fs::write(&todo, "Changed elsewhere\n").unwrap();
    let result = request.execute();
    session.open(ID_B).unwrap();
    let revision = session.revision();
    assert_eq!(session.accept_observed(result), Observed::Stale);
    assert_eq!(session.selected().unwrap().workspace.id, ID_B);
    assert_eq!(session.revision(), revision);
}
