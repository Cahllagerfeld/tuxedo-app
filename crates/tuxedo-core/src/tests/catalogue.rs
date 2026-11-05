use std::path::{Path, PathBuf};

use super::{workspace_json, ID_A, ID_B};
use crate::catalogue::parse_catalogue;
use crate::*;

#[test]
fn decodes_a_version_1_catalogue() {
    let json = format!(
        r#"{{"version":1,"active_workspace_id":"{ID_B}","workspaces":[{},{}]}}"#,
        workspace_json(ID_A, "Home", "/a/todo.txt")
            .replace(r#""extra":1"#, r#""sort_order":"due","show_deferred":true"#),
        workspace_json(ID_B, "Work", "/b/todo.txt"),
    );
    let catalogue = parse_catalogue(Path::new("/w.json"), &json).unwrap();
    assert_eq!(catalogue.active_workspace().unwrap().name, "Work");
    let home = &catalogue.workspaces[0];
    assert_eq!(home.todo_file, PathBuf::from("/a/todo.txt"));
    assert_eq!(
        (home.sort_order, home.show_deferred),
        (Some(TodoSortOrder::Due), Some(true))
    );
    assert_eq!(catalogue.workspaces[1].sort_order, None);
    assert_eq!(home.color, WorkspaceColor::Blue);

    // JS `trim` keeps U+0085, so Electron can persist it; one odd name must not reject the file.
    let json = format!(
        r#"{{"version":1,"active_workspace_id":null,"workspaces":[{}]}}"#,
        workspace_json(ID_A, "\\u0085Home", "/a/todo.txt")
    );
    let catalogue = parse_catalogue(Path::new("/w.json"), &json).unwrap();
    assert_eq!(catalogue.workspaces[0].name, "\u{85}Home");
    let json = json.replace("\\u0085Home", "\\u0085");
    let catalogue = parse_catalogue(Path::new("/w.json"), &json).unwrap();
    assert_eq!(catalogue.workspaces[0].name, "\u{85}");

    let missing = Path::new(env!("CARGO_MANIFEST_DIR")).join("no-such-workspaces.json");
    assert_eq!(load_catalogue(&missing).unwrap(), Catalogue::default());
}

#[test]
fn rejects_invalid_catalogues() {
    let path = Path::new("/w.json");
    let a = workspace_json(ID_A, "Home", "/a/todo.txt");
    let case = |active: &str, workspaces: &str| {
        format!(r#"{{"version":1,"active_workspace_id":{active},"workspaces":[{workspaces}]}}"#)
    };
    let invalid = [
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_B, "home", "/b/todo.txt")),
        ),
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_B, "Work", "/a/todo.txt")),
        ),
        case(&format!(r#""{ID_B}""#), &a),
        case("null", &a.replace("blue", "teal")),
        case("null", &a.replace("Home", "")),
        case("null", &a.replace(".136Z", "")),
        // Multibyte characters inside the time or offset must not panic on slicing.
        case("null", &a.replace("09:11:29.136Z", "0é:0:00Z")),
        case("null", &a.replace(".136Z", "+0é:0")),
    ];
    for json in invalid {
        assert!(
            matches!(
                parse_catalogue(path, &json),
                Err(CoreError::InvalidCatalogue { .. })
            ),
            "{json}"
        );
    }
    let v2 = case("null", &a).replace(r#""version":1"#, r#""version":2"#);
    assert!(matches!(
        parse_catalogue(path, &v2),
        Err(CoreError::UnsupportedVersion { .. })
    ));
    assert!(matches!(
        parse_catalogue(path, "{"),
        Err(CoreError::Json { .. })
    ));
    let wrong_shape = r#"{"version":1,"active_workspace_id":null,"workspaces":false}"#;
    assert!(matches!(
        parse_catalogue(path, wrong_shape),
        Err(CoreError::InvalidCatalogue { .. })
    ));
}
