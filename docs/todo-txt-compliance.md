# todo.txt compliance audit

Reviewed 2026-10-11 against the [official todo.txt format](https://github.com/todotxt/todo.txt/blob/master/README.md). This is a source-code audit of the current checkout, with focused backend checks; no implementation changes were made.

## Format and interoperability gaps

1. **Leading whitespace changes structural interpretation and survives completion writes.** `electron/backend/todo-file.ts:31` trims before recognizing prefixes, so `  (A) Call Mom` receives priority A and `  x 2026-10-11 Call Mom` becomes completed. The specification positions priority first and completion marker at the start of the line. More importantly, `electron/backend/session.ts:340` writes preserved indentation before `x`. Completing `  Call Mom` therefore generates `  x YYYY-MM-DD Call Mom`, which a client applying literal start-of-line recognition will interpret differently. Preserve task text while emitting the structural completion prefix at column one. Treat tolerant reading as an explicit compatibility policy.

2. **Completed-item bodies are parsed as if they had an incomplete priority prefix.** `electron/backend/todo-file.ts:43` recognizes priority after consuming completion marker/date. For `x 2026-10-11 (A) 2026-10-01 Call Mom`, the app consumes `(A)` as priority and the following date as Creation date. Under the documented completed layout, the optional Creation date must immediately follow Completion date; here `(A) 2026-10-01 Call Mom` is body text. This loses text in the displayed description and assigns incorrect structured fields. Parse open and completed prefixes separately.

3. **Missing Completion dates are silently accepted.** `x Call Mom` yields completed=true and completion_date=null. The format calls Completion date required. Accepting legacy malformed lines can be a deliberate compatibility feature, but should not be confused with validating them as compliant. New completion writes already insert a date; do not invent a historical date when reading an undated line.

These findings follow the official specification's prefix placement rules. Calendar validation, blank lines, tabs, BOMs, and newline encodings are not fully specified there; this audit does not classify the app's policies for those as definite violations.

## Missing UI coverage, separate from format violations

- Creation requests expose Description, Projects, and Contexts, with today's Creation date added automatically. There is no structured Priority input, optional/custom Creation date, or general edit operation (`src/lib/shared/desktop/contract.ts:140`, `electron/backend/create-todo.ts:16`). Existing priorities and dates are read.
- Custom `key:value` metadata is parsed but removed from the displayed Description; Todo-item rows do not show it. Creation rejects metadata tokens, leaving no in-app way to enter them (`src/lib/shared/desktop/contract.ts:133`, `src/lib/modules/todo/ui/TodoItem.svelte`). A generic metadata display/input or raw-line editor would improve access to existing content.
- Tag creation rejects names beginning with `+` or `@`, although reading accepts e.g. `+@family`. The format permits non-whitespace tag names, so this creation restriction covers less than the supported input format (`src/lib/shared/desktop/contract.ts:124`).

Due-date scheduling, recurrence, done.txt archiving, and particular UI controls are not required by this file-format specification. `due:` is an example extension. Priority preservation via `pri:A` is already implemented; retention is a client policy, not a mandatory feature.

## Existing support and verification

The app reads A–Z priorities, correctly placed open Creation dates, completed adjacent dates, multiple Projects and Contexts, and custom metadata. Completion writes local dates and preserves Creation dates and priority metadata. Existing tests exercise byte preservation, CRLF, conflict handling, and completing/uncompleting Todo items.

Ran the parser, completion, and creation test files plus a temporary audit probe: 62 checks passed. Replaced the probe with three explicit assertions confirming current edge-case behavior: all three passed. Audit probes were removed afterward. These checks establish the described current behavior; they are not a comprehensive conformance suite.
