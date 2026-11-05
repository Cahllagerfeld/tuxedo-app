use std::fs;
use std::path::{Path, PathBuf};

use super::{workspace_json, ID_A, ID_B};
use crate::catalogue::parse_catalogue;
use crate::catalogue_write::write_catalogue;
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
fn validates_like_the_electron_app() {
    let path = Path::new("/w.json");
    let a = workspace_json(ID_A, "Home", "/a/todo.txt");
    let case = |active: &str, workspaces: &str| {
        format!(r#"{{"version":1,"active_workspace_id":{active},"workspaces":[{workspaces}]}}"#)
    };
    let with = |field: &str| case("null", &a.replace(".136Z\"", &format!(".136Z\",{field}")));

    // Accepted by the TypeScript `catalogueSchema`: timestamp forms, nil/max/uppercase UUIDs,
    // and a version written as `1.0`.
    let accepted = [
        ("2024-02-29T10:00:00Z", ID_A),
        ("2026-10-12T10:00:00.123+02:00", ID_A),
        ("2026-10-12T10:00:00-05:30", ID_A),
        (
            "2026-10-12T10:00:00Z",
            "00000000-0000-0000-0000-000000000000",
        ),
        (
            "2026-10-12T10:00:00Z",
            "FFFFFFFF-ffff-ffff-ffff-ffffffffffff",
        ),
        (
            "2026-10-12T10:00:00Z",
            "B0CB4064-D525-8EDF-BD56-BC5A78832039",
        ),
    ];
    for (created_at, id) in accepted {
        let workspace = workspace_json(id, "Home", "/a/todo.txt")
            .replace("2026-10-18T09:11:29.136Z", created_at);
        let json =
            format!(r#"{{"version":1.0,"active_workspace_id":"{id}","workspaces":[{workspace}]}}"#);
        assert!(parse_catalogue(path, &json).is_ok(), "{json}");
    }

    // Rejected by it (contract.spec.ts "desktop responses reject malformed catalogue data" plus
    // the representations serde alone would accept).
    let rejected = [
        // Unique ids, names ignoring case, and paths; an existing Active workspace.
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_A, "Other", "/b/todo.txt")),
        ),
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_B, "home", "/b/todo.txt")),
        ),
        case(
            "null",
            &format!("{a},{}", workspace_json(ID_B, "Work", "/a/todo.txt")),
        ),
        case(&format!(r#""{ID_B}""#), &a),
        case(r#""not-a-uuid""#, &a),
        // Names are non-empty and JS-trimmed; paths are not blank.
        case("null", &a.replace("Home", "")),
        case("null", &a.replace("Home", " Home ")),
        case("null", &a.replace("Home", "\\ufeffHome")),
        case("null", &a.replace("/a/todo.txt", " ")),
        case("null", &a.replace("blue", "purple")),
        // Effect's isUUID: version digit 1-8 and the RFC variant.
        case("null", &a.replace(ID_A, "not-a-uuid")),
        case(
            "null",
            &a.replace(ID_A, "b0cb4064-d525-0edf-ad56-bc5a78832039"),
        ),
        case(
            "null",
            &a.replace(ID_A, "b0cb4064-d525-4edf-cd56-bc5a78832039"),
        ),
        // ISO datetimes with a timezone and a valid calendar date and time.
        case("null", &a.replace(".136Z", "")),
        case(
            "null",
            &a.replace("2026-10-18T09:11:29.136Z", "2026-02-30T10:00:00Z"),
        ),
        case(
            "null",
            &a.replace("2026-10-18T09:11:29.136Z", "2026-01-01T24:00:00Z"),
        ),
        case("null", &a.replace(".136Z", "+24:00")),
        // Multibyte characters inside the time or offset must not panic on slicing.
        case("null", &a.replace("09:11:29.136Z", "0é:0:00Z")),
        case("null", &a.replace(".136Z", "+0é:0")),
        // Optional preferences are absent or valid, never null.
        with(r#""sort_order":null"#),
        with(r#""show_deferred":null"#),
        with(r#""sort_order":"priority""#),
        with(r#""show_deferred":"true""#),
        // No excess keys; every other key is required.
        with(r#""unexpected":true"#),
        r#"{"version":1,"active_workspace_id":null,"workspaces":[],"unexpected":true}"#.to_owned(),
        case("null", &a.replace(r#","color":"blue""#, "")),
        r#"{"version":1,"workspaces":[]}"#.to_owned(),
        r#"{"active_workspace_id":null,"workspaces":[]}"#.to_owned(),
        r#"{"version":1,"active_workspace_id":null}"#.to_owned(),
        r#"{"version":1,"active_workspace_id":null,"workspaces":false}"#.to_owned(),
        // Objects and string literals only, not serde's sequence and tagged-enum forms.
        "[1,null,[]]".to_owned(),
        case(
            "null",
            &format!(r#"["{ID_A}","Home","blue","/a/todo.txt","2026-10-18T09:11:29.136Z"]"#),
        ),
        case("null", &a.replace(r#""blue""#, r#"{"blue":null}"#)),
        with(r#""sort_order":{"due":null}"#),
    ];
    for json in rejected {
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
fn persists_exactly_like_the_electron_app() {
    let dir = super::temp_dir();
    let path = dir.path().join("nested/workspaces.json");
    let mut catalogue = parse_catalogue(&path, ELECTRON_CATALOGUE).unwrap();
    assert_eq!(catalogue.workspaces[0].name, "Café \"Home\" ✓\u{7}");
    write_catalogue(&path, &catalogue).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), ELECTRON_CATALOGUE);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    // A catalogue the Electron app would not read is refused and the file kept.
    catalogue.workspaces[1].name = "home".into();
    catalogue.workspaces[0].name = "Home".into();
    assert!(matches!(
        write_catalogue(&path, &catalogue),
        Err(CoreError::InvalidCatalogue { .. })
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), ELECTRON_CATALOGUE);

    write_catalogue(&path, &Catalogue::default()).unwrap();
    let empty = "{\n  \"version\": 1,\n  \"active_workspace_id\": null,\n  \"workspaces\": []\n}\n";
    assert_eq!(fs::read_to_string(&path).unwrap(), empty);
}
