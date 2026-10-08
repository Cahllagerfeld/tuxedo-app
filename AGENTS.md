# AGENTS.md

Tauri + SvelteKit SPA; Rust owns filesystem, persistence, todo.txt parsing.

Run tools via devenv: `devenv shell -- pnpm|gh|node ...`.

## Context pointers

- Before writing or reviewing code (Svelte, TypeScript, UI, forms, Tauri commands, wire types): [CODING_STANDARDS.md](CODING_STANDARDS.md).
- Issues/PRs: `docs/agents/issue-tracker.md`; triage: `docs/agents/triage-labels.md`; domain language: `docs/agents/domain.md`.

## Finishing work

- New commit per change, never amend.
- After structural changes: `pnpm check`, `pnpm test:unit`, `pnpm test:rust`, `pnpm lint`.
- Delete emptied folders and session temp files.
