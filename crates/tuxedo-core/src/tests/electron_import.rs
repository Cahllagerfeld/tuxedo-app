use crate::electron_import::{v1_query, V1Filters};
use crate::TodoFilters;

#[test]
fn electron_saved_view_filters_become_canonical_queries() {
    let filters = |json: &str| -> V1Filters {
        let base = serde_json::json!({
            "status": "all", "search": "", "project": null, "context": null,
            "priority": null, "due": null,
        });
        let mut value = base;
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
            // Every converted Query is a valid, canonical saved Query.
            let parsed = TodoFilters::parse(&query).unwrap();
            if query != "is:all" {
                assert_eq!(parsed.to_query().unwrap(), query, "{json}");
            }
        }
    }
}
