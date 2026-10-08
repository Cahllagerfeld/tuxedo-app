# Coding Standards

## Layering

- `src/lib`: `app` (wiring) → `modules/<name>` (domain, state, UI, tests together) → `shared` (feature-free).
- Modules import only themselves and `shared`; cross-module imports mark real domain coupling.
- Routes stay thin: compose app, module UI, shared UI.

## Svelte

- `$derived` > event handler > explicit API; `$effect` only for external systems, justified in review.

## UI

- shadcn-svelte primitive first; missing → shadcn CLI.
- Tailwind only; `<style>` for what Tailwind cannot express.
- Forms: shadcn `Form` + Formsnap + Superforms + Zod, `Form.Field` → `Form.Control` → input → `Form.Description`/`Form.FieldErrors`.

## Frontend/Rust contract

- Rust validates everything security- or persistence-related; client validation is only responsiveness.
- Wire types are pinned by TypeScript types, Zod schemas, and Rust-serialized fixtures; a response-shape change updates all four plus tests in lockstep.
