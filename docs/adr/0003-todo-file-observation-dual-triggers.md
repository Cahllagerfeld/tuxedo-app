# Todo-file observation uses dual reload triggers

The Active workspace's Todo file is observed on disk so a Ready Workspace session can refresh its Todo-file summary when that file changes outside the app. UI updates still go through one reload path that reapplies a validated Todo-file summary; that path is triggered both by successful or conflicting Todo-item mutations (and Workspace operations) and by observation events while idle. Own writes do not wait on filesystem notify, and observation is ignored while a Todo-item mutation or Workspace operation is in flight.

If the observed Todo file becomes stably unreadable, the session enters the Empty state with a warning. An observation notice is shown only when the parsed Todo-file summary changes, and it stays quieter than the existing mutation-conflict error toast so the two never stack for one change.

## Considered Options

- Drive all UI updates, including own mutations, solely from filesystem watch events.
- Opportunistic conflict detection on write only (no observation).
- Dual triggers into one reload path, with observation paused while busy.

Watcher-only UI was rejected for latency and missed-event risk on own writes. Write-only detection leaves the Todo-file summary stale until the next mutation. Dual triggers keep the Todo file as source of truth without making notify the sole update mechanism.
