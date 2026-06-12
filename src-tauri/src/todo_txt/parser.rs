use super::error::ParseLineError;
use super::types::{SkippedLine, TodoItem};
use chrono::NaiveDate;
use std::collections::HashMap;

/// Parser policy:
/// - Follow todo.txt's loose format: malformed priority-like tokens are task text, not fatal errors.
/// - Treat completion and creation dates as optional, but validate date-shaped tokens strictly.
/// - Preserve raw source lines and 1-based line numbers for diagnostics and future round-tripping.
/// - Keep file parsing resilient by returning skipped lines instead of failing the whole file.
pub fn parse_file(contents: &str) -> (Vec<TodoItem>, Vec<SkippedLine>) {
    let mut items = Vec::new();
    let mut skipped = Vec::new();

    for (index, raw) in contents.lines().enumerate() {
        let line_number = (index + 1) as u32;

        if raw.trim().is_empty() {
            continue;
        }

        match parse_line(line_number, raw) {
            Ok(item) => items.push(item),
            Err(error) => skipped.push(SkippedLine {
                line_number,
                raw: raw.to_string(),
                reason: error.to_string(),
            }),
        }
    }

    (items, skipped)
}

pub fn parse_line(line_number: u32, raw: &str) -> Result<TodoItem, ParseLineError> {
    let trimmed = raw.trim();

    if let Some(rest) = trimmed.strip_prefix("x ") {
        return parse_completed(line_number, raw, rest);
    }

    parse_incomplete(line_number, raw, trimmed)
}

fn parse_completed(line_number: u32, raw: &str, rest: &str) -> Result<TodoItem, ParseLineError> {
    let (completion_date, rest) = consume_optional_date(rest)?;
    let (creation_date, rest) = consume_optional_date(rest)?;
    let parsed = parse_tokens(rest)?;

    Ok(TodoItem {
        line_number,
        raw: raw.to_string(),
        completed: true,
        priority: None,
        creation_date,
        completion_date,
        description: parsed.description,
        projects: parsed.projects,
        contexts: parsed.contexts,
        metadata: parsed.metadata,
    })
}

fn parse_incomplete(line_number: u32, raw: &str, line: &str) -> Result<TodoItem, ParseLineError> {
    let (priority, rest) = consume_priority(line);
    let (creation_date, rest) = consume_optional_date(rest)?;
    let parsed = parse_tokens(rest)?;

    Ok(TodoItem {
        line_number,
        raw: raw.to_string(),
        completed: false,
        priority,
        creation_date,
        completion_date: None,
        description: parsed.description,
        projects: parsed.projects,
        contexts: parsed.contexts,
        metadata: parsed.metadata,
    })
}

fn consume_priority(line: &str) -> (Option<char>, &str) {
    let Some(after_open) = line.strip_prefix('(') else {
        return (None, line);
    };

    let mut chars = after_open.chars();
    let Some(priority) = chars.next() else {
        return (None, line);
    };

    if !priority.is_ascii_uppercase() || chars.next() != Some(')') || chars.next() != Some(' ') {
        return (None, line);
    }

    let rest = chars.as_str();
    (Some(priority), rest)
}

fn consume_optional_date(line: &str) -> Result<(Option<String>, &str), ParseLineError> {
    let Some((token, rest)) = split_first_token(line) else {
        return Ok((None, line));
    };

    if looks_like_date(token) && !is_valid_date(token) {
        return Err(ParseLineError::InvalidDate);
    }

    if is_valid_date(token) {
        Ok((Some(token.to_string()), rest))
    } else {
        Ok((None, line))
    }
}

fn split_first_token(line: &str) -> Option<(&str, &str)> {
    let line = line.trim_start();

    match line.find(char::is_whitespace) {
        Some(index) => Some((&line[..index], line[index..].trim_start())),
        None if !line.is_empty() => Some((line, "")),
        None => None,
    }
}

fn looks_like_date(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() == 10 && bytes[4] == b'-' && bytes[7] == b'-'
}

fn is_valid_date(token: &str) -> bool {
    looks_like_date(token) && NaiveDate::parse_from_str(token, "%Y-%m-%d").is_ok()
}

struct ParsedTokens {
    description: String,
    projects: Vec<String>,
    contexts: Vec<String>,
    metadata: HashMap<String, String>,
}

fn parse_tokens(rest: &str) -> Result<ParsedTokens, ParseLineError> {
    let mut description_parts = Vec::new();
    let mut projects = Vec::new();
    let mut contexts = Vec::new();
    let mut metadata = HashMap::new();

    for token in rest.split_whitespace() {
        if let Some(project) = token.strip_prefix('+') {
            if !project.is_empty() {
                projects.push(project.to_string());
                continue;
            }
        }

        if let Some(context) = token.strip_prefix('@') {
            if !context.is_empty() {
                contexts.push(context.to_string());
                continue;
            }
        }

        if let Some((key, value)) = parse_metadata(token) {
            metadata.insert(key.to_string(), value.to_string());
            continue;
        }

        description_parts.push(token);
    }

    let description = description_parts.join(" ");

    if description.is_empty() {
        return Err(ParseLineError::EmptyDescription);
    }

    Ok(ParsedTokens {
        description,
        projects,
        contexts,
        metadata,
    })
}

fn parse_metadata(token: &str) -> Option<(&str, &str)> {
    let (key, value) = token.split_once(':')?;

    if key.is_empty() || value.is_empty() || value.contains(':') {
        return None;
    }

    Some((key, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_readme_incomplete_task_examples() {
        let task_with_phone = parse_line(1, "(A) Thank Mom for the meatballs @phone").unwrap();
        let garage_task = parse_line(2, "(B) Schedule Goodwill pickup +GarageSale @phone").unwrap();
        let signs_task = parse_line(3, "Post signs around the neighborhood +GarageSale").unwrap();
        let grocery_task = parse_line(4, "@GroceryStore pies").unwrap();

        assert_eq!(task_with_phone.priority, Some('A'));
        assert_eq!(task_with_phone.description, "Thank Mom for the meatballs");
        assert_eq!(task_with_phone.contexts, vec!["phone"]);
        assert_eq!(garage_task.projects, vec!["GarageSale"]);
        assert_eq!(garage_task.contexts, vec!["phone"]);
        assert_eq!(signs_task.description, "Post signs around the neighborhood");
        assert_eq!(signs_task.projects, vec!["GarageSale"]);
        assert_eq!(grocery_task.description, "pies");
        assert_eq!(grocery_task.contexts, vec!["GroceryStore"]);
    }

    #[test]
    fn parses_incomplete_item_with_priority_creation_project_and_context() {
        let item = parse_line(1, "(A) 2011-03-02 Call Mom +Family @phone").unwrap();

        assert!(!item.completed);
        assert_eq!(item.priority, Some('A'));
        assert_eq!(item.creation_date.as_deref(), Some("2011-03-02"));
        assert_eq!(item.completion_date, None);
        assert_eq!(item.description, "Call Mom");
        assert_eq!(item.projects, vec!["Family"]);
        assert_eq!(item.contexts, vec!["phone"]);
    }

    #[test]
    fn parses_incomplete_item_with_date_first() {
        let item = parse_line(1, "2011-03-02 Document +TodoTxt").unwrap();

        assert_eq!(item.priority, None);
        assert_eq!(item.creation_date.as_deref(), Some("2011-03-02"));
        assert_eq!(item.description, "Document");
        assert_eq!(item.projects, vec!["TodoTxt"]);
    }

    #[test]
    fn parses_completed_item_with_completion_and_creation_dates() {
        let item = parse_line(1, "x 2011-03-03 2011-03-02 Call Mom").unwrap();

        assert!(item.completed);
        assert_eq!(item.completion_date.as_deref(), Some("2011-03-03"));
        assert_eq!(item.creation_date.as_deref(), Some("2011-03-02"));
        assert_eq!(item.description, "Call Mom");
    }

    #[test]
    fn parses_metadata() {
        let item = parse_line(1, "Buy milk due:2010-01-02").unwrap();

        assert_eq!(item.description, "Buy milk");
        assert_eq!(
            item.metadata.get("due").map(String::as_str),
            Some("2010-01-02")
        );
    }

    #[test]
    fn parses_multiple_metadata_tokens() {
        let item = parse_line(1, "Review PR +TodoTxt @github due:2026-05-25 pri:A").unwrap();

        assert_eq!(item.description, "Review PR");
        assert_eq!(item.projects, vec!["TodoTxt"]);
        assert_eq!(item.contexts, vec!["github"]);
        assert_eq!(
            item.metadata.get("due").map(String::as_str),
            Some("2026-05-25")
        );
        assert_eq!(item.metadata.get("pri").map(String::as_str), Some("A"));
    }

    #[test]
    fn treats_invalid_metadata_tokens_as_description_text() {
        let item = parse_line(1, "Email SoAndSo at soandso@example.com key:value:extra").unwrap();

        assert_eq!(
            item.description,
            "Email SoAndSo at soandso@example.com key:value:extra"
        );
        assert!(item.metadata.is_empty());
    }

    #[test]
    fn treats_mid_line_priority_token_as_description_text() {
        let item = parse_line(1, "Really gotta call Mom (A) @phone").unwrap();

        assert_eq!(item.priority, None);
        assert_eq!(item.description, "Really gotta call Mom (A)");
        assert_eq!(item.contexts, vec!["phone"]);
    }

    #[test]
    fn treats_lowercase_priority_like_token_as_description_text() {
        let item = parse_line(1, "(b) Get back to the boss").unwrap();

        assert_eq!(item.priority, None);
        assert_eq!(item.description, "(b) Get back to the boss");
    }

    #[test]
    fn treats_priority_without_following_space_as_description_text() {
        let item = parse_line(1, "(B)->Submit TPS report").unwrap();

        assert_eq!(item.priority, None);
        assert_eq!(item.description, "(B)->Submit TPS report");
    }

    #[test]
    fn only_treats_creation_date_as_creation_date_when_prepended() {
        let item = parse_line(1, "(A) Call Mom 2011-03-02").unwrap();

        assert_eq!(item.priority, Some('A'));
        assert_eq!(item.creation_date, None);
        assert_eq!(item.description, "Call Mom 2011-03-02");
    }

    #[test]
    fn parses_completed_item_without_completion_date() {
        let item = parse_line(1, "x Call Mom +Family @phone").unwrap();

        assert!(item.completed);
        assert_eq!(item.completion_date, None);
        assert_eq!(item.creation_date, None);
        assert_eq!(item.description, "Call Mom");
        assert_eq!(item.projects, vec!["Family"]);
        assert_eq!(item.contexts, vec!["phone"]);
    }

    #[test]
    fn parses_completed_item_without_creation_date() {
        let item = parse_line(1, "x 2011-03-03 Call Mom").unwrap();

        assert!(item.completed);
        assert_eq!(item.completion_date.as_deref(), Some("2011-03-03"));
        assert_eq!(item.creation_date, None);
        assert_eq!(item.description, "Call Mom");
    }

    #[test]
    fn parses_multiple_projects_and_contexts() {
        let item = parse_line(
            1,
            "(A) Call Mom +Family +PeaceLoveAndHappiness @iphone @phone",
        )
        .unwrap();

        assert_eq!(item.projects, vec!["Family", "PeaceLoveAndHappiness"]);
        assert_eq!(item.contexts, vec!["iphone", "phone"]);
    }

    #[test]
    fn parses_tasks_without_contexts_or_projects() {
        let email_task = parse_line(1, "Email SoAndSo at soandso@example.com").unwrap();
        let math_task = parse_line(2, "Learn how to add 2+2").unwrap();

        assert_eq!(
            email_task.description,
            "Email SoAndSo at soandso@example.com"
        );
        assert!(email_task.projects.is_empty());
        assert!(email_task.contexts.is_empty());
        assert_eq!(math_task.description, "Learn how to add 2+2");
        assert!(math_task.projects.is_empty());
        assert!(math_task.contexts.is_empty());
    }

    #[test]
    fn keeps_priority_x_as_incomplete_task_text() {
        let item = parse_line(1, "(A) x Find ticket prices").unwrap();

        assert!(!item.completed);
        assert_eq!(item.priority, Some('A'));
        assert_eq!(item.description, "x Find ticket prices");
    }

    #[test]
    fn parses_xylophone_as_incomplete_item() {
        let item = parse_line(1, "xylophone lesson").unwrap();

        assert!(!item.completed);
        assert_eq!(item.description, "xylophone lesson");
    }

    #[test]
    fn parses_uppercase_x_as_incomplete_item() {
        let item = parse_line(1, "X 2012-01-01 Make resolutions").unwrap();

        assert!(!item.completed);
        assert_eq!(item.description, "X 2012-01-01 Make resolutions");
    }

    #[test]
    fn ignores_empty_lines() {
        let (items, skipped) = parse_file("\n  \n\t\n");

        assert!(items.is_empty());
        assert!(skipped.is_empty());
    }

    #[test]
    fn preserves_line_number_and_raw_text() {
        let item = parse_line(42, "  (C) Call Mom @phone  ").unwrap();

        assert_eq!(item.line_number, 42);
        assert_eq!(item.raw, "  (C) Call Mom @phone  ");
        assert_eq!(item.priority, Some('C'));
        assert_eq!(item.description, "Call Mom");
    }

    #[test]
    fn parses_valid_lines_and_skips_invalid_lines() {
        let contents = "(A) Call Mom\nx 2026-99-99 Done item\n2011-03-02 Document +TodoTxt\n";
        let (items, skipped) = parse_file(contents);

        assert_eq!(items.len(), 2);
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].line_number, 2);
        assert_eq!(skipped[0].reason, ParseLineError::InvalidDate.to_string());
    }

    #[test]
    fn parse_file_preserves_skipped_line_details() {
        let contents = "First valid task\n\n2026-13-01 Bad date\nSecond valid task +Project\n";
        let (items, skipped) = parse_file(contents);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].line_number, 1);
        assert_eq!(items[1].line_number, 4);
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].line_number, 3);
        assert_eq!(skipped[0].raw, "2026-13-01 Bad date");
        assert_eq!(skipped[0].reason, ParseLineError::InvalidDate.to_string());
    }

    #[test]
    fn skips_invalid_prepended_creation_date() {
        let error = parse_line(1, "2026-99-99 Impossible date").unwrap_err();

        assert_eq!(error, ParseLineError::InvalidDate);
    }

    #[test]
    fn skips_lines_without_description_text() {
        let error = parse_line(1, "+Project @context due:2026-05-25").unwrap_err();

        assert_eq!(error, ParseLineError::EmptyDescription);
    }

    #[test]
    fn parses_example_todo_file() {
        let contents = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/todo.txt"));
        let (items, skipped) = parse_file(contents);

        assert_eq!(items.len(), 20);
        assert!(skipped.is_empty());

        let first = &items[0];
        assert_eq!(first.priority, Some('A'));
        assert_eq!(first.creation_date.as_deref(), Some("2026-05-24"));
        assert_eq!(first.projects, vec!["TuxedoApp"]);
        assert_eq!(first.contexts, vec!["computer"]);
        assert_eq!(
            first.metadata.get("due").map(String::as_str),
            Some("2026-05-25")
        );

        let no_optional_fields = &items[5];
        assert_eq!(no_optional_fields.description, "Plan next feature");
        assert_eq!(no_optional_fields.priority, None);
        assert_eq!(no_optional_fields.creation_date, None);
        assert_eq!(no_optional_fields.completion_date, None);
        assert!(no_optional_fields.projects.is_empty());
        assert!(no_optional_fields.contexts.is_empty());
        assert!(no_optional_fields.metadata.is_empty());

        let multi_project_context = &items[6];
        assert_eq!(multi_project_context.description, "Capture inbox item");
        assert_eq!(multi_project_context.projects, vec!["TuxedoApp", "Ideas"]);
        assert_eq!(multi_project_context.contexts, vec!["home", "computer"]);

        let completed_no_metadata = &items[10];
        assert!(completed_no_metadata.completed);
        assert_eq!(
            completed_no_metadata.description,
            "Ship completed task with no extra metadata"
        );
        assert!(completed_no_metadata.projects.is_empty());
        assert!(completed_no_metadata.contexts.is_empty());
        assert!(completed_no_metadata.metadata.is_empty());

        assert_eq!(
            items[16].description,
            "(b) Lowercase priority-looking token is plain text"
        );
        assert_eq!(items[16].contexts, vec!["work"]);
        assert_eq!(
            items[17].description,
            "(B)->Priority without space is plain text"
        );
        assert_eq!(items[17].projects, vec!["SpecExamples"]);

        let everything = &items[18];
        assert!(everything.completed);
        assert_eq!(everything.completion_date.as_deref(), Some("2026-05-24"));
        assert_eq!(everything.creation_date.as_deref(), Some("2026-05-23"));
        assert_eq!(everything.description, "Finish release");
        assert_eq!(everything.projects, vec!["TuxedoApp", "Release"]);
        assert_eq!(everything.contexts, vec!["computer", "github"]);
        assert_eq!(
            everything.metadata.get("due").map(String::as_str),
            Some("2026-05-24")
        );
        assert_eq!(
            everything.metadata.get("pri").map(String::as_str),
            Some("A")
        );

        let completed_without_date = items.last().unwrap();
        assert!(completed_without_date.completed);
        assert_eq!(completed_without_date.completion_date, None);
        assert_eq!(completed_without_date.projects, vec!["OptionalDateExample"]);
    }

    #[test]
    fn parses_spec_examples_fixture() {
        let contents = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/spec_examples.todo.txt"
        ));
        let (items, skipped) = parse_file(contents);

        assert_eq!(items.len(), 18);
        assert!(skipped.is_empty());

        assert_eq!(items[0].priority, Some('A'));
        assert_eq!(items[0].description, "Thank Mom for the meatballs");
        assert_eq!(items[0].contexts, vec!["phone"]);

        assert_eq!(items[3].description, "pies");
        assert_eq!(items[3].contexts, vec!["GroceryStore"]);

        assert_eq!(items[6].priority, Some('A'));
        assert_eq!(items[6].creation_date, None);
        assert_eq!(items[6].description, "Call Mom 2011-03-02");

        assert_eq!(items[7].projects, vec!["Family", "PeaceLoveAndHappiness"]);
        assert_eq!(items[7].contexts, vec!["iphone", "phone"]);

        assert!(items[10].completed);
        assert_eq!(items[10].completion_date.as_deref(), Some("2011-03-03"));
        assert_eq!(items[10].creation_date, None);

        assert!(items[11].completed);
        assert_eq!(items[11].completion_date.as_deref(), Some("2011-03-02"));
        assert_eq!(items[11].creation_date.as_deref(), Some("2011-03-01"));
        assert_eq!(items[11].projects, vec!["TodoTxtTouch"]);
        assert_eq!(items[11].contexts, vec!["github"]);

        assert!(!items[12].completed);
        assert_eq!(items[12].description, "xylophone lesson");
        assert!(!items[13].completed);
        assert_eq!(items[13].description, "X 2012-01-01 Make resolutions");
        assert!(!items[14].completed);
        assert_eq!(items[14].priority, Some('A'));
        assert_eq!(items[14].description, "x Find ticket prices");

        assert_eq!(items[15].priority, None);
        assert_eq!(items[15].description, "Really gotta call Mom (A)");
        assert_eq!(items[15].contexts, vec!["phone", "someday"]);
        assert_eq!(items[16].description, "(b) Get back to the boss");
        assert_eq!(items[17].description, "(B)->Submit TPS report");
    }

    #[test]
    fn parses_mixed_real_world_fixture_with_expected_skips() {
        let contents = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/mixed_real_world.todo.txt"
        ));
        let (items, skipped) = parse_file(contents);

        assert_eq!(items.len(), 5);
        assert_eq!(skipped.len(), 3);

        assert_eq!(items[0].line_number, 1);
        assert_eq!(items[0].priority, Some('A'));
        assert_eq!(items[0].creation_date.as_deref(), Some("2026-05-24"));
        assert_eq!(items[0].description, "Ship parser fixture");
        assert_eq!(items[0].projects, vec!["TuxedoApp"]);
        assert_eq!(items[0].contexts, vec!["computer"]);
        assert_eq!(
            items[0].metadata.get("due").map(String::as_str),
            Some("2026-05-25")
        );
        assert_eq!(items[0].metadata.get("pri").map(String::as_str), Some("A"));

        assert_eq!(items[1].line_number, 3);
        assert!(items[1].completed);
        assert_eq!(items[1].completion_date.as_deref(), Some("2026-05-24"));
        assert_eq!(items[1].creation_date.as_deref(), Some("2026-05-23"));

        assert_eq!(items[2].line_number, 7);
        assert!(items[2].completed);
        assert_eq!(items[2].completion_date, None);
        assert_eq!(items[2].description, "Completed without date");

        assert_eq!(items[4].line_number, 9);
        assert_eq!(
            items[4].description,
            "Task with invalid metadata key:value:extra"
        );
        assert_eq!(items[4].contexts, vec!["computer"]);
        assert!(items[4].metadata.is_empty());

        assert_eq!(skipped[0].line_number, 4);
        assert_eq!(
            skipped[0].raw,
            "2026-13-01 Impossible creation date +Broken"
        );
        assert_eq!(skipped[0].reason, ParseLineError::InvalidDate.to_string());
        assert_eq!(skipped[1].line_number, 5);
        assert_eq!(
            skipped[1].raw,
            "x 2026-99-99 Impossible completion date +Broken"
        );
        assert_eq!(skipped[1].reason, ParseLineError::InvalidDate.to_string());
        assert_eq!(skipped[2].line_number, 6);
        assert_eq!(skipped[2].raw, "+OnlyMetadata @only due:2026-05-25");
        assert_eq!(
            skipped[2].reason,
            ParseLineError::EmptyDescription.to_string()
        );
    }
}
