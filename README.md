# Tuxedo

Tuxedo is a local-first desktop app for working with portable `todo.txt` files.
It is built with Tauri, SvelteKit, Svelte 5 runes, and Rust.

The product direction, milestones, and implementation checklist live in
[docs/product-spec.md](docs/product-spec.md).

## Development

Install dependencies with the repo package manager:

```sh
pnpm install
```

Run the app during development:

```sh
pnpm tauri dev
```

Run verification before marking product-spec work complete:

```sh
pnpm check
pnpm test:unit
pnpm test:rust
pnpm lint
```
