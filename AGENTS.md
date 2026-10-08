# AGENTS.md

Guidance for future agents working in this repository.

**When writing or reviewing frontend or Rust code, read [CODING_STANDARDS.md](CODING_STANDARDS.md) first.** It holds the Svelte, shadcn, import-boundary, and frontend/Rust contract rules.

### Project toolchain

This repository uses devenv. Run project-provided tools through devenv:

- `devenv shell -- gh ...`
- `devenv shell -- node ...`
- `devenv shell -- pnpm ...`

## Project Structure

`src/lib` is organized by ownership, not by broad technical category.

- `src/lib/app`: app composition and cross-module wiring.
- `src/lib/modules/todo`: todo domain, state, UI, and related tests.
- `src/lib/modules/workspace`: workspace domain, state, UI, sidebar UI, and related tests.
- `src/lib/shared`: reusable primitives and utilities that do not depend on feature modules.
- `src/lib/vitest-examples`: existing example tests/components; leave alone unless explicitly cleaning them up.

Do not recreate old semantic buckets such as `src/lib/components`, `src/lib/state`, or top-level domain files like `src/lib/todo.ts`.

This is a Tauri + SvelteKit app. The frontend is statically adapted as a SPA for Tauri, and Svelte runes mode is forced for project files in `svelte.config.js`.

## Verification

After structural changes, run:

```sh
pnpm check
pnpm test:unit
pnpm test:rust
pnpm lint
```

## Git Workflow

Never amend an existing commit. Always create a new commit so the history clearly shows what changed and when.

## Cleanup Expectations

When moving files, remove unused empty folders afterward. A quick check:

```sh
find src/lib -type d -empty | sort
```

This should return nothing unless an intentionally empty folder is documented.

Remove any temporary files created during the session before finishing the work.

## Agent skills

### Issue tracker

Issues are tracked in GitHub; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.
