# Effect Schema compatibility and production bundle evidence

Issue #92, macOS arm64, pinned Effect 4.0.3 and Superforms 2.31.0. Baseline: integration branch commit `af931b4b569fbf59da06f58a8398bca0fd48d3c6`. Both measurements use `devenv shell -- pnpm build` with the unchanged Vite configuration. Sizes are bytes; gzip uses Node `gzipSync` separately per emitted JavaScript file. Renderer totals include every `build/**/*.js` file, not CSS/fonts or development/SSR output.

| Shipped JavaScript |  Before |   After |   Change | Gzip before | Gzip after | Gzip change |
| ------------------ | ------: | ------: | -------: | ----------: | ---------: | ----------: |
| Renderer           | 823,914 | 906,378 |  +82,464 |     246,936 |    274,156 |     +27,220 |
| Main               | 147,712 | 254,114 | +106,402 |      36,853 |     65,878 |     +29,025 |
| Sandboxed preload  |  97,753 | 177,784 |  +80,031 |      27,554 |     53,335 |     +25,781 |

`devenv shell -- pnpm why effect` resolves two versions: the application directly uses **4.0.3**; Superforms retains **3.22.2** through its optional `effect: ^3.21.4` dependency. No override forces an incompatible major into Superforms. The lockfile retains both versions; this is intentional during migration.

A temporary Vite `generateBundle` diagnostic inspected each emitted chunk's `modules` map and `renderedLength`, separately for the production browser, main, and preload builds. It was removed after inspection. All three contain 62 Effect 4 modules with nonzero rendered code and **zero Effect 3 modules** with nonzero rendered code. The browser inspection used `_app/immutable/` output, separately from SvelteKit's server build. This checks retained code, not merely Vite's transformed-module count or dependency resolution.

The retained Effect 4 code includes Schema, SchemaAST, SchemaParser, SchemaIssue, Standard Schema integration, internal core, and supporting collections/equality/formatting utilities. Importing `effect/Schema` therefore includes supporting runtime code; it does not ship only one Schema module, nor the entire Effect package. Nonzero module contributions are pre-minification and must not be confused with the final byte measurements above.

To repeat the module inspection, temporarily add this diagnostic plugin to the renderer and Electron main/preload Vite plugin lists and collect the browser report separately from SSR:

```ts
{
  name: "inspect-schema-bundle",
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue;
      for (const [id, module] of Object.entries(chunk.modules)) {
        if (id.includes("/effect@") && module.renderedLength > 0)
          console.log(chunk.fileName, id, module.renderedLength);
      }
    }
  }
}
```

Main and preload continue to bundle runtime code; no new runtime package directory is needed. `scripts/package-macos.mjs` stages only the production renderer, main/preload, package metadata, and an empty `node_modules`. `pnpm test:package` launches that macOS executable from a separate temporary working directory and runs the Electron workflow suite, including creation through preload/main and the shared editor. This verifies independence from development checkout dependencies.
