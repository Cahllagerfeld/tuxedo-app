//! The List view's text query: tokenizing, parsing into [`TodoFilters`], and writing the
//! canonical query back. Pure functions; parsing never panics.
//!
//! A query is words separated by JavaScript whitespace (the rule the Electron search used).
//! `+name`, `@name`, `pri:X`, `due:category`, and `is:view` are conditions; every other word
//! is search text. The `pri:`, `due:`, and `is:` prefixes are always reserved. A word that
//! starts with `"` is a quoted phrase: one literal search word up to the closing `"`, where
//! `\"` is a quote and `\\` a backslash. `+"…"` and `@"…"` quote a Project or Context name.

use std::fmt;
use std::ops::Range;

use super::{is_js_whitespace, CompletionView, TodoFilters};
use crate::todo::DueCategory;

/// The version of this grammar, to store beside saved queries so a later grammar never
/// reinterprets an old query's literal words.
pub const QUERY_GRAMMAR_VERSION: u32 = 1;

/// Why a query cannot be applied, with the byte range of the offending text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryError {
    /// Byte range in the query, for highlighting.
    pub span: Range<usize>,
    pub kind: QueryErrorKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryErrorKind {
    /// A second condition for a single-valued key.
    Repeated(QueryKey),
    /// A value the key does not accept, as typed.
    UnknownValue(QueryKey, String),
    /// `is:completed` together with `pri:` or `due:`.
    CompletedWithPriorityOrDue,
    /// A Project or Context name that no Todo item can carry: empty or with whitespace.
    InvalidName(char),
    /// `""`, which would match everything.
    EmptyPhrase,
    /// A quoted phrase without its closing quote.
    UnterminatedQuote,
    /// A backslash in quotes followed by something other than `"` or `\`.
    InvalidEscape,
    /// Text directly after a closing quote.
    TextAfterQuote,
}

/// A single-valued condition key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryKey {
    Priority,
    Due,
    Completion,
}

impl QueryKey {
    const ALL: [Self; 3] = [Self::Priority, Self::Due, Self::Completion];

    /// The key as written in a query, with its colon.
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Priority => "pri:",
            Self::Due => "due:",
            Self::Completion => "is:",
        }
    }

    fn noun(self) -> &'static str {
        match self {
            Self::Priority => "Priority",
            Self::Due => "Due date",
            Self::Completion => "completion view",
        }
    }
}

/// The `due:` values in display order, with the category each names.
pub const DUE_VALUES: [(&str, DueCategory); 5] = [
    ("overdue", DueCategory::Overdue),
    ("today", DueCategory::Today),
    ("upcoming", DueCategory::Upcoming),
    ("none", DueCategory::None),
    ("invalid", DueCategory::Invalid),
];

/// The `is:` values in display order, with the view each names.
pub const COMPLETION_VALUES: [(&str, CompletionView); 3] = [
    ("all", CompletionView::All),
    ("open", CompletionView::Open),
    ("completed", CompletionView::Completed),
];

impl fmt::Display for QueryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.kind {
            QueryErrorKind::Repeated(key) => write!(
                f,
                "A query can filter by only one {}; remove one {}.",
                key.noun(),
                key.prefix()
            ),
            QueryErrorKind::UnknownValue(key, value) => {
                let expected = match key {
                    QueryKey::Priority => "a letter A to Z".to_owned(),
                    QueryKey::Due => one_of(DUE_VALUES.map(|(name, _)| name)),
                    QueryKey::Completion => one_of(COMPLETION_VALUES.map(|(name, _)| name)),
                };
                write!(
                    f,
                    "Unknown {} \u{201c}{value}\u{201d}; use {expected}.",
                    key.noun()
                )
            }
            QueryErrorKind::CompletedWithPriorityOrDue => {
                f.write_str("Completed views cannot filter by Due date or Priority.")
            }
            QueryErrorKind::InvalidName(sigil) => {
                let noun = if *sigil == '+' { "Project" } else { "Context" };
                write!(f, "A {noun} name cannot be empty or contain spaces.")
            }
            QueryErrorKind::EmptyPhrase => f.write_str("Type a phrase between the quotes."),
            QueryErrorKind::InvalidEscape => f.write_str(
                "In quotes, a backslash can only escape a quote (\\\") or a backslash (\\\\).",
            ),
            QueryErrorKind::UnterminatedQuote => {
                f.write_str("This quoted phrase needs a closing quote.")
            }
            QueryErrorKind::TextAfterQuote => f.write_str("Add a space after the closing quote."),
        }
    }
}

impl std::error::Error for QueryError {}

fn one_of<const N: usize>(names: [&str; N]) -> String {
    match names.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{}, or {last}", rest.join(", ")),
        Some((last, _)) => (*last).to_owned(),
        None => String::new(),
    }
}

/// One word of a query and where it is.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Word {
    /// The word as typed.
    span: Range<usize>,
    kind: WordKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum WordKind {
    /// Unquoted text, verbatim.
    Bare(String),
    /// A quoted phrase, unescaped: always search text.
    Phrase(String),
    /// `+` or `@` directly followed by a quoted, unescaped name.
    QuotedName(char, String),
}

/// Splits `query` into words on JavaScript whitespace; quoted phrases are unescaped.
fn tokenize(query: &str) -> Result<Vec<Word>, QueryError> {
    let mut words = Vec::new();
    let mut position = 0;
    while let Some(offset) = query[position..].find(|c| !is_js_whitespace(c)) {
        let start = position + offset;
        let rest = &query[start..];
        let (kind, end) = if rest.starts_with('"') {
            let (text, end) = read_quoted(query, start)?;
            (WordKind::Phrase(text), end)
        } else if let Some(sigil) = ['+', '@']
            .into_iter()
            .find(|&sigil| rest.strip_prefix(sigil).is_some_and(|r| r.starts_with('"')))
        {
            let (text, end) = read_quoted(query, start + 1)?;
            (WordKind::QuotedName(sigil, text), end)
        } else {
            let end = rest
                .find(is_js_whitespace)
                .map_or(query.len(), |len| start + len);
            (WordKind::Bare(query[start..end].to_owned()), end)
        };
        words.push(Word {
            span: start..end,
            kind,
        });
        position = end;
    }
    Ok(words)
}

/// Reads the quoted text whose `"` is at byte `open`, returning it unescaped and the byte
/// after the closing quote, which must be whitespace or the end of the query.
fn read_quoted(query: &str, open: usize) -> Result<(String, usize), QueryError> {
    let mut text = String::new();
    let mut chars = query[open + 1..]
        .char_indices()
        .map(|(index, c)| (open + 1 + index, c));
    while let Some((index, c)) = chars.next() {
        match c {
            '"' => {
                let end = index + 1;
                let stray = query[end..]
                    .find(is_js_whitespace)
                    .map_or(query.len(), |len| end + len);
                if stray > end {
                    return Err(QueryError {
                        span: end..stray,
                        kind: QueryErrorKind::TextAfterQuote,
                    });
                }
                return Ok((text, end));
            }
            '\\' => match chars.next() {
                Some((_, escaped @ ('"' | '\\'))) => text.push(escaped),
                Some((next, other)) => {
                    return Err(QueryError {
                        span: index..next + other.len_utf8(),
                        kind: QueryErrorKind::InvalidEscape,
                    })
                }
                None => break,
            },
            _ => text.push(c),
        }
    }
    Err(QueryError {
        span: open..query.len(),
        kind: QueryErrorKind::UnterminatedQuote,
    })
}

/// The key a word starts with, matched case-insensitively, and the rest of the word.
fn split_key(word: &str) -> Option<(QueryKey, &str)> {
    QueryKey::ALL.into_iter().find_map(|key| {
        let prefix = key.prefix();
        let head = word.get(..prefix.len())?;
        head.eq_ignore_ascii_case(prefix)
            .then(|| (key, &word[prefix.len()..]))
    })
}

impl TodoFilters {
    /// Parses a text query. Conditions AND together; Projects and Contexts may repeat, while
    /// a second `pri:`, `due:`, or `is:` is an error, as is `is:completed` with `pri:` or
    /// `due:`. Keys and their values are case-insensitive; Project and Context names are
    /// exact. Without `is:`, the completion view is All.
    pub fn parse(query: &str) -> Result<Self, QueryError> {
        let mut filters = Self::default();
        let mut seen: [Option<Range<usize>>; 3] = [None, None, None];
        for Word { span, kind } in tokenize(query)? {
            let invalid = |kind| QueryError {
                span: span.clone(),
                kind,
            };
            let text = match kind {
                WordKind::Phrase(text) if text.is_empty() => {
                    return Err(invalid(QueryErrorKind::EmptyPhrase))
                }
                WordKind::Phrase(text) => {
                    filters.search.push(text);
                    continue;
                }
                WordKind::QuotedName(sigil, name) => {
                    filters.add_name(sigil, name).map_err(invalid)?;
                    continue;
                }
                WordKind::Bare(text) => text,
            };
            if let Some(sigil) = ['+', '@']
                .into_iter()
                .find(|&s| text.len() > 1 && text.starts_with(s))
            {
                filters
                    .add_name(sigil, text[1..].to_owned())
                    .map_err(invalid)?;
                continue;
            }
            let Some((key, value)) = split_key(&text) else {
                filters.search.push(text);
                continue;
            };
            let slot = &mut seen[key as usize];
            if slot.is_some() {
                return Err(invalid(QueryErrorKind::Repeated(key)));
            }
            *slot = Some(span.clone());
            let unknown = || invalid(QueryErrorKind::UnknownValue(key, value.to_owned()));
            let lower = value.to_ascii_lowercase();
            match key {
                QueryKey::Priority => {
                    let mut letters = value.chars();
                    match (letters.next(), letters.next()) {
                        (Some(letter), None) if letter.is_ascii_alphabetic() => {
                            filters.priority = Some(letter.to_ascii_uppercase());
                        }
                        _ => return Err(unknown()),
                    }
                }
                QueryKey::Due => {
                    let (_, due) = DUE_VALUES
                        .into_iter()
                        .find(|(name, _)| *name == lower)
                        .ok_or_else(unknown)?;
                    filters.due = Some(due);
                }
                QueryKey::Completion => {
                    let (_, view) = COMPLETION_VALUES
                        .into_iter()
                        .find(|(name, _)| *name == lower)
                        .ok_or_else(unknown)?;
                    filters.completion = view;
                }
            }
        }
        if filters.completion == CompletionView::Completed {
            // Point at whichever of the conflicting conditions came last.
            let [priority, due, completion] = seen;
            if priority.is_some() || due.is_some() {
                let span = [priority, due, completion]
                    .into_iter()
                    .flatten()
                    .max_by_key(|span| span.start)
                    .unwrap_or_default();
                return Err(QueryError {
                    span,
                    kind: QueryErrorKind::CompletedWithPriorityOrDue,
                });
            }
        }
        filters.projects.sort();
        filters.projects.dedup();
        filters.contexts.sort();
        filters.contexts.dedup();
        Ok(filters)
    }

    /// Adds a `+` Project or `@` Context name, which must be one a Todo item can carry.
    fn add_name(&mut self, sigil: char, name: String) -> Result<(), QueryErrorKind> {
        if name.is_empty() || name.contains(char::is_whitespace) {
            return Err(QueryErrorKind::InvalidName(sigil));
        }
        if sigil == '+' {
            self.projects.push(name);
        } else {
            self.contexts.push(name);
        }
        Ok(())
    }

    /// The canonical query: `is:` (unless All), `pri:`, `due:`, Projects and Contexts by code
    /// point, then search words in order, quoted where a bare word would read differently.
    /// For filters `parse` can produce, `parse(&f.to_query()) == Ok(f)`.
    pub fn to_query(&self) -> String {
        let mut words = Vec::new();
        if let Some((name, _)) = COMPLETION_VALUES
            .into_iter()
            .find(|&(_, view)| view == self.completion && view != CompletionView::All)
        {
            words.push(format!("is:{name}"));
        }
        if let Some(priority) = self.priority {
            words.push(format!("pri:{priority}"));
        }
        if let Some((name, _)) = DUE_VALUES
            .into_iter()
            .find(|&(_, due)| Some(due) == self.due)
        {
            words.push(format!("due:{name}"));
        }
        let mut projects: Vec<&String> = self.projects.iter().collect();
        projects.sort();
        projects.dedup();
        words.extend(projects.into_iter().map(|p| format!("+{}", quote_name(p))));
        let mut contexts: Vec<&String> = self.contexts.iter().collect();
        contexts.sort();
        contexts.dedup();
        words.extend(contexts.into_iter().map(|c| format!("@{}", quote_name(c))));
        words.extend(self.search.iter().map(|word| quote_if_needed(word)));
        words.join(" ")
    }
}

/// A search word as query text: bare when it would parse back as the same search word and
/// holds no quote or backslash, otherwise quoted.
fn quote_if_needed(word: &str) -> String {
    let token = word
        .strip_prefix(['+', '@'])
        .is_some_and(|rest| !rest.is_empty())
        || split_key(word).is_some();
    if token || needs_quotes(word) {
        quoted(word)
    } else {
        word.to_owned()
    }
}

/// A Project or Context name as query text after its sigil.
fn quote_name(name: &str) -> String {
    if needs_quotes(name) {
        quoted(name)
    } else {
        name.to_owned()
    }
}

fn needs_quotes(text: &str) -> bool {
    text.is_empty() || text.contains(|c| is_js_whitespace(c) || c == '"' || c == '\\')
}

/// `text` in double quotes, escaping backslashes and quotes.
fn quoted(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('"');
    for c in text.chars() {
        if matches!(c, '"' | '\\') {
            quoted.push('\\');
        }
        quoted.push(c);
    }
    quoted.push('"');
    quoted
}
