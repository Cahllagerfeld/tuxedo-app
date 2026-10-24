# Upstream reference source

`effect/` is a read-only, squashed Git subtree used by the
[Effect patterns skill](../.agents/skills/effect-patterns/SKILL.md). It is reference
material; the application uses its installed packages. Application type checks,
formatting, source scanning, tests, and packaging exclude this directory through
explicit exclusions or application-only input paths.

- Upstream: https://github.com/Effect-TS/effect.git
- Imported commit: `7f524e25cfb49a71ac39b0f44278d08d40dda5de`
- Effect package version in this snapshot: `4.0.5`

## Updating

Choose an upstream commit matching the application's Effect dependency version.
From the project root with a clean working tree, run:

```sh
git subtree pull --prefix=.repos/effect https://github.com/Effect-TS/effect.git <commit> --squash
```

The subtree command creates a commit. Update the snapshot metadata above in a new
commit, verify the installed APIs against the imported source, and run the
project's required checks. Preserve the upstream license and source unchanged.
