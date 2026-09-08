use super::*;
use crate::workspace::catalogue::{Workspace, WorkspaceCatalogue, WorkspaceCatalogueStore};

fn workspace(id: &str, name: &str, todo_path: &str) -> Workspace {
    Workspace::fixture(id, name, todo_path)
}

fn catalogue_path(directory: &tempfile::TempDir) -> PathBuf {
    directory.path().join("workspaces.toml")
}

fn save_catalogue(path: PathBuf, catalogue: &WorkspaceCatalogue) {
    WorkspaceCatalogueStore::new(path).save(catalogue).unwrap();
}

fn applied_todo_file(outcome: WorkspaceSessionOperationOutcome) -> TodoFile {
    let WorkspaceSessionOperationOutcome::Applied {
        snapshot: WorkspaceSessionSnapshot::ActiveWorkspaceLoaded { todo_file, .. },
    } = outcome
    else {
        panic!("expected an applied loaded Workspace session");
    };
    todo_file
}

fn lifecycle_with_active_todo(
    directory: &tempfile::TempDir,
    contents: &str,
) -> (WorkspaceSession, PathBuf) {
    let path = catalogue_path(directory);
    let todo_path = directory.path().join("work.todo");
    std::fs::write(&todo_path, contents).unwrap();
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue
        .add(workspace(
            "550e8400-e29b-41d4-a716-446655440000",
            "Work",
            &todo_path.to_string_lossy(),
        ))
        .unwrap();
    save_catalogue(path.clone(), &catalogue);
    (WorkspaceSession::new(path), todo_path)
}

#[test]
fn deleting_an_open_todo_item_removes_its_line_and_returns_the_todo_file() {
    let directory = tempfile::tempdir().unwrap();
    let original =
        "# keep this skipped line\r\n\r\n(A) 2026-07-10 Buy milk +Home\r\nKeep me open\r\n";
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, original);

    let todo_file = applied_todo_file(
        lifecycle
            .delete_todo_item(3, "(A) 2026-07-10 Buy milk +Home".into())
            .unwrap(),
    );

    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "# keep this skipped line\r\n\r\nKeep me open\r\n"
    );
    assert!(todo_file
        .items
        .iter()
        .all(|item| item.description != "Buy milk"));
    let remaining = todo_file
        .items
        .iter()
        .find(|item| item.description == "Keep me open")
        .unwrap();
    assert_eq!(remaining.line_number, 3);
}

#[test]
fn deleting_a_completed_todo_item_removes_its_line() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(
        &directory,
        "x 2026-07-18 2026-07-10 Buy milk +Home\nKeep me open\n",
    );

    let todo_file = applied_todo_file(
        lifecycle
            .delete_todo_item(1, "x 2026-07-18 2026-07-10 Buy milk +Home".into())
            .unwrap(),
    );

    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "Keep me open\n"
    );
    assert_eq!(todo_file.items.len(), 1);
    assert_eq!(todo_file.items[0].line_number, 1);
    assert_eq!(todo_file.items[0].description, "Keep me open");
}

#[test]
fn a_stale_todo_item_is_not_deleted_after_an_external_edit() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, "Buy milk\nKeep me open\n");
    std::fs::write(&todo_path, "Inserted externally\nBuy milk\nKeep me open\n").unwrap();

    let outcome = lifecycle.delete_todo_item(1, "Buy milk".into()).unwrap();

    assert!(matches!(
        outcome,
        WorkspaceSessionOperationOutcome::Conflict { .. }
    ));
    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "Inserted externally\nBuy milk\nKeep me open\n"
    );
}

#[test]
fn deleting_the_last_todo_item_leaves_an_empty_todo_file() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, "Buy milk\n");

    let todo_file = applied_todo_file(lifecycle.delete_todo_item(1, "Buy milk".into()).unwrap());

    assert_eq!(std::fs::read_to_string(todo_path).unwrap(), "");
    assert!(todo_file.items.is_empty());
}

#[test]
fn completing_a_todo_item_updates_only_its_line_and_returns_the_todo_file() {
    let directory = tempfile::tempdir().unwrap();
    let original =
        "# keep this skipped line\r\n\r\n(A) 2026-07-10 Buy milk +Home\r\nKeep me open\r\n";
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, original);

    let todo_file = applied_todo_file(
        lifecycle
            .set_todo_item_completion(
                3,
                "(A) 2026-07-10 Buy milk +Home".into(),
                true,
                chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
            )
            .unwrap(),
    );

    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "# keep this skipped line\r\n\r\nx 2026-07-18 2026-07-10 Buy milk +Home\r\nKeep me open\r\n"
    );
    let completed = todo_file
        .items
        .iter()
        .find(|item| item.line_number == 3)
        .unwrap();
    assert!(completed.completed);
    assert_eq!(completed.completion_date.as_deref(), Some("2026-07-18"));
    assert_eq!(completed.priority, None);
}

#[test]
fn uncompleting_a_todo_item_preserves_its_creation_date_and_content() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(
        &directory,
        "x 2026-07-18 2026-07-10 Buy milk +Home due:2026-07-20\n",
    );

    let todo_file = applied_todo_file(
        lifecycle
            .set_todo_item_completion(
                1,
                "x 2026-07-18 2026-07-10 Buy milk +Home due:2026-07-20".into(),
                false,
                chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
            )
            .unwrap(),
    );

    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "2026-07-10 Buy milk +Home due:2026-07-20\n"
    );
    let item = &todo_file.items[0];
    assert!(!item.completed);
    assert_eq!(item.creation_date.as_deref(), Some("2026-07-10"));
    assert_eq!(item.projects, vec!["Home"]);
    assert_eq!(
        item.metadata.get("due").map(String::as_str),
        Some("2026-07-20")
    );
}

#[test]
fn a_stale_todo_item_is_not_completed_after_an_external_edit() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, "Buy milk\nKeep me open\n");
    std::fs::write(&todo_path, "Inserted externally\nBuy milk\nKeep me open\n").unwrap();

    let outcome = lifecycle
        .set_todo_item_completion(
            1,
            "Buy milk".into(),
            true,
            chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
        )
        .unwrap();

    assert!(matches!(
        outcome,
        WorkspaceSessionOperationOutcome::Conflict { .. }
    ));
    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "Inserted externally\nBuy milk\nKeep me open\n"
    );
}

#[test]
fn a_todo_item_conflict_returns_the_latest_workspace_session_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let (session, todo_path) = lifecycle_with_active_todo(&directory, "Buy milk\n");
    std::fs::write(&todo_path, "Buy oat milk\n").unwrap();

    let outcome = session
        .set_todo_item_completion(
            1,
            "Buy milk".into(),
            true,
            chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
        )
        .unwrap();

    let WorkspaceSessionOperationOutcome::Conflict { snapshot, .. } = outcome else {
        panic!("expected a conflict outcome");
    };
    let WorkspaceSessionSnapshot::ActiveWorkspaceLoaded { todo_file, .. } = snapshot else {
        panic!("expected the latest loaded Workspace session");
    };
    assert_eq!(todo_file.items[0].description, "Buy oat milk");
}

#[test]
fn completing_without_a_creation_date_adds_only_the_completion_date() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, "Buy milk\n");

    lifecycle
        .set_todo_item_completion(
            1,
            "Buy milk".into(),
            true,
            chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
        )
        .unwrap();

    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "x 2026-07-18 Buy milk\n"
    );
}

#[test]
fn uncompleting_without_a_completion_date_removes_only_the_marker() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, "x Buy milk\n");

    lifecycle
        .set_todo_item_completion(
            1,
            "x Buy milk".into(),
            false,
            chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
        )
        .unwrap();

    assert_eq!(std::fs::read_to_string(todo_path).unwrap(), "Buy milk\n");
}

#[cfg(unix)]
#[test]
fn a_failed_atomic_write_leaves_the_todo_file_unchanged() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, "Buy milk\n");
    let original_permissions = std::fs::metadata(directory.path()).unwrap().permissions();
    let mut read_only_permissions = original_permissions.clone();
    read_only_permissions.set_mode(0o500);
    std::fs::set_permissions(directory.path(), read_only_permissions).unwrap();

    let result = lifecycle.set_todo_item_completion(
        1,
        "Buy milk".into(),
        true,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
    );

    std::fs::set_permissions(directory.path(), original_permissions).unwrap();
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("failed to write Todo file atomically"));
    assert_eq!(std::fs::read_to_string(todo_path).unwrap(), "Buy milk\n");
}

#[test]
fn completion_round_trip_preserves_whitespace_while_removing_priority() {
    let directory = tempfile::tempdir().unwrap();
    let (lifecycle, todo_path) = lifecycle_with_active_todo(&directory, "  (A) Buy milk  \n");

    lifecycle
        .set_todo_item_completion(
            1,
            "  (A) Buy milk  ".into(),
            true,
            chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
        )
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&todo_path).unwrap(),
        "x 2026-07-18   Buy milk  \n"
    );

    lifecycle
        .set_todo_item_completion(
            1,
            "x 2026-07-18   Buy milk  ".into(),
            false,
            chrono::NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
        )
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "  Buy milk  \n"
    );
}

#[test]
fn restoring_without_an_active_workspace_returns_no_active_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let lifecycle = WorkspaceSession::new(catalogue_path(&directory));

    assert_eq!(
        lifecycle.restore().unwrap(),
        WorkspaceSessionSnapshot::NoActiveWorkspace {
            catalogue: WorkspaceCatalogue::default()
        }
    );
}

#[test]
fn session_snapshot_serializes_with_the_shared_status_tag() {
    let serialized = serde_json::to_value(WorkspaceSessionSnapshot::NoActiveWorkspace {
        catalogue: WorkspaceCatalogue::default(),
    })
    .unwrap();

    assert_eq!(serialized["status"], "no_active_workspace");
    assert!(serialized.get("todo_file").is_none());
    assert!(serialized.get("warning").is_none());
}

#[test]
fn rust_serialization_matches_the_shared_workspace_session_contract_fixture() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../src/lib/modules/workspace/domain/workspace-session-contract.fixture.json"
    ))
    .unwrap();
    let empty = WorkspaceSessionSnapshot::NoActiveWorkspace {
        catalogue: WorkspaceCatalogue::default(),
    };
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue
        .add(workspace(
            "550e8400-e29b-41d4-a716-446655440000",
            "Work",
            "/tmp/work.todo",
        ))
        .unwrap();
    let loaded = WorkspaceSessionSnapshot::ActiveWorkspaceLoaded {
        catalogue: catalogue.clone(),
        todo_file: TodoFile {
            path: "/tmp/work.todo".into(),
            items: vec![crate::todo_txt::types::TodoItem {
                line_number: 1,
                raw: "(A) 2026-01-01 Plan release +Tuxedo @computer due:2026-01-02".into(),
                completed: false,
                priority: Some('A'),
                creation_date: Some("2026-01-01".into()),
                completion_date: None,
                description: "Plan release".into(),
                projects: vec!["Tuxedo".into()],
                contexts: vec!["computer".into()],
                metadata: std::collections::HashMap::from([("due".into(), "2026-01-02".into())]),
            }],
            skipped: vec![crate::todo_txt::types::SkippedLine {
                line_number: 2,
                raw: "2026-99-99 Invalid date".into(),
                reason: "date must use YYYY-MM-DD format".into(),
            }],
        },
    };
    let unavailable = WorkspaceSessionSnapshot::ActiveWorkspaceUnavailable {
        catalogue,
        warning: "Saved workspace could not be opened".into(),
    };

    assert_eq!(
        fixture["snapshots"],
        serde_json::to_value([empty.clone(), loaded.clone(), unavailable]).unwrap()
    );
    assert_eq!(
        fixture["outcomes"],
        serde_json::to_value([
            WorkspaceSessionOperationOutcome::Applied { snapshot: empty },
            WorkspaceSessionOperationOutcome::Conflict {
                message: "Todo item changed externally".into(),
                snapshot: loaded,
            },
            WorkspaceSessionOperationOutcome::Rejected {
                message: "workspace does not exist".into(),
            },
        ])
        .unwrap()
    );
}

#[test]
fn restoring_a_loadable_active_workspace_returns_its_todo_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let todo_path = directory.path().join("work.todo");
    std::fs::write(&todo_path, "Resume work").unwrap();
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue
        .add(workspace(
            "550e8400-e29b-41d4-a716-446655440000",
            "Work",
            &todo_path.to_string_lossy(),
        ))
        .unwrap();
    save_catalogue(path.clone(), &catalogue);

    let snapshot = WorkspaceSession::new(path).restore().unwrap();

    let WorkspaceSessionSnapshot::ActiveWorkspaceLoaded {
        catalogue: restored,
        todo_file,
    } = snapshot
    else {
        panic!("expected a loaded Active workspace");
    };
    assert_eq!(restored, catalogue);
    assert_eq!(todo_file.path, todo_path.to_string_lossy());
}

#[test]
fn restoring_an_unavailable_active_workspace_returns_a_warning() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue
        .add(workspace(
            "550e8400-e29b-41d4-a716-446655440000",
            "Work",
            &directory.path().join("missing.todo").to_string_lossy(),
        ))
        .unwrap();
    save_catalogue(path.clone(), &catalogue);

    let snapshot = WorkspaceSession::new(path).restore().unwrap();

    let WorkspaceSessionSnapshot::ActiveWorkspaceUnavailable {
        catalogue: restored,
        warning,
    } = snapshot
    else {
        panic!("expected an unavailable Active workspace");
    };
    assert_eq!(restored, catalogue);
    assert!(warning.contains("Saved workspace could not be opened"));
}

#[test]
fn creation_loads_the_todo_file_before_reading_the_catalogue() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    std::fs::write(&path, "malformed = [toml").unwrap();
    let lifecycle = WorkspaceSession::new(path);

    let error = lifecycle
        .create(
            "Work".into(),
            "blue".into(),
            directory
                .path()
                .join("missing.todo")
                .to_string_lossy()
                .into(),
        )
        .unwrap_err();

    assert!(error.to_string().contains("failed to load Todo file"));
}

#[test]
fn successful_creation_persists_a_loaded_active_workspace() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let todo_path = directory.path().join("work.todo");
    std::fs::write(&todo_path, "Prepare release").unwrap();
    let lifecycle = WorkspaceSession::new(path.clone());

    let snapshot = lifecycle
        .create(
            "  Work  ".into(),
            "blue".into(),
            todo_path.to_string_lossy().into(),
        )
        .unwrap();

    let WorkspaceSessionSnapshot::ActiveWorkspaceLoaded {
        catalogue,
        todo_file,
    } = snapshot
    else {
        panic!("expected a loaded Active workspace");
    };
    assert_eq!(
        catalogue.active_workspace().unwrap().todo_path(),
        todo_path.to_string_lossy()
    );
    assert_eq!(todo_file.items.len(), 1);
    assert_eq!(
        WorkspaceCatalogueStore::new(path).load().unwrap(),
        catalogue
    );
}

#[test]
fn concurrent_workspace_creations_are_serialized_by_the_workspace_session() {
    use std::sync::{Arc, Barrier};

    let directory = tempfile::tempdir().unwrap();
    let session = Arc::new(WorkspaceSession::new(catalogue_path(&directory)));
    let barrier = Arc::new(Barrier::new(7));
    let mut handles = Vec::new();

    for index in 0..6 {
        let todo_path = directory.path().join(format!("workspace-{index}.todo"));
        std::fs::write(&todo_path, format!("Todo {index}")).unwrap();
        let session = Arc::clone(&session);
        let barrier = Arc::clone(&barrier);
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            session
                .create(
                    format!("Workspace {index}"),
                    "blue".into(),
                    todo_path.to_string_lossy().into(),
                )
                .unwrap();
        }));
    }

    barrier.wait();
    for handle in handles {
        handle.join().unwrap();
    }

    let snapshot = session.restore().unwrap();
    let WorkspaceSessionSnapshot::ActiveWorkspaceLoaded { catalogue, .. } = snapshot else {
        panic!("expected a loaded Active workspace");
    };
    let serialized = serde_json::to_value(catalogue).unwrap();
    assert_eq!(serialized["workspaces"].as_array().unwrap().len(), 6);
}

#[test]
fn creation_rejects_invalid_input_before_touching_persistence() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    std::fs::write(&path, "malformed = [toml").unwrap();
    let todo_path = directory.path().join("work.todo");
    std::fs::write(&todo_path, "Task").unwrap();
    let lifecycle = WorkspaceSession::new(path);

    let empty_name = lifecycle
        .create(
            "   ".into(),
            "blue".into(),
            todo_path.to_string_lossy().into(),
        )
        .unwrap_err();
    let invalid_color = lifecycle
        .create(
            "Work".into(),
            "grey".into(),
            todo_path.to_string_lossy().into(),
        )
        .unwrap_err();

    assert!(empty_name.to_string().contains("workspace name"));
    assert!(invalid_color
        .to_string()
        .contains("unsupported workspace color"));
}

#[test]
fn creation_rejects_unparseable_and_duplicate_workspaces_without_changing_catalogue() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let existing_path = directory.path().join("existing.todo");
    let duplicate_name_path = directory.path().join("duplicate-name.todo");
    let invalid_path = directory.path().join("invalid.todo");
    std::fs::write(&existing_path, "Existing task").unwrap();
    std::fs::write(&duplicate_name_path, "Other task").unwrap();
    std::fs::write(&invalid_path, "x 2025-13-40 impossible").unwrap();
    let existing = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Existing",
        &existing_path.to_string_lossy(),
    );
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue.add(existing).unwrap();
    save_catalogue(path.clone(), &catalogue);
    let lifecycle = WorkspaceSession::new(path.clone());

    let unparseable = lifecycle
        .create(
            "Invalid".into(),
            "blue".into(),
            invalid_path.to_string_lossy().into(),
        )
        .unwrap_err();
    let duplicate_name = lifecycle
        .create(
            "existing".into(),
            "blue".into(),
            duplicate_name_path.to_string_lossy().into(),
        )
        .unwrap_err();
    let duplicate_file = lifecycle
        .create(
            "Other".into(),
            "blue".into(),
            existing_path.to_string_lossy().into(),
        )
        .unwrap_err();

    assert!(unparseable
        .to_string()
        .contains("selected Todo file could not be parsed"));
    assert!(duplicate_name
        .to_string()
        .contains("duplicate workspace name"));
    assert!(duplicate_file.to_string().contains("duplicate todo file"));
    assert_eq!(
        WorkspaceCatalogueStore::new(path).load().unwrap(),
        catalogue
    );
}

#[test]
fn successful_switch_persists_and_returns_the_new_active_workspace() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let first_path = directory.path().join("first.todo");
    let second_path = directory.path().join("second.todo");
    std::fs::write(&first_path, "First").unwrap();
    std::fs::write(&second_path, "Second").unwrap();
    let first = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "First",
        &first_path.to_string_lossy(),
    );
    let second = workspace(
        "550e8400-e29b-41d4-a716-446655440001",
        "Second",
        &second_path.to_string_lossy(),
    );
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue.add(first).unwrap();
    catalogue.add(second.clone()).unwrap();
    save_catalogue(path.clone(), &catalogue);

    let snapshot = WorkspaceSession::new(path.clone())
        .switch(second.id().into())
        .unwrap();

    let WorkspaceSessionSnapshot::ActiveWorkspaceLoaded { todo_file, .. } = snapshot else {
        panic!("expected a loaded Active workspace");
    };
    assert_eq!(todo_file.path, second_path.to_string_lossy());
    assert_eq!(
        WorkspaceCatalogueStore::new(path)
            .load()
            .unwrap()
            .active_workspace()
            .unwrap()
            .id(),
        second.id()
    );
}

#[test]
fn failed_switch_keeps_the_saved_active_workspace() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let current_path = directory.path().join("current.todo");
    std::fs::write(&current_path, "Current task").unwrap();
    let current = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Current",
        &current_path.to_string_lossy(),
    );
    let unavailable = workspace(
        "550e8400-e29b-41d4-a716-446655440001",
        "Unavailable",
        &directory.path().join("missing.todo").to_string_lossy(),
    );
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue.add(current.clone()).unwrap();
    catalogue.add(unavailable.clone()).unwrap();
    catalogue.activate(current.id()).unwrap();
    save_catalogue(path.clone(), &catalogue);

    let error = WorkspaceSession::new(path.clone())
        .switch(unavailable.id().into())
        .unwrap_err();

    assert!(error.to_string().contains("failed to load Todo file"));
    assert_eq!(
        WorkspaceCatalogueStore::new(path)
            .load()
            .unwrap()
            .active_workspace()
            .unwrap()
            .id(),
        current.id()
    );
}

#[test]
fn deleting_the_active_workspace_removes_only_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let todo_path = directory.path().join("work.todo");
    std::fs::write(&todo_path, "Keep this task").unwrap();
    let active = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Work",
        &todo_path.to_string_lossy(),
    );
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue.add(active.clone()).unwrap();
    save_catalogue(path.clone(), &catalogue);

    let snapshot = WorkspaceSession::new(path.clone())
        .delete(active.id().into())
        .unwrap();

    assert!(matches!(
        snapshot,
        WorkspaceSessionSnapshot::NoActiveWorkspace { .. }
    ));
    assert!(WorkspaceCatalogueStore::new(path)
        .load()
        .unwrap()
        .workspace(active.id())
        .is_none());
    assert_eq!(
        std::fs::read_to_string(todo_path).unwrap(),
        "Keep this task"
    );
}

#[test]
fn deleting_an_inactive_workspace_refreshes_the_active_todo_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let active_path = directory.path().join("active.todo");
    std::fs::write(&active_path, "Refreshed task").unwrap();
    let inactive = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Inactive",
        "/tmp/inactive.todo",
    );
    let active = workspace(
        "550e8400-e29b-41d4-a716-446655440001",
        "Active",
        &active_path.to_string_lossy(),
    );
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue.add(inactive.clone()).unwrap();
    catalogue.add(active.clone()).unwrap();
    save_catalogue(path.clone(), &catalogue);

    let snapshot = WorkspaceSession::new(path)
        .delete(inactive.id().into())
        .unwrap();

    let WorkspaceSessionSnapshot::ActiveWorkspaceLoaded { todo_file, .. } = snapshot else {
        panic!("expected a loaded Active workspace");
    };
    assert_eq!(todo_file.items.len(), 1);
}

#[test]
fn post_deletion_todo_failure_is_a_successful_unavailable_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let inactive = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Inactive",
        "/tmp/inactive.todo",
    );
    let active = workspace(
        "550e8400-e29b-41d4-a716-446655440001",
        "Active",
        &directory.path().join("missing.todo").to_string_lossy(),
    );
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue.add(inactive.clone()).unwrap();
    catalogue.add(active).unwrap();
    save_catalogue(path.clone(), &catalogue);

    let snapshot = WorkspaceSession::new(path)
        .delete(inactive.id().into())
        .unwrap();

    assert!(matches!(
        snapshot,
        WorkspaceSessionSnapshot::ActiveWorkspaceUnavailable { .. }
    ));
}

#[test]
fn unknown_deletion_leaves_the_catalogue_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let catalogue = WorkspaceCatalogue::default();
    save_catalogue(path.clone(), &catalogue);

    let error = WorkspaceSession::new(path.clone())
        .delete("unknown".into())
        .unwrap_err();

    assert!(error.to_string().contains("workspace does not exist"));
    assert_eq!(
        WorkspaceCatalogueStore::new(path).load().unwrap(),
        catalogue
    );
}

#[cfg(unix)]
#[test]
fn failed_deletion_catalogue_write_leaves_the_catalogue_unchanged() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    let saved = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Saved",
        "/tmp/saved.todo",
    );
    let mut catalogue = WorkspaceCatalogue::default();
    catalogue.add(saved.clone()).unwrap();
    save_catalogue(path.clone(), &catalogue);
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o500)).unwrap();

    let result = WorkspaceSession::new(path.clone()).delete(saved.id().into());

    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    assert_eq!(
        WorkspaceCatalogueStore::new(path).load().unwrap(),
        catalogue
    );
}
