use super::*;

fn workspace(id: &str, name: &str, todo_path: &str) -> Workspace {
    Workspace::fixture(id, name, todo_path)
}

fn store(directory: &tempfile::TempDir) -> WorkspaceCatalogueStore {
    WorkspaceCatalogueStore::new(directory.path().join("workspaces.toml"))
}

#[test]
fn missing_catalogue_loads_as_default() {
    let directory = tempfile::tempdir().unwrap();

    assert_eq!(
        store(&directory).load().unwrap(),
        WorkspaceCatalogue::default()
    );
}

#[test]
fn catalogue_round_trips_through_toml_without_task_data() {
    let directory = tempfile::tempdir().unwrap();
    let store = store(&directory);
    let mut catalogue = WorkspaceCatalogue::default();
    let saved = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Work",
        "/tmp/work.todo",
    );
    catalogue.add(saved.clone()).unwrap();

    store.save(&catalogue).unwrap();

    assert_eq!(store.load().unwrap(), catalogue);
    let serialized = std::fs::read_to_string(directory.path().join("workspaces.toml")).unwrap();
    assert!(!serialized.contains("items"));
}

#[test]
fn atomic_save_replaces_a_previous_valid_catalogue() {
    let directory = tempfile::tempdir().unwrap();
    let store = store(&directory);
    let first = WorkspaceCatalogue::default();
    let mut second = WorkspaceCatalogue::default();
    second
        .add(workspace(
            "550e8400-e29b-41d4-a716-446655440000",
            "Work",
            "/tmp/work.todo",
        ))
        .unwrap();

    store.save(&first).unwrap();
    store.save(&second).unwrap();

    assert_eq!(store.load().unwrap(), second);
}

#[test]
fn malformed_catalogue_is_rejected_and_left_untouched() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspaces.toml");
    let malformed = "this is not = [valid toml";
    std::fs::write(&path, malformed).unwrap();

    assert!(store(&directory).load().is_err());
    assert_eq!(std::fs::read_to_string(path).unwrap(), malformed);
}

#[test]
fn persisted_catalogue_validation_rejects_every_metadata_invariant() {
    let valid = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Work",
        "/tmp/work.todo",
    );
    let invalid_catalogues = [
        WorkspaceCatalogue {
            version: 2,
            active_workspace_id: None,
            workspaces: vec![],
        },
        WorkspaceCatalogue {
            version: 1,
            active_workspace_id: Some("missing".into()),
            workspaces: vec![valid.clone()],
        },
        WorkspaceCatalogue {
            version: 1,
            active_workspace_id: None,
            workspaces: vec![Workspace {
                id: "bad".into(),
                ..valid.clone()
            }],
        },
        WorkspaceCatalogue {
            version: 1,
            active_workspace_id: None,
            workspaces: vec![Workspace {
                name: " Work ".into(),
                ..valid.clone()
            }],
        },
        WorkspaceCatalogue {
            version: 1,
            active_workspace_id: None,
            workspaces: vec![Workspace {
                color: "grey".into(),
                ..valid.clone()
            }],
        },
        WorkspaceCatalogue {
            version: 1,
            active_workspace_id: None,
            workspaces: vec![Workspace {
                todo_path: "".into(),
                ..valid.clone()
            }],
        },
        WorkspaceCatalogue {
            version: 1,
            active_workspace_id: None,
            workspaces: vec![Workspace {
                created_at: "yesterday".into(),
                ..valid.clone()
            }],
        },
    ];

    for catalogue in invalid_catalogues {
        let directory = tempfile::tempdir().unwrap();
        assert!(store(&directory).save(&catalogue).is_err());
    }
}

#[test]
fn persisted_catalogue_validation_rejects_duplicate_ids_names_and_paths() {
    let first = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Work",
        "/tmp/work.todo",
    );
    let duplicates = [
        Workspace {
            name: "Personal".into(),
            todo_path: "/tmp/personal.todo".into(),
            ..first.clone()
        },
        Workspace {
            id: "550e8400-e29b-41d4-a716-446655440001".into(),
            name: "work".into(),
            todo_path: "/tmp/personal.todo".into(),
            ..first.clone()
        },
        Workspace {
            id: "550e8400-e29b-41d4-a716-446655440002".into(),
            name: "Personal".into(),
            ..first.clone()
        },
    ];

    for duplicate in duplicates {
        let directory = tempfile::tempdir().unwrap();
        let catalogue = WorkspaceCatalogue {
            version: 1,
            active_workspace_id: None,
            workspaces: vec![first.clone(), duplicate],
        };
        assert!(store(&directory).save(&catalogue).is_err());
    }
}

#[test]
fn deliberate_mutations_enforce_uniqueness_activation_and_removal() {
    let mut catalogue = WorkspaceCatalogue::default();
    let work = workspace(
        "550e8400-e29b-41d4-a716-446655440000",
        "Work",
        "/tmp/work.todo",
    );
    catalogue.add(work.clone()).unwrap();

    assert!(catalogue
        .add(Workspace {
            id: "550e8400-e29b-41d4-a716-446655440001".into(),
            ..work.clone()
        })
        .is_err());
    assert!(catalogue
        .add(Workspace {
            id: "550e8400-e29b-41d4-a716-446655440002".into(),
            name: "Personal".into(),
            ..work.clone()
        })
        .is_err());
    assert!(catalogue.activate("missing").is_err());
    assert!(!catalogue.remove("missing"));
    assert!(catalogue.remove(work.id()));
    assert!(catalogue.active_workspace().is_none());
}
