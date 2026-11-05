use std::fs;
use std::path::Path;

use super::{workspace_json, ID_A, ID_B};
use crate::*;

/// A catalogue with Workspaces A (active) and B, each with its own Todo file.
fn session(name: &str) -> (WorkspaceSession, std::path::PathBuf) {
    let root = super::temp_dir(name);
    let (a, b) = (root.join("a.txt"), root.join("b.txt"));
    fs::write(&a, "Task A\n").unwrap();
    fs::write(&b, "Task B\n").unwrap();
    let json = format!(
        r#"{{"version":1,"active_workspace_id":"{ID_A}","workspaces":[{},{}]}}"#,
        workspace_json(ID_A, "A", a.to_str().unwrap()),
        workspace_json(ID_B, "B", b.to_str().unwrap()),
    );
    let catalogue_path = root.join("workspaces.json");
    fs::write(&catalogue_path, json).unwrap();
    let mut session = WorkspaceSession::new(load_catalogue(&catalogue_path).unwrap());
    session.open(ID_A).unwrap();
    (session, catalogue_path)
}

fn target(session: &WorkspaceSession, workspace_id: &str) -> TodoTarget {
    TodoTarget {
        workspace_id: workspace_id.to_owned(),
        revision: session.revision(),
        line_number: 1,
        expected_raw: "Task A".to_owned(),
    }
}

#[test]
fn accepted_snapshots_advance_the_revision_and_stale_targets_are_refused() {
    let (mut session, catalogue) = session("todo-write-revision");
    let today = TodoDate::parse("2026-11-05").unwrap();
    assert!(!session.can_undo());
    let opened = session.revision();
    assert!(opened > 0);

    let current = target(&session, ID_A);
    assert!(session
        .prepare_completion(&catalogue, current.clone(), true, today)
        .is_ok());
    assert!(matches!(
        session.prepare_completion(&catalogue, target(&session, ID_B), true, today),
        Err(CoreError::StaleCommand)
    ));

    // Reaccepting the same contents is not a change; another Workspace is.
    let same = session.selected().unwrap().clone();
    session.accept(same);
    assert_eq!(session.revision(), opened);
    session.open(ID_B).unwrap();
    assert!(session.revision() > opened);
    assert!(matches!(
        session.prepare_completion(&catalogue, current, true, today),
        Err(CoreError::StaleCommand)
    ));
    assert!(matches!(
        session.prepare_undo(&catalogue),
        Err(CoreError::InvalidCommand { .. })
    ));
    fs::remove_dir_all(Path::new(&catalogue).parent().unwrap()).unwrap();
}
