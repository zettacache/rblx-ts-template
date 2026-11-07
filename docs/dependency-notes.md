# Dependency maintenance

Direct dependencies are pinned, and npm ci installs the committed lockfile. TypeScript matches the compiler's embedded TypeScript version. ESLint and its parser/plugin are tested together. Keep formatter, compiler, and runtime upgrades in reviewable changes and run the full checks afterward.

The Flamework transformer and some lint dependencies currently bring moderate npm audit advisories through their dependency trees. Use `npm audit` to inspect current results and `npm audit --omit=dev` for runtime dependencies. Do not use `npm audit fix --force` as a routine setup step: its suggested transformer change can downgrade Flamework to an incompatible old release. Reassess these advisories when updating upstream packages.

After changing compiler/transformer versions or configuration, run `npm run clean` and rebuild. Review generated network guards and rerun the Studio smoke test. Update tool pins, Node/npm declarations, CI, and this documentation together when the tested toolchain changes.
