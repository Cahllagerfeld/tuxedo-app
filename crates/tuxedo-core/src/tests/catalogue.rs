use std::fs;
use std::path::{Path, PathBuf};

use super::{workspace_json, ID_A, ID_B};
use crate::catalogue::parse_catalogue;
use crate::catalogue_write::{serialize_catalogue, write_catalogue};
use crate::*;

#[test]
fn decodes_a_version_1_catalogue() {
    let json = format!(
        r#"{{"version":1,"active_workspace_id":"{ID_B}","workspaces":[{},{}]}}"#,
        workspace_json(ID_A, "Home", "/a/todo.txt").replace(
            ".136Z\"",
            ".136Z\",\"sort_order\":\"due\",\"show_deferred\":true"
        ),
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
        // contract.spec.ts "desktop responses reject malformed catalogue data".
        case("null", &a.replace("Home", " Home ")),
        case("null", &a.replace("Home", "\\ufeffHome")),
        case("null", &a.replace("/a/todo.txt", " ")),
        case("null", &a.replace("blue", "purple")),
        case("null", &a.replace(ID_A, "not-a-uuid")),
        case(
            "null",
            &a.replace("2026-10-18T09:11:29.136Z", "2026-02-30T10:00:00Z"),
        ),
        case(
            "null",
            &a.replace("2026-10-18T09:11:29.136Z", "2026-01-01T24:00:00Z"),
        ),
        case("null", &a.replace(".136Z", "+24:00")),
        // Effect's isUUID requires a version digit 1-8 and the RFC variant.
        case(
            "null",
            &a.replace(ID_A, "b0cb4064-d525-0edf-ad56-bc5a78832039"),
        ),
        case(
            "null",
            &a.replace(ID_A, "b0cb4064-d525-4edf-cd56-bc5a78832039"),
        ),
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_A, "Other", "/b/todo.txt")),
        ),
        case(r#""not-a-uuid""#, &a),
        // Optional preferences are absent or valid, never null.
        case("null", &a.replace(".136Z\"", ".136Z\",\"sort_order\":null")),
        case(
            "null",
            &a.replace(".136Z\"", ".136Z\",\"show_deferred\":null"),
        ),
        case(
            "null",
            &a.replace(".136Z\"", ".136Z\",\"sort_order\":\"priority\""),
        ),
        case(
            "null",
            &a.replace(".136Z\"", ".136Z\",\"show_deferred\":\"true\""),
        ),
        // Every other key is required.
        case("null", &a.replace(r#","color":"blue""#, "")),
        r#"{"version":1,"workspaces":[]}"#.to_owned(),
        r#"{"active_workspace_id":null,"workspaces":[]}"#.to_owned(),
        r#"{"version":1,"active_workspace_id":null}"#.to_owned(),
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

#[test]
fn rejects_excess_fields() {
    let path = Path::new("/w.json");
    let a = workspace_json(ID_A, "Home", "/a/todo.txt");
    let in_workspace = a.replace(".136Z\"", ".136Z\",\"unexpected\":true");
    for json in [
        format!(r#"{{"version":1,"active_workspace_id":null,"workspaces":[{in_workspace}]}}"#),
        format!(
            r#"{{"version":1,"active_workspace_id":null,"workspaces":[{a}],"unexpected":true}}"#
        ),
    ] {
        assert!(
            matches!(
                parse_catalogue(path, &json),
                Err(CoreError::InvalidCatalogue { .. })
            ),
            "{json}"
        );
    }
}

#[test]
fn accepts_what_the_electron_app_accepts() {
    let path = Path::new("/w.json");
    let with = |id: &str, created_at: &str| {
        let a = workspace_json(id, "Home", "/a/todo.txt")
            .replace("2026-10-18T09:11:29.136Z", created_at);
        format!(r#"{{"version":1.0,"active_workspace_id":"{id}","workspaces":[{a}]}}"#)
    };
    for (id, created_at) in [
        (ID_A, "2024-02-29T10:00:00Z"),
        (ID_A, "2026-10-12T10:00:00.123+02:00"),
        (ID_A, "2026-10-12T10:00:00-05:30"),
        (
            "00000000-0000-0000-0000-000000000000",
            "2026-10-12T10:00:00Z",
        ),
        (
            "FFFFFFFF-ffff-ffff-ffff-ffffffffffff",
            "2026-10-12T10:00:00Z",
        ),
        (
            "B0CB4064-D525-8EDF-BD56-BC5A78832039",
            "2026-10-12T10:00:00Z",
        ),
    ] {
        let json = with(id, created_at);
        assert!(parse_catalogue(path, &json).is_ok(), "{json}");
    }
}

/// A catalogue with every kind of value the Electron app persists, as `JSON.stringify(_, null, 2)`
/// writes it (compare a real `workspaces.json`).
const ELECTRON_CATALOGUE: &str = r#"{
  "version": 1,
  "active_workspace_id": "b0cb4064-d525-4edf-ad56-bc5a78832039",
  "workspaces": [
    {
      "id": "b0cb4064-d525-4edf-ad56-bc5a78832039",
      "name": "Café \"Home\" ✓\u0007",
      "color": "blue",
      "todo_path": "/Users/me/To do/todo.txt",
      "created_at": "2026-10-18T09:11:29.136Z",
      "sort_order": "file",
      "show_deferred": false
    },
    {
      "id": "760893da-3602-40cf-8fee-593e3a80ae85",
      "name": "Work\\Ops",
      "color": "red",
      "todo_path": "C:\\work.txt",
      "created_at": "2026-10-19T18:16:18.342Z"
    }
  ]
}
"#;

#[test]
fn serializes_exactly_like_the_electron_app() {
    let path = Path::new("/w.json");
    let catalogue = parse_catalogue(path, ELECTRON_CATALOGUE).unwrap();
    assert_eq!(catalogue.workspaces[0].name, "Café \"Home\" ✓\u{7}");
    assert_eq!(catalogue.workspaces[1].show_deferred, None);
    assert_eq!(
        serialize_catalogue(path, &catalogue).unwrap(),
        ELECTRON_CATALOGUE
    );
    let empty = r#"{
  "version": 1,
  "active_workspace_id": null,
  "workspaces": []
}
"#;
    assert_eq!(
        serialize_catalogue(path, &Catalogue::default()).unwrap(),
        empty
    );
}

#[test]
fn writes_atomically_and_refuses_invalid_catalogues() {
    let dir = super::temp_dir();
    let path = dir.path().join("nested/workspaces.json");
    let mut catalogue = parse_catalogue(&path, ELECTRON_CATALOGUE).unwrap();
    write_catalogue(&path, &catalogue).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), ELECTRON_CATALOGUE);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    assert_eq!(load_catalogue(&path).unwrap(), catalogue);

    catalogue.workspaces[1].name = "home".into();
    catalogue.workspaces[0].name = "Home".into();
    assert!(matches!(
        write_catalogue(&path, &catalogue),
        Err(CoreError::InvalidCatalogue { .. })
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), ELECTRON_CATALOGUE);
    let entries: Vec<_> = fs::read_dir(path.parent().unwrap()).unwrap().collect();
    assert_eq!(entries.len(), 1, "no temporary file is left behind");
}

