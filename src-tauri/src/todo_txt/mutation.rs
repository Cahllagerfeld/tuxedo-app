use atomicwrites::{AtomicFile, OverwriteBehavior};
use chrono::NaiveDate;
use std::io::Write;
use std::path::Path;

use super::parser;

pub fn set_completion(
    path: &Path,
    line_number: u32,
    expected_raw: &str,
    completed: bool,
    today: NaiveDate,
) -> Result<(), MutationError> {
    let contents = std::fs::read_to_string(path)?;
    let expected_item = parser::parse_line(line_number, expected_raw)
        .map_err(|error| MutationError::Invalid(error.to_string()))?;
    if expected_item.completed == completed {
        return Err(MutationError::Invalid(format!(
            "Todo item is already {}",
            if completed { "completed" } else { "open" }
        )));
    }
    let mut rewritten = String::with_capacity(contents.len() + 13);
    let mut found = false;

    for (index, line) in contents.split_inclusive('\n').enumerate() {
        if index + 1 != line_number as usize {
            rewritten.push_str(line);
            continue;
        }

        found = true;
        let (body, ending) = split_line_ending(line);
        if body != expected_raw {
            return Err(MutationError::Conflict);
        }

        if completed {
            rewritten.push_str("x ");
            rewritten.push_str(&today.format("%Y-%m-%d").to_string());
            rewritten.push(' ');
            rewritten.push_str(&completion_body(
                expected_raw,
                expected_item.priority.is_some(),
            ));
        } else {
            rewritten.push_str(&uncompleted_raw(line_number, expected_raw)?);
        }
        rewritten.push_str(ending);
    }

    if !found {
        return Err(MutationError::Conflict);
    }

    write_todo_file(path, &rewritten)
}

pub fn delete(path: &Path, line_number: u32, expected_raw: &str) -> Result<(), MutationError> {
    parser::parse_line(line_number, expected_raw)
        .map_err(|error| MutationError::Invalid(error.to_string()))?;

    let contents = std::fs::read_to_string(path)?;
    let mut rewritten = String::with_capacity(contents.len());
    let mut found = false;

    for (index, line) in contents.split_inclusive('\n').enumerate() {
        if index + 1 != line_number as usize {
            rewritten.push_str(line);
            continue;
        }

        found = true;
        let (body, _) = split_line_ending(line);
        if body != expected_raw {
            return Err(MutationError::Conflict);
        }
    }

    if !found {
        return Err(MutationError::Conflict);
    }

    write_todo_file(path, &rewritten)
}

pub fn create(
    path: &Path,
    description: &str,
    projects: &[String],
    contexts: &[String],
    today: NaiveDate,
) -> Result<(), MutationError> {
    let description = normalize_description(description)?;
    let projects = normalize_tags(projects, '+', "Project")?;
    let contexts = normalize_tags(contexts, '@', "Context")?;
    let line = format_created_line(&description, &projects, &contexts, today);

    let contents = std::fs::read_to_string(path)?;
    let ending = line_ending_for(&contents).to_owned();
    let mut rewritten = contents;
    if !rewritten.is_empty() && !rewritten.ends_with('\n') {
        rewritten.push_str(&ending);
    }
    rewritten.push_str(&line);
    rewritten.push_str(&ending);

    write_todo_file(path, &rewritten)
}

fn normalize_description(description: &str) -> Result<String, MutationError> {
    let normalized = description.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err(MutationError::Invalid(
            "Todo item Description must be non-empty".into(),
        ));
    }

    for token in normalized.split_whitespace() {
        if is_structured_token(token) {
            return Err(MutationError::Invalid(format!(
                "Description must not contain standalone Project, Context, or Metadata token: {token}"
            )));
        }
    }

    Ok(normalized)
}

fn normalize_tags(
    tags: &[String],
    prefix: char,
    kind: &str,
) -> Result<Vec<String>, MutationError> {
    let mut normalized = Vec::with_capacity(tags.len());

    for tag in tags {
        let value = tag.trim();
        let value = value
            .strip_prefix(prefix)
            .unwrap_or(value)
            .trim();
        if value.is_empty() {
            return Err(MutationError::Invalid(format!(
                "{kind} must be non-empty"
            )));
        }
        if value.chars().any(char::is_whitespace) {
            return Err(MutationError::Invalid(format!(
                "{kind} must not contain whitespace: {value}"
            )));
        }
        if normalized.iter().any(|existing: &String| existing == value) {
            return Err(MutationError::Invalid(format!(
                "duplicate {kind}: {value}"
            )));
        }
        normalized.push(value.to_string());
    }

    Ok(normalized)
}

fn is_structured_token(token: &str) -> bool {
    if let Some(project) = token.strip_prefix('+') {
        if !project.is_empty() {
            return true;
        }
    }
    if let Some(context) = token.strip_prefix('@') {
        if !context.is_empty() {
            return true;
        }
    }
    if let Some((key, value)) = token.split_once(':') {
        if !key.is_empty() && !value.is_empty() && !value.contains(':') {
            return true;
        }
    }
    false
}

fn format_created_line(
    description: &str,
    projects: &[String],
    contexts: &[String],
    today: NaiveDate,
) -> String {
    let mut parts = Vec::with_capacity(1 + projects.len() + contexts.len() + 1);
    parts.push(today.format("%Y-%m-%d").to_string());
    parts.push(description.to_owned());
    for project in projects {
        parts.push(format!("+{project}"));
    }
    for context in contexts {
        parts.push(format!("@{context}"));
    }
    parts.join(" ")
}

fn line_ending_for(contents: &str) -> &str {
    if contents.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn write_todo_file(path: &Path, contents: &str) -> Result<(), MutationError> {
    let file = AtomicFile::new(path, OverwriteBehavior::AllowOverwrite);
    file.write(|target| target.write_all(contents.as_bytes()))?;
    Ok(())
}

fn uncompleted_raw(line_number: u32, raw: &str) -> Result<String, MutationError> {
    let item = parser::parse_line(line_number, raw)
        .map_err(|error| MutationError::Invalid(error.to_string()))?;
    if !item.completed {
        return Err(MutationError::Invalid(
            "cannot uncomplete an open Todo item".into(),
        ));
    }

    let trimmed_start = raw.trim_start();
    let leading = &raw[..raw.len() - trimmed_start.len()];
    let after_marker = trimmed_start
        .strip_prefix("x ")
        .ok_or_else(|| MutationError::Invalid("completion marker is missing".into()))?;
    let remaining = if item.completion_date.is_some() {
        after_marker.get(11..).unwrap_or_default()
    } else {
        after_marker
    };
    Ok(format!("{leading}{remaining}"))
}

fn split_line_ending(line: &str) -> (&str, &str) {
    if let Some(body) = line.strip_suffix("\r\n") {
        (body, "\r\n")
    } else if let Some(body) = line.strip_suffix('\n') {
        (body, "\n")
    } else {
        (line, "")
    }
}

fn completion_body(raw: &str, has_priority: bool) -> String {
    if has_priority {
        let trimmed_start = raw.trim_start();
        let leading = &raw[..raw.len() - trimmed_start.len()];
        format!("{leading}{}", &trimmed_start[4..])
    } else {
        raw.to_owned()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MutationError {
    #[error("Todo item changed externally")]
    Conflict,
    #[error("invalid Todo item mutation: {0}")]
    Invalid(String),
    #[error("failed to read Todo file: {0}")]
    Read(#[from] std::io::Error),
    #[error("failed to write Todo file atomically: {0}")]
    AtomicWrite(#[from] atomicwrites::Error<std::io::Error>),
}
