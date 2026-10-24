# Svelte ecosystem upgrade assessment

Assessed 2026-10-24. This is an upgrade proposal; no migration or dependency changes have been applied.

## Scope and compatible targets

The repository already uses Svelte 5.57.2, Vite 8.3.4, vite-plugin-svelte 7.3.1, Vitest 5.0.5, and Tailwind 4.3.3. The substantial framework upgrade is SvelteKit 2 → 3, accompanied by adapter-static 3 → 4 and Superforms 2 → 3. SvelteKit 3 shipped on October 1, 2026; its official release announcement includes the migration command. [SvelteKit announcement](https://svelte.dev/blog/sveltekit-3-is-here)

SvelteKit's current upstream package declares version 3.1.0 and peers `svelte: ^5.57.1`, `vite: ^8.0.12`, `@sveltejs/vite-plugin-svelte: ^7.0.0`, and optional `typescript: ^6.0.0`, with Node `>=22.17`. The installed Svelte/Vite/plugin versions satisfy those ranges; the devenv configuration selects Node 24. Pin TypeScript 6 for this migration: TypeScript 7 does not satisfy Kit's published major range. [Kit package](https://github.com/sveltejs/kit/blob/main/packages/kit/package.json)

Adapter-static 4.0.0 requires Kit 3, so upgrade those together. Its changelog does not describe an application-facing rewrite for the existing static SPA fallback. [Adapter changelog](https://github.com/sveltejs/kit/blob/main/packages/adapter-static/CHANGELOG.md)

Superforms 3.0.0 supports Kit `^2.12.0 || ^3.0.0` and Svelte `^5.56.4`. The release describes itself as a compatibility release, with dependency and adapter-version changes rather than a general form API rewrite. Upgrade it, plus Formsnap 2.1.0, while still on Kit 2 to isolate form regressions. [Superforms release](https://github.com/ciscoheat/sveltekit-superforms/releases/tag/v3.0.0)

Live npm metadata checked through `pnpm outdated` and direct npm registry reads gives these targets:

| Package                           | Current | Proposed                  |
| --------------------------------- | ------- | ------------------------- |
| `@sveltejs/kit`                   | 2.70.3  | 3.1.0                     |
| `@sveltejs/adapter-static`        | 3.0.10  | 4.0.0                     |
| `typescript` (all three packages) | 5.9.3   | 6.0.3; defer latest 7.0.2 |
| `sveltekit-superforms`            | 2.31.0  | 3.0.0                     |
| `formsnap`                        | 2.0.1   | 2.1.0                     |
| `vite`                            | 8.3.4   | 8.3.5                     |
| `bits-ui`                         | 2.19.5  | 2.20.2                    |
| `shadcn-svelte`                   | 1.7.0   | 1.7.1                     |

Formsnap 2.1.0 accepts Superforms `^2.19.0 || ^3.0.0`; svelte-check 4.7.7 accepts TypeScript 5 or 6. Retain Svelte 5.57.2, vite-plugin-svelte 7.3.1 and svelte-check 4.7.7. Bits UI/shadcn/Vite bumps are optional nearby maintenance, rather than a prerequisite framework migration. [Formsnap npm metadata](https://www.npmjs.com/package/formsnap), [svelte-check npm metadata](https://www.npmjs.com/package/svelte-check)

Keep the existing Effect 4 → Standard Schema bridge and explicit form defaults. Superforms' native Effect adapter still declares optional Effect `^3.21.0`; this mismatch already exists with the installed Superforms 2.31.0 and is not introduced by this upgrade. Upgrading Superforms does not establish native Effect 4 adapter support. [Superforms package](https://github.com/ciscoheat/sveltekit-superforms/blob/main/package.json)

## Official migration tooling

Run from the repository root through devenv:

```sh
# Read-only: print available tasks.
devenv shell -- pnpm dlx sv@1.1.1 migrate sveltekit-3 --cwd apps/desktop --tasks

# Implementation phase: intentionally create one combined migration diff.
devenv shell -- pnpm dlx sv@1.1.1 migrate sveltekit-3 --cwd apps/desktop --tasks all --no-install --confirm
```

The CLI supports `--cwd`, task selection, and skipping installation. Actual task execution always includes prerequisites. It can format through the project's format script; review the whole diff afterward. Search for `@migration-task` comments and complete them manually. The official guidance recommends reviewing and committing selectable tasks separately when that makes the migration easier to assess; intermediate subsets need not build. [CLI migration reference](https://svelte.dev/docs/cli/sv-migrate)

The read-only task listing above was executed successfully with sv 1.1.1. Its actual task list also contains `imports`, `lib-alias`, and `collect-migration-instructions`, beyond the current reference page's shorter list. Review the generated `MIGRATION_TASKS.md` as well as inline markers. Pinning this verified CLI version makes the implementation command reproducible.

The CLI changelog explicitly records automated `$lib` → `#lib` migration. Do not assume it catches custom repository scripts, component-generator configuration, or every import expression. There is no reason to run the legacy `svelte-5` or `sveltekit-2` migrations against this already-Svelte-5/Kit-2 codebase. [CLI changelog](https://github.com/sveltejs/cli/blob/main/packages/sv/CHANGELOG.md)

## Application changes and manual review

Kit 3 replaces implicit `$lib` with package `imports` entries for `#lib`, requiring file extensions; tsconfig extends `$app/tsconfig` and must own include/exclude patterns. `$app/environment` becomes `$app/env`. `goto` options rename `replaceState` to `replace`, combine scroll/focus flags as `reset`, and rename `invalidateAll` to `refreshAll`. Invalidation during navigation no longer aborts that navigation. Same-URL links now refresh resources; preload failures gain an error result; app error types include status. Configuration must live in the Vite plugin, which this repository already does. [Kit 3 migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)

Repository-specific follow-through:

- Update `apps/desktop/components.json` aliases so later shadcn generation emits working imports, and verify CLI resolution of `#lib` and explicit extensions. Its current installation guide still shows Kit 2 configuration, so those examples alone do not prove Kit 3 generator support. Migrate the existing checked-in components without regenerating them. [shadcn installation guide](https://shadcn-svelte.com/docs/installation/sveltekit)
- Update alias recognition in `apps/desktop/scripts/check-desktop-boundaries.mjs`; its current resolver recognizes `$lib/` and `@/`.
- Review all three packages' TypeScript pins and tsconfigs together, including Electron and backend checks. Keep the existing intentional desktop exclusions when replacing the generated tsconfig base.
- Inspect `workspace-routing.svelte.ts`, command admission, invalidation and navigation tests against ADR-0007. That ADR explicitly records Kit 2.70.3 timing and supersession behavior, so the syntax codemod cannot establish behavioral compatibility.
- Update `goto({ replaceState: ... })` calls in `routes/+layout.svelte` and `app/workspace-routing.svelte.ts`. No current legacy environment or store imports were found, so those migration tasks should be no-ops.
- Preserve SPA rendering, `fallback: "index.html"`, and the native `tuxedo:` / resource `tuxedodata:` distinction.
- Check version polling/focus behavior in the packaged custom protocol and decide explicitly whether desktop release detection should poll.

For TypeScript 6, review changed defaults and explicit ambient types, and remove deprecated options rather than silencing all deprecations. The official release notes describe the optional `ts5to6` tool, but this repository's small explicit configuration does not justify an additional codemod without a concrete problem. [TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)

## Proposed execution and validation

1. Record a clean baseline. Upgrade Superforms and compatible Formsnap first; verify creation/edit dialogs, validation errors, reset, and submission through desktop commands.
2. Run the Kit migration; pin Kit 3.1.0, adapter-static 4.0.0 and compatible TypeScript 6 explicitly. Keep unrelated dependency majors out of this change.
3. Complete manual follow-through and remove migration markers. Regenerate route/type metadata and inspect lockfile peer resolutions.
4. Run all required structural checks through devenv: `pnpm check`, `pnpm test:unit`, `pnpm test:backend`, `pnpm lint`, `pnpm build`, `pnpm test:electron`, and `pnpm test:package` on macOS. Use the actual Electron router tests to verify preload, navigation supersession, delayed publication, refresh recovery and observation during commands. Verify the copied packaged app outside the checkout.

Package metadata and migration documentation establish an available upgrade path; runtime compatibility remains unproven until implementation and those checks pass.
