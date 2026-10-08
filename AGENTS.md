# AGENTS.md

Tauri + SvelteKit SPA; Rust owns filesystem, persistence, todo.txt parsing.

Run tools via devenv: `devenv shell -- pnpm|gh|node ...`.

## Context pointers

- Before writing or reviewing code (Svelte, TypeScript, UI, forms, Tauri commands, wire types): [CODING_STANDARDS.md](CODING_STANDARDS.md).

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Use the default five triage labels. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Before exploring the codebase, read the single-context `GLOSSARY.md` and relevant `docs/adr/` decisions. See [docs/agents/domain.md](docs/agents/domain.md).

## Finishing work

- New commit per change, never amend.
- After structural changes: `pnpm check`, `pnpm test:unit`, `pnpm test:rust`, `pnpm lint`.
- Delete emptied folders and session temp files.
