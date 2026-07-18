use super::*;
use crate::workspace::catalogue::{Workspace, WorkspaceCatalogue, WorkspaceCatalogueStore};

fn workspace(id: &str, name: &str, todo_path: &str) -> Workspace {
    Workspace::new(
        id.into(),
        name.into(),
        "blue".into(),
        todo_path.into(),
        "2026-01-01T00:00:00+00:00".into(),
    )
}

fn catalogue_path(directory: &tempfile::TempDir) -> PathBuf {
    directory.path().join("workspaces.toml")
}

fn save_catalogue(path: PathBuf, catalogue: &WorkspaceCatalogue) {
    WorkspaceCatalogueStore::new(path).save(catalogue).unwrap();
}

#[test]
fn restoring_without_an_active_workspace_returns_no_active_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let lifecycle = WorkspaceLifecycle::new(catalogue_path(&directory));

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

    let snapshot = WorkspaceLifecycle::new(path).restore().unwrap();

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

    let snapshot = WorkspaceLifecycle::new(path).restore().unwrap();

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
    let lifecycle = WorkspaceLifecycle::new(path);

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
    let lifecycle = WorkspaceLifecycle::new(path.clone());

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
fn creation_rejects_invalid_input_before_touching_persistence() {
    let directory = tempfile::tempdir().unwrap();
    let path = catalogue_path(&directory);
    std::fs::write(&path, "malformed = [toml").unwrap();
    let todo_path = directory.path().join("work.todo");
    std::fs::write(&todo_path, "Task").unwrap();
    let lifecycle = WorkspaceLifecycle::new(path);

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
    let lifecycle = WorkspaceLifecycle::new(path.clone());

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

    let snapshot = WorkspaceLifecycle::new(path.clone())
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

    let error = WorkspaceLifecycle::new(path.clone())
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

    let snapshot = WorkspaceLifecycle::new(path.clone())
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

    let snapshot = WorkspaceLifecycle::new(path)
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

    let snapshot = WorkspaceLifecycle::new(path)
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

    let error = WorkspaceLifecycle::new(path.clone())
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

    let result = WorkspaceLifecycle::new(path.clone()).delete(saved.id().into());

    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    assert_eq!(
        WorkspaceCatalogueStore::new(path).load().unwrap(),
        catalogue
    );
}
