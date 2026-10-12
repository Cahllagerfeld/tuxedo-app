# Expand shared validation with Effect Schema

Issue #92 begins the Effect 4 migration described in #91. Adopt stable Effect 4.0.3 for the shared Todo-item creation fields, request, and shared Todo-item editor. ADR-0004's Electron-independent backend ownership and ADR-0005's Svelte Workspace session controller remain in force.

`src/lib/shared/desktop/todo-creation.ts` is the canonical source for these fields and cross-field rules. Creation requests preserve optional versus nullable dates; omitted Creation dates still receive the backend's local date. Editor values keep empty date strings and `none` Priority until `todoEditorDraft` normalizes Description and maps them to nullable request values. The form supplies all defaults explicitly, including the local Creation date. Editing retains its existing legacy Completion-date rules and reads current editor state when validating.

Use `Schema.toStandardSchemaV1` with Superforms `standard` and `standardClient`. Custom `Schema.makeFilter` checks return field paths, including cross-field errors. Supply explicit defaults to `standard`; Superforms derives its form shape from those values. Do not generate JSON Schema for validation or use Superforms' Effect 3 adapters.

At synchronous desktop boundaries, `effectValidator` uses `Schema.decodeUnknownSync` and Standard Schema issues with `onExcessProperty: "error"` and `errors: "all"`. Its small `parse`/`safeParse` surface lets the existing main handler, preload client, backend, and inline field feedback reuse their validation flow. Desktop request types derive from the validator's return type. Only plain DTO values cross the bridge; no Schema classes or Effect orchestration enter the renderer.

Unmigrated operations, responses, events, and persistence still use Zod. The creation response continues to use the existing strict `todoOutcomeSchema` in main and preload; trusted-sender checks are unchanged. The Zod editing request adapts the canonical Effect fields and reuses the same cross-field rules rather than keeping competing constraints. Subsequent tickets should replace remaining Zod definitions with canonical Effect schemas, preserve strict decoding at every trust boundary, and remove compatibility adapters when their callers are migrated.

The version-matched read-only upstream reference was Effect 4.0.3, commit `7547a99f8`. Evidence: `ai-docs/src/01_effect/02_schema/10_schema-basics.ts`, the public `Schema.ts` declarations for `decodeUnknownSync`, `toStandardSchemaV1`, `optional`, `mutable`, and `makeFilter`, and `packages/effect/test/schema/toStandardSchemaV1.test.ts` (multiple checks, paths, and excess properties).

See [the production bundle evidence](../effect-schema-bundles.md) for the measured compatibility and size cost. This expands validation only; services, runtime ownership, serialization, and resource scopes belong to later migration slices.
