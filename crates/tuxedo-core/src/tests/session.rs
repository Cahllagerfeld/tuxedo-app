use std::path::Path;

use super::{workspace_json, ID_A, ID_B};
use crate::catalogue::parse_catalogue;
use crate::*;

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
