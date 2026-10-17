# Use SvelteKit loads for confirmed renderer data

SvelteKit universal loads own confirmed renderer data, including saved views, in the static Electron SPA. Explicit desktop-read dependencies and targeted invalidation replace ADR-0005's mutable controller snapshot and mount initialization. A small Svelte command coordinator owns synchronous admission, operation progress, and contextual outcomes through the required refresh, not another data cache. This follows [issue #163](https://github.com/Cahllagerfeld/tuxedo-app/issues/163).

Reads and activation are separate: loading or preloading a Workspace cannot persist its selection, retarget observation, clear Undo, or advance an existing mutation revision. Only actual admitted navigation activates the destination; the reader is actionable only when the route and backend confirmation agree. Startup resumes the remembered Workspace with history replacement, while explicit Home preserves the remembered selection without redirecting.

Commands retain the backend's confirmed outcomes and consistency checks, then invalidate affected reads instead of patching renderer snapshots. Admission remains closed through refresh; a committed write followed by a failed read is reported as saved with a refresh failure, never retried as a write. External Todo-file events use the authoritative backend refresh and targeted invalidation. Drafts, dialogs, filters, focus, and selection retain their existing local ownership and Workspace-change reset rules.

Filesystem access, catalogue persistence, parsing, serialization, scoped identities, revisions, targeted-content checks, observation resources, and atomic writes remain backend responsibilities under ADR-0004 and ADR-0006. Persisted formats and supported todo.txt cases are unchanged.
