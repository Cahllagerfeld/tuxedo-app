# AGENTS.md

Tauri + SvelteKit SPA; Rust owns the filesystem, persistence, and todo.txt parsing.

Run project tools through devenv: `devenv shell -- pnpm ...`, `devenv shell -- gh ...`, `devenv shell -- node ...`.

## Context pointers

- Before writing or reviewing Svelte, TypeScript, or module layout: [CODING_STANDARDS.md](CODING_STANDARDS.md).
- Before touching a Tauri command, a Rust response shape, or its TypeScript wire types: [docs/agents/frontend-rust-contract.md](docs/agents/frontend-rust-contract.md).
- Before adding UI, forms, or shadcn primitives: [docs/agents/ui-components.md](docs/agents/ui-components.md).
- Issue tracker (GitHub; PRs are not a triage surface): `docs/agents/issue-tracker.md`. Triage labels (default five): `docs/agents/triage-labels.md`. Domain language: `docs/agents/domain.md`.

## Finishing work

- Commit each change as a new commit; history stays an honest timeline.
- Run `pnpm check`, `pnpm test:unit`, `pnpm test:rust`, `pnpm lint` after structural changes (`pnpm test` covers only the two test suites).
- After moving files, `find src/lib -type d -empty` returns nothing; delete leftover empty folders.
- Delete session temp files before finishing.
