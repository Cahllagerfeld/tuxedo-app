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

    let file = AtomicFile::new(path, OverwriteBehavior::AllowOverwrite);
    file.write(|target| target.write_all(rewritten.as_bytes()))?;
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
