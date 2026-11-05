//! Recurring completion with parity to `packages/backend/src/recurrence.ts`: completing an open
//! item with a supported `rec:` rule marks it generated and inserts its successor right after it.

use crate::completion::BOARD_DONE_KEY;
use std::path::PathBuf;

use crate::{parse_todo_text, TodoDate, TodoItem};

pub(crate) const GENERATION_MARKER: &str = "tuxedo-generated";

const RANGE_ERROR: &str = "The recurrence interval exceeds the supported date range.";
const SHOW_FROM_ERROR: &str = "The next Show from date is outside the supported date range.";

/// The planned replacement of the source's physical line (without its line ending; a successor
/// is joined with an inner line ending) and the notice to show.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CompletionPlan {
    pub raw: String,
    pub notice: Option<String>,
}

/// Plans completing `source` as `raw` (its completed line) in a file whose physical line
/// `source.line_number` ends with `ending`; `first_ending` is the file's first line ending.
pub(crate) fn plan_recurring_completion(
    source: &TodoItem,
    raw: String,
    today: TodoDate,
    ending: &str,
    first_ending: Option<&str>,
) -> Result<CompletionPlan, &'static str> {
    let completed = parse_todo_text(PathBuf::new(), &raw)
        .items
        .into_iter()
        .next()
        .filter(|item| item.completed)
        .ok_or("Invalid completed Todo item.")?;
    let plain = |raw| Ok(CompletionPlan { raw, notice: None });
    let generated = source.metadata.iter().any(|(k, _)| k == GENERATION_MARKER);
    let Some(rule) = completed
        .metadata_value("rec")
        .filter(|_| !source.completed && !generated)
    else {
        return plain(raw);
    };
    let Some((interval, unit)) = parse_rule(rule) else {
        return Ok(CompletionPlan {
            raw,
            notice: Some("Unsupported Repeat rule; no next occurrence generated.".to_owned()),
        });
    };
    let anchor = completed
        .completion_date
        .ok_or("Recurring completion requires a valid Completion date.")?;
    let due = next_due_date(anchor, interval, unit)?;

    let priority = source.priority;
    if let Some(priority) = priority {
        let own = format!("pri:{priority}");
        if completed
            .edit
            .metadata
            .iter()
            .any(|token| token.starts_with("pri:") && *token != own)
        {
            return Err(
                "Conflicting priority metadata; edit the Todo file before completing this item.",
            );
        }
    }
    let show = completed.metadata_value("t").and_then(TodoDate::parse);
    let source_due = completed.metadata_value("due").and_then(TodoDate::parse);
    let show_from = match (show, source_due) {
        (Some(show), Some(source_due)) => Some(next_show_from(show, source_due, due)?),
        _ => None,
    };
    let absolute_threshold =
        |token: &str| token.strip_prefix("t:").and_then(TodoDate::parse).is_some();
    let own_priority = priority.map(|p| format!("pri:{p}"));
    let mut metadata: Vec<String> = completed
        .edit
        .metadata
        .iter()
        .filter(|token| {
            !token.starts_with("due:")
                && !token.starts_with("board:")
                && !token.starts_with(&format!("{BOARD_DONE_KEY}:"))
                && !token.starts_with(&format!("{GENERATION_MARKER}:"))
                && own_priority.as_deref() != Some(token.as_str())
                && !(show.is_some() && show_from.is_none() && absolute_threshold(token))
        })
        .cloned()
        .collect();
    if let Some(show_from) = show_from {
        if let Some(last) = metadata.iter().rposition(|t| absolute_threshold(t)) {
            metadata[last] = format!("t:{show_from}");
        }
    }
    metadata.push(format!("due:{due}"));

    let description = completed
        .edit
        .description
        .split(char::is_whitespace)
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let successor = priority
        .map(|p| format!("({p})"))
        .into_iter()
        .chain([today.to_string(), description])
        .chain(completed.projects.iter().map(|p| format!("+{p}")))
        .chain(completed.contexts.iter().map(|c| format!("@{c}")))
        .chain(metadata)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let separator = if ending.is_empty() {
        first_ending.unwrap_or("\n")
    } else {
        ending
    };
    let notice = match show_from {
        Some(show_from) if show_from > today => {
            format!("Next occurrence due {due}. Show from {show_from}.")
        }
        _ => format!("Next occurrence due {due}."),
    };
    Ok(CompletionPlan {
        raw: format!("{raw} {GENERATION_MARKER}:1{separator}{successor}"),
        notice: Some(notice),
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Unit {
    Day,
    Week,
    Month,
    Year,
}

/// A supported Repeat rule, `^[1-9][0-9]*[dwmy]$`. The interval may be too large to compute.
fn parse_rule(rule: &str) -> Option<(Option<u64>, Unit)> {
    let (digits, unit) = rule.split_at(rule.len().checked_sub(1)?);
    let unit = match unit {
        "d" => Unit::Day,
        "w" => Unit::Week,
        "m" => Unit::Month,
        "y" => Unit::Year,
        _ => return None,
    };
    let b = digits.as_bytes();
    let supported = !b.is_empty() && b[0] != b'0' && b.iter().all(u8::is_ascii_digit);
    supported.then(|| (digits.parse().ok(), unit))
}

/// The next Due date: `interval` units after the Completion date, clamping the day of month.
fn next_due_date(
    anchor: TodoDate,
    interval: Option<u64>,
    unit: Unit,
) -> Result<TodoDate, &'static str> {
    let (year, month, day) = civil(anchor);
    let maximum = days_from_civil(9999, 12, 31);
    let limit = match unit {
        Unit::Year => 9999 - year,
        Unit::Month => (9999 - year) * 12 + 12 - month,
        Unit::Day | Unit::Week => maximum - days_from_civil(year, month, day),
    };
    let amount = match unit {
        Unit::Week => interval.and_then(|i| i.checked_mul(7)),
        _ => interval,
    }
    .and_then(|a| i64::try_from(a).ok())
    .filter(|a| *a <= limit)
    .ok_or(RANGE_ERROR)?;
    let (year, month, day) = match unit {
        Unit::Year => clamped(year + amount, month, day),
        Unit::Month => {
            let months = year * 12 + (month - 1) + amount;
            clamped(months / 12, months % 12 + 1, day)
        }
        Unit::Day | Unit::Week => civil_from_days(days_from_civil(year, month, day) + amount),
    };
    Ok(date(year, month, day))
}

/// Keeps the source's Show-from-minus-Due offset relative to the next Due date.
fn next_show_from(
    show: TodoDate,
    source_due: TodoDate,
    due: TodoDate,
) -> Result<TodoDate, &'static str> {
    let days = |d: TodoDate| {
        let (y, m, day) = civil(d);
        days_from_civil(y, m, day)
    };
    let shifted = days(due) + days(show) - days(source_due);
    if shifted < days_from_civil(1, 1, 1) || shifted > days_from_civil(9999, 12, 31) {
        return Err(SHOW_FROM_ERROR);
    }
    let (y, m, d) = civil_from_days(shifted);
    Ok(date(y, m, d))
}

fn civil(date: TodoDate) -> (i64, i64, i64) {
    let s = date.as_str();
    let num = |r: std::ops::Range<usize>| s[r].parse::<i64>().expect("TodoDate is numeric");
    (num(0..4), num(5..7), num(8..10))
}

fn date(year: i64, month: i64, day: i64) -> TodoDate {
    TodoDate::parse(&format!("{year:04}-{month:02}-{day:02}")).expect("a valid calendar date")
}

fn days_in_month(year: i64, month: i64) -> i64 {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn clamped(year: i64, month: i64, day: i64) -> (i64, i64, i64) {
    (year, month, day.min(days_in_month(year, month)))
}

/// Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
