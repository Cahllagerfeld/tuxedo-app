# Coding Standards

## Module ownership

`src/lib` is organized by ownership: `app` (composition and cross-module wiring), `modules/<name>` (domain, state, UI, and tests together), `shared` (primitives and utilities with no feature dependencies). New code goes into its owning module; no `components/` or `state/` buckets, no top-level domain files.

## Svelte

- Write Svelte 5 runes-style components and state (runes mode is forced in `vite.config.ts`).
- Reach for `$derived` for computed values, event handlers for user-driven work, and explicit functions/component APIs for coordination. Use `$effect` only to synchronize with an external system, and justify it in the code review.
- Compose app-wide state in `src/lib/app/app-state.svelte.ts` and context setup/getters in `src/lib/app/app-context.ts`.
- `src/routes/+layout.svelte` is the shell; `src/routes/+page.svelte` stays thin and renders module UI.

## Import boundaries

- Import through `$lib/*`; a new alias needs a project-wide reason.
- Routes import app composition, module UI, and shared UI.
- Feature modules import from themselves and from `src/lib/shared`; cross-module imports mark real domain coupling.
- Shared code stays free of feature-module imports.
- Keep shadcn `index.ts` barrels; add feature-level barrels only with a clear reason.
- Place tests beside the code they validate, inside the owning module.

```ts
import { AppState } from "$lib/app/app-state.svelte";
import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
import { Button } from "$lib/shared/ui/button";
```
