use std::fs;
use std::path::Path;

use super::{workspace_json, ID_A};
use crate::electron_import::{convert_saved_views, v1_query, V1Filters};
use crate::saved_views::saved_query;
use crate::*;

const VIEW_1: &str = "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const VIEW_2: &str = "9a8b7c6d-5e4f-4a3b-9c1d-0e1f2a3b4c5d";
const NO_FILTERS: &str =
    r#"{"status":"all","search":"","project":null,"context":null,"priority":null,"due":null}"#;

#[test]
fn electron_saved_view_filters_become_canonical_queries() {
    let filters = |json: &str| -> V1Filters {
        let mut value: serde_json::Value = serde_json::from_str(NO_FILTERS).unwrap();
        let patch: serde_json::Value = serde_json::from_str(json).unwrap();
        for (key, v) in patch.as_object().unwrap() {
            value[key] = v.clone();
        }
        serde_json::from_value(value).unwrap()
    };
    let cases = [
        ("{}", Ok("is:all")),
        (r#"{"status":"open"}"#, Ok("is:open")),
        (
            r#"{"status":"completed","project":"home"}"#,
            Ok("is:completed +home"),
        ),
        (
            r#"{"status":"open","priority":"A","due":"overdue","project":"work","context":"desk"}"#,
            Ok("is:open pri:A due:overdue +work @desk"),
        ),
        (r#"{"due":"none"}"#, Ok("due:none")),
        (r#"{"due":"invalid"}"#, Ok("due:invalid")),
        // Search words split on whitespace; words the Query would read as conditions or that
        // hold quotes are quoted by the parser's rules.
        (r#"{"search":"  call   mom "}"#, Ok("call mom")),
        (
            r#"{"search":"+fake pri:B say \"hi\""}"#,
            Ok(r#""+fake" "pri:B" say "\"hi\"""#),
        ),
        (r#"{"project":"a\"b"}"#, Ok(r#"+"a\"b""#)),
        (r#"{"project":"two words"}"#, Err(())),
        (r#"{"priority":"a"}"#, Err(())),
        // The Electron schema forbids it; a hand-edited file is still refused.
        (r#"{"status":"completed","due":"today"}"#, Err(())),
    ];
    for (json, expected) in cases {
        let query = v1_query(&filters(json));
        assert_eq!(query.as_deref().map_err(|_| ()), expected, "{json}");
        if let Ok(query) = query {
            // Every converted Query is the canonical saved Query of its own filters.
            let parsed = TodoFilters::parse(&query).unwrap();
            assert_eq!(saved_query(&parsed).unwrap(), query, "{json}");
        }
    }
}

#[test]
fn electron_saved_views_files_decode_as_strictly_as_the_electron_schema() {
    let view = |filters: &str| {
        format!(r#"{{"id":"{VIEW_1}","workspace_id":"{ID_A}","name":"V","filters":{filters}}}"#)
    };
    let file = |filters: &str| format!(r#"{{"version":1,"views":[{}]}}"#, view(filters));
    let cases = [
        (file(NO_FILTERS), true),
        (file(&NO_FILTERS.replace(r#""all""#, r#""open""#)), true),
        // serde's externally tagged enum shapes are not Effect string literals.
        (
            file(&NO_FILTERS.replace(r#""all""#, r#"{"open":null}"#)),
            false,
        ),
        (
            file(&NO_FILTERS.replace(r#""due":null"#, r#""due":{"today":null}"#)),
            false,
        ),
        (file(&NO_FILTERS.replace(r#","due":null"#, "")), false),
        (file(&NO_FILTERS.replace('}', r#","extra":1}"#)), false),
        (r#"{"version":2,"views":[]}"#.to_owned(), false),
    ];
    for (text, accepted) in cases {
        assert_eq!(convert_saved_views(&text).is_ok(), accepted, "{text}");
    }
}

fn electron_fixture(root: &Path, filters: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let (native, electron) = (root.join("Tuxedo"), root.join("Tuxedo Electron"));
    fs::create_dir_all(&electron).unwrap();
    let todo = root.join("todo.txt");
    fs::write(&todo, "Call mom\n").unwrap();
    fs::write(
        electron.join(CATALOGUE_FILE),
        format!(
            r#"{{"version":1,"active_workspace_id":null,"workspaces":[{}]}}"#,
            workspace_json(ID_A, "Home", todo.to_str().unwrap())
        ),
    )
    .unwrap();
    fs::write(
        electron.join(SAVED_VIEWS_FILE),
        format!(
            r#"{{"version":1,"views":[{{"id":"{VIEW_1}","workspace_id":"{ID_A}","name":"Everything","filters":{filters}}}]}}"#
        ),
    )
    .unwrap();
    (native, electron)
}

#[test]
fn a_filterless_imported_view_reloads_and_saves_under_a_new_name() {
    let root = super::temp_dir();
    let (native, electron) = electron_fixture(root.path(), NO_FILTERS);
    assert!(matches!(
        import_electron_data(&native, &electron),
        ElectronImport::Imported(ImportReport { saved_views: 1, .. })
    ));
    let session = WorkspaceSession::new(load_catalogue(&native.join(CATALOGUE_FILE)).unwrap());
    let mut views = SavedViews::load(native.join(SAVED_VIEWS_FILE));
    let imported = views.for_workspace(ID_A).next().unwrap().query.clone();
    assert_eq!(imported, "is:all");
    let change = SavedViewChange::Create {
        id: VIEW_2.into(),
        workspace_id: ID_A.into(),
        name: "Everything again".into(),
        query: imported,
    };
    let result = views.prepare(&session, change).unwrap().execute().unwrap();
    views.accept(result).unwrap();
    let reloaded = read_saved_views(&native.join(SAVED_VIEWS_FILE)).unwrap();
    assert_eq!(reloaded.len(), 2);
    assert_eq!(reloaded[1].query, "is:all");
}

#[cfg(unix)]
#[test]
fn saved_view_io_failures_stop_the_import_before_the_catalogue_so_a_later_launch_retries() {
    use std::os::unix::fs::PermissionsExt;
    fn mode(path: &Path, mode: u32) -> std::io::Result<()> {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
    }
    type Step = fn(&Path, &Path);
    // (case, break before the first launch, repair before the second)
    let cases: [(&str, Step, Step); 3] = [
        (
            "unreadable Electron saved views",
            |_, electron| mode(&electron.join(SAVED_VIEWS_FILE), 0o000).unwrap(),
            |_, electron| mode(&electron.join(SAVED_VIEWS_FILE), 0o600).unwrap(),
        ),
        (
            "unwritable native folder",
            |native, _| {
                fs::create_dir_all(native).unwrap();
                mode(native, 0o500).unwrap();
            },
            |native, _| mode(native, 0o700).unwrap(),
        ),
        (
            // The replacement landed but its directory sync failed: the reread confirms it, so
            // the first launch already completes and the second has nothing to do.
            "unconfirmed but complete replacements",
            |native, _| {
                fs::create_dir_all(native).unwrap();
                crate::atomic_file::fault::fail_directory_sync(native);
            },
            |_, _| {},
        ),
    ];
    for (case, fail, repair) in cases {
        let root = super::temp_dir();
        let (native, electron) = electron_fixture(root.path(), NO_FILTERS);
        fail(&native, &electron);
        let first = import_electron_data(&native, &electron);
        repair(&native, &electron);
        let second = import_electron_data(&native, &electron);
        let imported = |outcome: &ElectronImport| {
            matches!(
                outcome,
                ElectronImport::Imported(ImportReport {
                    workspaces: 1,
                    saved_views: 1,
                    saved_views_warning: None,
                })
            )
        };
        if case.starts_with("unconfirmed") {
            assert!(imported(&first), "{case}: {first:?}");
            assert_eq!(second, ElectronImport::NotNeeded, "{case}");
        } else {
            assert!(matches!(first, ElectronImport::Refused(_)), "{case}");
            assert!(imported(&second), "{case}: {second:?}");
        }
        assert_eq!(
            read_saved_views(&native.join(SAVED_VIEWS_FILE))
                .unwrap()
                .len(),
            1
        );
        assert!(
            load_catalogue(&native.join(CATALOGUE_FILE)).is_ok(),
            "{case}"
        );
    }
}
