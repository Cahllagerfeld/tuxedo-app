//! Todo items typed as todo.txt lines: the vocabulary autocomplete offers while typing one, and
//! [`LineField`], the state one line input keeps (quick add and the row editor each own one).
//! Accepting a suggestion writes its word literally, except that `pri:A` becomes the line's
//! leading `(A)`, as todo.txt writes a Priority.

use std::ops::Range;

use chrono::{Datelike, Days, NaiveDate};
use gpui_kit::component::calendar::CalendarState;
use gpui_kit::component::input::InputState;
use gpui_kit::*;
use tuxedo_core::{line_with_date, line_with_priority, line_word_at, Facets, LineDate, TodoDate};

use crate::completion_field::{Completion, CompletionKey, Offer, MAX_OFFERS};
use crate::todo_commands::Reply;

/// One suggestion for a line word, and what accepting it writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineSuggestion {
    pub offer: Offer,
    /// `Some` for a Priority, which goes to the start of the line.
    pub priority: Option<char>,
}

impl LineSuggestion {
    fn token(token: String, detail: String) -> Self {
        Self {
            offer: Offer { token, detail },
            priority: None,
        }
    }
}

/// `today` moved by `days`.
pub fn date_after(today: TodoDate, days: u64) -> TodoDate {
    let date = NaiveDate::parse_from_str(today.as_str(), "%Y-%m-%d")
        .ok()
        .and_then(|d| d.checked_add_days(Days::new(days)));
    date.and_then(|d| TodoDate::parse(&d.format("%Y-%m-%d").to_string()))
        .unwrap_or(today)
}

/// The Monday after `today`.
pub fn next_monday(today: TodoDate) -> TodoDate {
    let weekday = NaiveDate::parse_from_str(today.as_str(), "%Y-%m-%d")
        .map(|d| d.weekday().num_days_from_monday())
        .unwrap_or(0);
    date_after(today, 7 - u64::from(weekday))
}

/// The named dates `due:` and `t:` offer.
pub fn date_shortcuts(today: TodoDate) -> [(&'static str, TodoDate); 3] {
    [
        ("today", today),
        ("tomorrow", date_after(today, 1)),
        ("next week", next_monday(today)),
    ]
}

const REPEATS: [(&str, &str); 5] = [
    ("1d", "daily"),
    ("1w", "weekly"),
    ("2w", "every two weeks"),
    ("1m", "monthly"),
    ("1y", "yearly"),
];

/// What the line word being typed can complete to: the Todo file's Projects and Contexts after
/// `+` and `@`, Priorities after `pri:`, today / tomorrow / next week as dates after `due:` and
/// `t:`, and common rules after `rec:`. What follows the sigil or key matches, ignoring case,
/// as a prefix of the value (or of a date's name).
pub fn suggestions(word: &str, facets: &Facets, today: TodoDate) -> Vec<LineSuggestion> {
    let after = |prefix: &str| {
        let head = word.get(..prefix.len())?;
        head.eq_ignore_ascii_case(prefix)
            .then(|| word[prefix.len()..].to_lowercase())
    };
    let starts = |value: &str, typed: &str| value.to_lowercase().starts_with(typed);
    let named = |typed: String, values: &[tuxedo_core::FacetValue], sigil: char, noun: &str| {
        values
            .iter()
            .filter(|f| starts(&f.value, &typed))
            .map(|f| {
                LineSuggestion::token(
                    format!("{sigil}{}", f.value),
                    format!("{noun} · {}", f.count),
                )
            })
            .collect::<Vec<_>>()
    };
    let dated = |typed: String, key: &str, noun: &str| {
        date_shortcuts(today)
            .into_iter()
            .filter(|(name, date)| starts(name, &typed) || date.as_str().starts_with(&typed))
            .map(|(name, date)| {
                LineSuggestion::token(format!("{key}{date}"), format!("{noun} · {name}"))
            })
            .collect::<Vec<_>>()
    };
    let offered = if let Some(typed) = after("+") {
        named(typed, &facets.projects, '+', "Project")
    } else if let Some(typed) = after("@") {
        named(typed, &facets.contexts, '@', "Context")
    } else if let Some(typed) = after("pri:") {
        let mut letters: Vec<char> = vec!['A', 'B', 'C'];
        letters.extend(
            facets
                .priorities
                .iter()
                .filter_map(|f| f.value.chars().next()),
        );
        letters.sort_unstable();
        letters.dedup();
        letters
            .into_iter()
            .filter(|c| starts(&c.to_string(), &typed))
            .map(|c| LineSuggestion {
                offer: Offer {
                    token: format!("({c})"),
                    detail: "Priority".to_owned(),
                },
                priority: Some(c),
            })
            .collect()
    } else if let Some(typed) = after("due:") {
        dated(typed, "due:", "Due")
    } else if let Some(typed) = after("t:") {
        dated(typed, "t:", "Show from")
    } else if let Some(typed) = after("rec:") {
        REPEATS
            .into_iter()
            .filter(|(rule, _)| rule.starts_with(&typed))
            .map(|(rule, name)| {
                LineSuggestion::token(format!("rec:{rule}"), format!("Repeat · {name}"))
            })
            .collect()
    } else {
        Vec::new()
    };
    offered.into_iter().take(MAX_OFFERS).collect()
}

/// The open date helper of a line: which date it sets, and its calendar.
pub struct DateHelper {
    pub target: LineDate,
    pub calendar: Entity<CalendarState>,
    pub _selected: Subscription,
}

/// One line input's state: its text field, autocomplete panel, date helper, the last refusal
/// to show, and the queued command's reply while it saves.
pub struct LineField {
    pub input: Entity<InputState>,
    pub completion: Completion,
    pub date: Option<DateHelper>,
    pub error: Option<&'static str>,
    pub reply: Option<Reply>,
    /// The text last seen, to tell edits from caret moves.
    seen: String,
}

impl LineField {
    pub fn new(input: Entity<InputState>, cx: &App) -> Self {
        let seen = input.read(cx).value().to_string();
        Self {
            input,
            completion: Completion::default(),
            date: None,
            error: None,
            reply: None,
            seen,
        }
    }

    /// Starts or ends saving: while a reply is awaited the line is read-only, so the text the
    /// reply answers is the text shown. The rendered `Input` must say `readonly(saving)` too,
    /// since it applies its own flag to the state each frame.
    pub fn set_saving(&mut self, reply: Option<Reply>, cx: &mut App) {
        let saving = reply.is_some();
        self.reply = reply;
        self.input
            .update(cx, |state, cx| state.set_readonly(saving, cx));
    }

    pub fn text(&self, cx: &App) -> String {
        self.input.read(cx).value().to_string()
    }

    /// Follows the input: an edit reopens the panel and clears a shown refusal.
    pub fn changed(&mut self, cx: &App) {
        let text = self.text(cx);
        if text != self.seen {
            self.seen = text;
            self.completion.edited();
            self.error = None;
        }
    }

    pub fn focused(&self, window: &Window, cx: &App) -> bool {
        self.input.read(cx).focus_handle(cx).is_focused(window)
    }

    /// An IME composition is in progress; Enter and Escape belong to it.
    pub fn composing(&self, window: &mut Window, cx: &mut App) -> bool {
        self.input.update(cx, |state, cx| {
            state.marked_text_range(window, cx).is_some()
        })
    }

    /// The word at the caret and what it can complete to, while the field has focus and the
    /// panel was not dismissed.
    pub fn offers(
        &self,
        facets: &Facets,
        today: TodoDate,
        window: &Window,
        cx: &App,
    ) -> Option<(Range<usize>, Vec<LineSuggestion>)> {
        if self.completion.dismissed() || self.reply.is_some() || !self.focused(window, cx) {
            return None;
        }
        let state = self.input.read(cx);
        let text = state.value();
        let caret = state.cursor();
        let word = line_word_at(&text, caret)?;
        let offered = suggestions(&text[word.start..caret], facets, today);
        (!offered.is_empty()).then_some((word, offered))
    }

    /// The open panel's offers and highlighted row, for rendering.
    pub fn panel(
        &self,
        facets: &Facets,
        today: TodoDate,
        window: &Window,
        cx: &App,
    ) -> Option<(Vec<Offer>, usize)> {
        let (word, offered) = self.offers(facets, today, window, cx)?;
        let highlighted = self.completion.highlighted(&word, offered.len());
        Some((offered.into_iter().map(|s| s.offer).collect(), highlighted))
    }

    /// Handles a panel key; `false` lets it through to the field while the panel is closed.
    pub fn key(
        &mut self,
        key: CompletionKey,
        facets: &Facets,
        today: TodoDate,
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        if self.composing(window, cx) {
            return false;
        }
        let Some((word, offered)) = self.offers(facets, today, window, cx) else {
            return false;
        };
        if let Some(index) = self.completion.key(key, word, offered.len()) {
            self.accept(index, facets, today, window, cx);
        }
        true
    }

    /// Sets the date helper's date in the line: only the changed span is replaced, as one step
    /// of the field's undo history, and the field takes focus back.
    pub fn set_date(
        &mut self,
        target: LineDate,
        date: TodoDate,
        window: &mut Window,
        cx: &mut App,
    ) {
        let text = self.text(cx);
        let next = line_with_date(&text, target, date);
        let span = changed_span(&text, &next);
        let middle = next[span.start..next.len() - (text.len() - span.end)].to_owned();
        self.input.update(cx, |state, cx| {
            state.set_selected_range(span, cx);
            state.replace(middle, window, cx);
            state.focus(window, cx);
        });
    }

    /// Writes suggestion `index` in place of the word at the caret, as one step of the field's
    /// undo history, and leaves the caret after it.
    pub fn accept(
        &mut self,
        index: usize,
        facets: &Facets,
        today: TodoDate,
        window: &mut Window,
        cx: &mut App,
    ) {
        let Some((word, mut offered)) = self.offers(facets, today, window, cx) else {
            return;
        };
        if index >= offered.len() || self.reply.is_some() {
            return;
        }
        let chosen = offered.swap_remove(index);
        let text = self.text(cx);
        self.input.update(cx, |state, cx| {
            match chosen.priority {
                Some(priority) => {
                    let (next, caret) = line_with_priority(&text, word, priority);
                    state.replace_all(next, window, cx);
                    state.set_selected_range(caret..caret, cx);
                }
                None => {
                    // The word and the whitespace after it become the token and one space.
                    let spaces = text[word.end..].len() - text[word.end..].trim_start().len();
                    state.set_selected_range(word.start..word.end + spaces, cx);
                    state.replace(format!("{} ", chosen.offer.token), window, cx);
                }
            }
            state.focus(window, cx);
        });
        self.completion.edited();
    }
}

/// The byte range of `old` that differs from `new`, between their common prefix and suffix.
fn changed_span(old: &str, new: &str) -> Range<usize> {
    let mut start = old
        .bytes()
        .zip(new.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    while !old.is_char_boundary(start) || !new.is_char_boundary(start) {
        start -= 1;
    }
    let limit = old.len().min(new.len()) - start;
    let mut suffix = old
        .bytes()
        .rev()
        .zip(new.bytes().rev())
        .take(limit)
        .take_while(|(a, b)| a == b)
        .count();
    while !old.is_char_boundary(old.len() - suffix) || !new.is_char_boundary(new.len() - suffix) {
        suffix -= 1;
    }
    start..old.len() - suffix
}
