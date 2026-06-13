use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn default_workspace_config_has_no_root() {
    assert_eq!(
        WorkspaceConfig::default(),
        WorkspaceConfig {
            version: WORKSPACE_CONFIG_VERSION,
            root: None,
        }
    );
}

#[test]
fn workspace_config_round_trips_through_toml() {
    let config = WorkspaceConfig {
        version: WORKSPACE_CONFIG_VERSION,
        root: Some("/tmp/todos".to_string()),
    };

    let serialized = toml::to_string(&config).unwrap();
    let deserialized: WorkspaceConfig = toml::from_str(&serialized).unwrap();

    assert_eq!(deserialized, config);
}

#[test]
fn todo_path_is_derived_from_workspace_root() {
    let workspace_file = WorkspaceFile::Todo;
    let path = workspace_file.path_for_root("/tmp/todos");

    assert_eq!(path, PathBuf::from("/tmp/todos").join("todo.txt"));
    assert_eq!(todo_path_for_root("/tmp/todos"), path);
}

#[test]
fn rejects_file_as_workspace_root() {
    let temp_dir = unique_temp_dir("rejects-file-root");
    std::fs::create_dir_all(&temp_dir).unwrap();
    let file_path = temp_dir.join("todo.txt");
    std::fs::write(&file_path, "Test task").unwrap();

    let result = validate_workspace_root(&file_path.to_string_lossy());

    assert!(result
        .unwrap_err()
        .contains("workspace root is not a directory"));

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn load_workspace_reports_missing_todo_file() {
    let temp_dir = unique_temp_dir("missing-todo");
    std::fs::create_dir_all(&temp_dir).unwrap();

    let result = load_workspace_from_root(temp_dir.to_string_lossy().to_string()).unwrap();

    assert!(!result.todo_exists);
    assert!(result.todo_file.is_none());
    assert_eq!(
        result.todo_path,
        temp_dir.join("todo.txt").to_string_lossy()
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn load_workspace_rejects_missing_workspace_root() {
    let temp_dir = unique_temp_dir("missing-root");

    let error = load_workspace_from_root(temp_dir.to_string_lossy().to_string()).unwrap_err();

    assert!(error.contains("workspace directory does not exist"));
}

#[test]
fn load_workspace_parses_existing_todo_file() {
    let temp_dir = unique_temp_dir("existing-todo");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "(A) Test task +Tuxedo").unwrap();

    let result = load_workspace_from_root(temp_dir.to_string_lossy().to_string()).unwrap();

    assert!(result.todo_exists);
    assert_eq!(result.todo_file.unwrap().items.len(), 1);

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn missing_workspace_config_file_loads_default_config() {
    let temp_dir = unique_temp_dir("missing-config");
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("workspace.toml");

    let config = load_workspace_config_from_path(config_path).unwrap();

    assert_eq!(config, WorkspaceConfig::default());

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn saved_workspace_config_restores_root_and_workspace_load_parses_todo_file() {
    let temp_dir = unique_temp_dir("restore-root");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "(A) Restored task +Tuxedo").unwrap();
    let config_path = temp_dir.join("workspace.toml");
    let saved_config = WorkspaceConfig {
        version: WORKSPACE_CONFIG_VERSION,
        root: Some(temp_dir.to_string_lossy().to_string()),
    };

    save_workspace_config_to_path(config_path.clone(), &saved_config).unwrap();
    let restored_config = load_workspace_config_from_path(config_path).unwrap();
    let workspace =
        load_workspace_from_root(restored_config.root.clone().expect("saved root")).unwrap();

    assert_eq!(restored_config, saved_config);
    assert!(workspace.todo_exists);
    assert_eq!(
        workspace.todo_file.unwrap().items[0].description,
        "Restored task"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn append_todo_line_creates_missing_todo_file() {
    let temp_dir = unique_temp_dir("append-creates");
    std::fs::create_dir_all(&temp_dir).unwrap();

    append_todo_line_for_root(&temp_dir.to_string_lossy(), "(A) New task".to_string()).unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "(A) New task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn append_todo_line_preserves_existing_lines() {
    let temp_dir = unique_temp_dir("append-preserves");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "First task\nbad line\n").unwrap();

    append_todo_line_for_root(&temp_dir.to_string_lossy(), "Second task".to_string()).unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nbad line\nSecond task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn replace_todo_line_updates_guarded_line_and_preserves_other_lines() {
    let temp_dir = unique_temp_dir("replace-guarded");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\nSecond task\nThird task\n",
    )
    .unwrap();

    replace_todo_line_for_root(
        &temp_dir.to_string_lossy(),
        2,
        "Second task",
        "Updated second task".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nUpdated second task\nThird task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn replace_todo_line_rejects_stale_raw_line_guard() {
    let temp_dir = unique_temp_dir("replace-stale");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "First task\nChanged task\n").unwrap();

    let error = replace_todo_line_for_root(
        &temp_dir.to_string_lossy(),
        2,
        "Old task",
        "Updated task".to_string(),
    )
    .unwrap_err();

    assert!(error.to_string().contains("todo line 2 changed on disk"));
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nChanged task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn remove_todo_line_deletes_guarded_line_and_preserves_other_lines() {
    let temp_dir = unique_temp_dir("remove-guarded");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\nSecond task\nThird task\n",
    )
    .unwrap();

    remove_todo_line_for_root(&temp_dir.to_string_lossy(), 2, "Second task").unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nThird task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn guarded_todo_line_rejects_zero_and_out_of_range_line_numbers() {
    let temp_dir = unique_temp_dir("guard-invalid");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "First task\n").unwrap();

    let zero_error = replace_todo_line_for_root(
        &temp_dir.to_string_lossy(),
        0,
        "First task",
        "Updated task".to_string(),
    )
    .unwrap_err();
    let range_error = replace_todo_line_for_root(
        &temp_dir.to_string_lossy(),
        2,
        "Missing task",
        "Updated task".to_string(),
    )
    .unwrap_err();

    assert!(zero_error
        .to_string()
        .contains("todo line number is invalid: 0"));
    assert!(range_error
        .to_string()
        .contains("todo line number is invalid: 2"));
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn read_todo_lines_rejects_todo_path_that_is_directory() {
    let temp_dir = unique_temp_dir("todo-path-directory");
    std::fs::create_dir_all(temp_dir.join("todo.txt")).unwrap();

    let error = read_todo_lines_for_root(&temp_dir.to_string_lossy()).unwrap_err();

    assert!(error.to_string().contains("todo file path is not a file"));

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn append_todo_item_creates_todo_file_and_returns_reloaded_workspace() {
    let temp_dir = unique_temp_dir("append-command-creates");
    std::fs::create_dir_all(&temp_dir).unwrap();

    let result = append_todo_item(
        temp_dir.to_string_lossy().to_string(),
        "(A) Capture task +Tuxedo @computer".to_string(),
    )
    .unwrap();

    assert!(result.todo_exists);
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "(A) Capture task +Tuxedo @computer\n"
    );
    let todo_file = result.todo_file.unwrap();
    assert_eq!(todo_file.items.len(), 1);
    assert_eq!(todo_file.items[0].line_number, 1);
    assert_eq!(todo_file.items[0].priority, Some('A'));
    assert_eq!(todo_file.items[0].description, "Capture task");
    assert_eq!(todo_file.items[0].projects, vec!["Tuxedo"]);
    assert_eq!(todo_file.items[0].contexts, vec!["computer"]);

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn append_todo_item_extends_todo_file_without_discarding_existing_lines() {
    let temp_dir = unique_temp_dir("append-command-extends");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "Existing task\n2024-99-99 bad date\n",
    )
    .unwrap();

    let result = append_todo_item(
        temp_dir.to_string_lossy().to_string(),
        "Second task due:2026-01-02".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "Existing task\n2024-99-99 bad date\nSecond task due:2026-01-02\n"
    );
    let todo_file = result.todo_file.unwrap();
    assert_eq!(todo_file.items.len(), 2);
    assert_eq!(todo_file.skipped.len(), 1);
    assert_eq!(todo_file.items[1].line_number, 3);
    assert_eq!(todo_file.items[1].description, "Second task");

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn append_todo_item_rejects_invalid_todo_line_without_writing() {
    let temp_dir = unique_temp_dir("append-command-invalid");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "Existing task\n").unwrap();

    let error = append_todo_item(
        temp_dir.to_string_lossy().to_string(),
        "2024-99-99 bad date".to_string(),
    )
    .unwrap_err();

    assert_eq!(error, "date must use YYYY-MM-DD format");
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "Existing task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn append_todo_item_rejects_multiline_input_without_writing() {
    let temp_dir = unique_temp_dir("append-command-multiline");
    std::fs::create_dir_all(&temp_dir).unwrap();

    let error = append_todo_item(
        temp_dir.to_string_lossy().to_string(),
        "First task\nSecond task".to_string(),
    )
    .unwrap_err();

    assert_eq!(error, "todo item must be a single line");
    assert!(!temp_dir.join("todo.txt").exists());

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn update_todo_item_replaces_guarded_line_and_returns_reloaded_workspace() {
    let temp_dir = unique_temp_dir("update-command-replaces");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\nSecond task +Old\nThird task\n",
    )
    .unwrap();

    let result = update_todo_item(
        temp_dir.to_string_lossy().to_string(),
        2,
        "Second task +Old".to_string(),
        "(A) Updated second task +New @computer".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\n(A) Updated second task +New @computer\nThird task\n"
    );
    let todo_file = result.todo_file.unwrap();
    assert_eq!(todo_file.items.len(), 3);
    assert_eq!(todo_file.items[1].line_number, 2);
    assert_eq!(todo_file.items[1].priority, Some('A'));
    assert_eq!(todo_file.items[1].description, "Updated second task");
    assert_eq!(todo_file.items[1].projects, vec!["New"]);
    assert_eq!(todo_file.items[1].contexts, vec!["computer"]);

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn update_todo_item_rejects_stale_raw_line_guard_without_writing() {
    let temp_dir = unique_temp_dir("update-command-stale");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "First task\nChanged on disk\n").unwrap();

    let error = update_todo_item(
        temp_dir.to_string_lossy().to_string(),
        2,
        "Second task".to_string(),
        "Updated task".to_string(),
    )
    .unwrap_err();

    assert!(error.contains("todo line 2 changed on disk"));
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nChanged on disk\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn update_todo_item_rejects_invalid_replacement_without_writing() {
    let temp_dir = unique_temp_dir("update-command-invalid");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "First task\nSecond task\n").unwrap();

    let error = update_todo_item(
        temp_dir.to_string_lossy().to_string(),
        2,
        "Second task".to_string(),
        "2024-99-99 bad date".to_string(),
    )
    .unwrap_err();

    assert_eq!(error, "date must use YYYY-MM-DD format");
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nSecond task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn update_todo_item_rejects_multiline_replacement_without_writing() {
    let temp_dir = unique_temp_dir("update-command-multiline");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(temp_dir.join("todo.txt"), "First task\nSecond task\n").unwrap();

    let error = update_todo_item(
        temp_dir.to_string_lossy().to_string(),
        2,
        "Second task".to_string(),
        "Updated task\nInjected task".to_string(),
    )
    .unwrap_err();

    assert_eq!(error, "todo item must be a single line");
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nSecond task\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn toggle_todo_line_completed_marks_open_task_with_completion_date() {
    assert_eq!(
        toggle_todo_line_completed(
            "(A) 2026-01-01 Ship feature +Tuxedo due:2026-01-03",
            "2026-02-04"
        ),
        "x 2026-02-04 (A) 2026-01-01 Ship feature +Tuxedo due:2026-01-03"
    );
}

#[test]
fn toggle_todo_line_completed_reopens_completed_task_with_completion_date() {
    assert_eq!(
        toggle_todo_line_completed(
            "x 2026-02-04 2026-01-01 Ship feature +Tuxedo due:2026-01-03",
            "2026-03-05"
        ),
        "2026-01-01 Ship feature +Tuxedo due:2026-01-03"
    );
}

#[test]
fn toggle_todo_line_completed_reopens_completed_task_without_completion_date() {
    assert_eq!(
        toggle_todo_line_completed("x Ship feature +Tuxedo due:2026-01-03", "2026-03-05"),
        "Ship feature +Tuxedo due:2026-01-03"
    );
}

#[test]
fn toggle_todo_item_completed_marks_open_task_and_returns_reloaded_workspace() {
    let temp_dir = unique_temp_dir("toggle-command-complete");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\n2026-01-01 Second task +Tuxedo due:2026-01-03\n",
    )
    .unwrap();
    let today = current_local_date();

    let result = toggle_todo_item_completed(
        temp_dir.to_string_lossy().to_string(),
        2,
        "2026-01-01 Second task +Tuxedo due:2026-01-03".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        format!("First task\nx {today} 2026-01-01 Second task +Tuxedo due:2026-01-03\n")
    );
    let todo_file = result.todo_file.unwrap();
    assert!(todo_file.items[1].completed);
    assert_eq!(
        todo_file.items[1].completion_date.as_deref(),
        Some(today.as_str())
    );
    assert_eq!(
        todo_file.items[1].creation_date.as_deref(),
        Some("2026-01-01")
    );
    assert_eq!(
        todo_file.items[1].metadata.get("due").map(String::as_str),
        Some("2026-01-03")
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn toggle_todo_item_completed_reopens_task_without_losing_metadata() {
    let temp_dir = unique_temp_dir("toggle-command-reopen");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "x 2026-02-04 2026-01-01 Second task +Tuxedo due:2026-01-03\n",
    )
    .unwrap();

    let result = toggle_todo_item_completed(
        temp_dir.to_string_lossy().to_string(),
        1,
        "x 2026-02-04 2026-01-01 Second task +Tuxedo due:2026-01-03".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "2026-01-01 Second task +Tuxedo due:2026-01-03\n"
    );
    let todo_file = result.todo_file.unwrap();
    assert!(!todo_file.items[0].completed);
    assert_eq!(todo_file.items[0].completion_date, None);
    assert_eq!(
        todo_file.items[0].creation_date.as_deref(),
        Some("2026-01-01")
    );
    assert_eq!(todo_file.items[0].projects, vec!["Tuxedo"]);
    assert_eq!(
        todo_file.items[0].metadata.get("due").map(String::as_str),
        Some("2026-01-03")
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn toggle_todo_item_completed_rejects_stale_raw_line_guard_without_writing() {
    let temp_dir = unique_temp_dir("toggle-command-stale");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\nChanged manually on disk\n",
    )
    .unwrap();

    let error = toggle_todo_item_completed(
        temp_dir.to_string_lossy().to_string(),
        2,
        "Second task".to_string(),
    )
    .unwrap_err();

    assert!(error.contains("todo line 2 changed on disk"));
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nChanged manually on disk\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn delete_todo_item_removes_guarded_line_and_returns_reloaded_workspace() {
    let temp_dir = unique_temp_dir("delete-command-removes");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\nSecond task +Tuxedo\nThird task\n",
    )
    .unwrap();

    let result = delete_todo_item(
        temp_dir.to_string_lossy().to_string(),
        2,
        "Second task +Tuxedo".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nThird task\n"
    );
    let todo_file = result.todo_file.unwrap();
    assert_eq!(todo_file.items.len(), 2);
    assert_eq!(todo_file.items[0].line_number, 1);
    assert_eq!(todo_file.items[1].line_number, 2);
    assert_eq!(todo_file.items[1].description, "Third task");

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn delete_todo_item_preserves_unrelated_skipped_lines() {
    let temp_dir = unique_temp_dir("delete-command-preserves-skipped");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\n2024-99-99 bad date\nThird task\n",
    )
    .unwrap();

    let result = delete_todo_item(
        temp_dir.to_string_lossy().to_string(),
        1,
        "First task".to_string(),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "2024-99-99 bad date\nThird task\n"
    );
    let todo_file = result.todo_file.unwrap();
    assert_eq!(todo_file.items.len(), 1);
    assert_eq!(todo_file.skipped.len(), 1);
    assert_eq!(todo_file.items[0].line_number, 2);
    assert_eq!(todo_file.skipped[0].line_number, 1);

    std::fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn delete_todo_item_rejects_stale_raw_line_guard_without_writing() {
    let temp_dir = unique_temp_dir("delete-command-stale");
    std::fs::create_dir_all(&temp_dir).unwrap();
    std::fs::write(
        temp_dir.join("todo.txt"),
        "First task\nChanged manually on disk\n",
    )
    .unwrap();

    let error = delete_todo_item(
        temp_dir.to_string_lossy().to_string(),
        2,
        "Second task".to_string(),
    )
    .unwrap_err();

    assert!(error.contains("todo line 2 changed on disk"));
    assert_eq!(
        std::fs::read_to_string(temp_dir.join("todo.txt")).unwrap(),
        "First task\nChanged manually on disk\n"
    );

    std::fs::remove_dir_all(temp_dir).unwrap();
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();

    std::env::temp_dir().join(format!("tuxedo-ui-{name}-{nanos}"))
}
