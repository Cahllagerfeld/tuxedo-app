# AGENTS.md

Guidance for future agents working in this repository.

## Project Structure

`src/lib` is organized by ownership, not by broad technical category.

- `src/lib/app`: app composition and cross-module wiring.
- `src/lib/modules/todo`: todo domain, state, UI, and related tests.
- `src/lib/modules/workspace`: workspace domain, state, UI, sidebar UI, and related tests.
- `src/lib/shared`: reusable primitives and utilities that do not depend on feature modules.
- `src/lib/vitest-examples`: existing example tests/components; leave alone unless explicitly cleaning them up.

Do not recreate old semantic buckets such as `src/lib/components`, `src/lib/state`, or top-level domain files like `src/lib/todo.ts`.

This is a Tauri + SvelteKit app. The frontend is statically adapted as a SPA for Tauri, and Svelte runes mode is forced for project files in `svelte.config.js`.

## Frontend Conventions

- Write Svelte 5 runes-style components and state.
- Avoid `$effect`. It is almost never the right tool: prefer `$derived` for computed values,
  event handlers for user-driven work, and explicit functions/component APIs for coordination.
  Use `$effect` only when synchronizing with an external system cannot be expressed through those
  mechanisms, and explain the necessity in the code review.
- Keep app-wide state composition in `src/lib/app/app-state.svelte.ts`.
- Keep Svelte context setup/getters in `src/lib/app/app-context.ts`.
- Use the existing `@/*` alias for `src/lib/*` or `$lib/*`; do not add extra aliases unless there is a strong project-wide reason.
- `src/routes/+layout.svelte` is the shell: workspace header, view toggler, resizable sidebar/content panes, status bar, and app state initialization.
- `src/routes/+page.svelte` should stay thin and render module UI rather than owning feature logic.

## shadcn Components

shadcn-generated primitives belong in the shared layer.

Always use a shadcn-svelte primitive whenever a suitable one exists (for example, Dialog,
Button, Input, Label, and form controls). Add missing primitives with the shadcn-svelte CLI
rather than building local substitutes. Build a feature-owned component only when the behavior
is domain-specific or no suitable shadcn-svelte primitive exists; compose shared primitives inside it.

Use Tailwind utility classes for component styling. Do not add component-scoped `<style>` blocks
when Tailwind can express the design, including responsive and dark-mode variants.

Build client-side forms with the shadcn-svelte `Form` primitives, Formsnap, Superforms, and a
Zod schema. Follow the `Form.Field` → `Form.Control` → input → `Form.Description` /
`Form.FieldErrors` composition so labels and validation ARIA attributes stay connected. Keep
client-side validation responsive, but duplicate all security and persistence validation at the
Rust command boundary.

`components.json` should keep these aliases:

```json
{
	"components": "$lib/shared",
	"utils": "$lib/shared/utils",
	"ui": "$lib/shared/ui",
	"hooks": "$lib/shared/hooks",
	"lib": "$lib"
}
```

Feature-specific components are not shadcn primitives. Keep them inside their owning module, for example:

- Todo UI: `src/lib/modules/todo/ui`
- Workspace UI: `src/lib/modules/workspace/ui`
- Workspace sidebar UI: `src/lib/modules/workspace/ui/sidebar`

## Import Boundaries

- Routes may import app composition, module UI, and shared UI directly.
- Feature modules may import from their own module and from `src/lib/shared`.
- Cross-module imports should be explicit and only used for real domain coupling.
- Shared code must not import from feature modules.
- Keep shadcn component `index.ts` barrel files. Avoid adding feature-level barrel files unless there is a clear reason.
- Keep tests close to the code they validate inside the owning module.

Preferred examples:

```ts
import { AppState } from "$lib/app/app-state.svelte";
import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
import { Button } from "$lib/shared/ui/button";
```

## Frontend/Rust Contract

Rust owns filesystem access, workspace persistence, and todo.txt parsing under `src-tauri/src`.

- Tauri commands are registered in `src-tauri/src/lib.rs`.
- Workspace persistence and workspace loading live in `src-tauri/src/workspace.rs`.
- todo.txt parsing lives in `src-tauri/src/todo_txt`.
- Frontend domain files should validate command responses with Zod before state applies them.
- If a Rust command response shape changes, update the matching Zod schema, TypeScript types, and tests in the relevant frontend module.

## Verification

After structural changes, run:

```sh
pnpm check
pnpm test:unit
pnpm test:rust
pnpm lint
```

The intended package manager is `pnpm@11.2.2`.

In Codex sandboxed shells, `pnpm` or `npm` may be unavailable on `PATH`. The bundled Node runtime can run local binaries by prefixing `PATH` with:

```sh
PATH=/Users/juliankarl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
```

Vitest may try to bind a local `::1` listener. If tests pass but the process reports `listen EPERM`, rerun outside the sandbox or ask for permission to run with local binding access.

## Cleanup Expectations

When moving files, remove unused empty folders afterward. A quick check:

```sh
find src/lib -type d -empty | sort
```

This should return nothing unless an intentionally empty folder is documented.

## Agent skills

### Issue tracker

Issues are tracked in GitHub; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.
