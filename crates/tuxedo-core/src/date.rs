use std::fmt;

/// A `YYYY-MM-DD`-shaped token (ASCII digits only), regardless of calendar validity.
pub(crate) fn is_date_shaped(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// A valid proleptic-Gregorian `YYYY-MM-DD` date, matching the contracts' `TodoDate`
/// (years 0000–9999). Ordering is chronological.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TodoDate([u8; 10]);

impl TodoDate {
    pub fn parse(value: &str) -> Option<Self> {
        if !is_date_shaped(value) {
            return None;
        }
        let num = |r: std::ops::Range<usize>| value[r].parse::<u32>().unwrap_or(0);
        let (year, month, day) = (num(0..4), num(5..7), num(8..10));
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let days = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if leap => 29,
            2 => 28,
            _ => return None,
        };
        (1..=days)
            .contains(&day)
            .then(|| Self(value.as_bytes().try_into().unwrap()))
    }

    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).expect("TodoDate holds ASCII")
    }
}

impl fmt::Display for TodoDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for TodoDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "TodoDate({})", self.as_str())
    }
}
