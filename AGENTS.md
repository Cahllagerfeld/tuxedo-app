# AGENTS.md

Electron + SvelteKit SPA; the TypeScript backend owns filesystem, persistence, and todo.txt parsing. SvelteKit route data owns loaded renderer resources; a command coordinator holds admission and confirmation metadata. The desktop host and renderer live in `apps/desktop`; Effect-native domain services live in `packages/backend` (`@tuxedo/backend`); browser-safe schemas and DTOs live in `packages/contracts` (`@tuxedo/contracts`).

Run tools via devenv: `devenv shell -- pnpm|gh|node ...`.

## Context pointers

- Before writing or reviewing code (Svelte, TypeScript, UI, forms, desktop IPC, backend operations, wire types): [CODING_STANDARDS.md](CODING_STANDARDS.md).

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Use the default five triage labels. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Before exploring the codebase, read the single-context `GLOSSARY.md` and relevant `docs/adr/` decisions. See [docs/agents/domain.md](docs/agents/domain.md).

## Testing

- Write the smallest set of tests that protects meaningful behavior: core user workflows, non-trivial logic, bug regressions, and failures that could lose data or break contracts. Judge tests by the distinct risk they cover, not test counts or coverage percentages.
- Extend existing tests where practical. Skip tests for trivial wiring, implementation details, or behavior already covered unless another layer catches a distinct failure. Documentation-only and cosmetic changes usually need no new tests.
- Use the narrowest test boundary that proves the behavior; reserve Electron and packaged-app tests for risks that require those boundaries.
- Keep tests deterministic and isolated. Use explicit synchronization for async behavior instead of sleeps; avoid dependence on timing, test order, or external services. Treat CI runtime, flakiness, and maintenance cost as part of each test's cost.

## Finishing work

- Keep [examples/todo.txt](examples/todo.txt) covering all cases supported by the product. Whenever functionality is added, changed, or removed, update the example Todo file in the same change.
- New commit per change, never amend.
- After structural changes: `pnpm check`, `pnpm test:unit`, `pnpm test:backend`, `pnpm lint`, `pnpm build`, `pnpm test:electron`, `pnpm test:package` (macOS).
- Delete emptied folders and session temp files.
