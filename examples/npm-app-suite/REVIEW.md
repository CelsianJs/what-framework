# npm Consumer Review — What Framework 0.5.0

Date: 2026-02-17

Detailed DX feedback with explicit `liked / issues / bugs / wishlist / unclear` sections:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/training-builds/NPM_DX_FEEDBACK_2026-02-17.md`

## Scope

Validated published npm packages in real consumer projects:

- `what-framework@0.5.0`
- `what-compiler@0.5.0`
- `create-what@0.5.0`
- transitive: `what-core@0.5.0`, `what-router@0.5.0`, `what-server@0.5.0`

Eight separate apps were scaffolded with `create-what@0.5.0`, then modified to exercise different framework surfaces.

## Release Verification Snapshot

Repository-level checks before publish:

- `npm test`: PASS (`197` passed, `0` failed)
- `npm run release:verify`: PASS (`test + build + bench:gate`)
- Bench gate: PASS (including DX microbench)

Selected core benchmark values from passing gate run:

- `signal() write (1 subscriber)`: `610,914 ops/s`
- `batch() 100 writes, 1 effect`: `656,510 ops/s`
- `h() component call`: `12,852,562 ops/s`
- `renderToString() list of 100`: `17,922 ops/s`

## Package Publish Result

Published successfully:

- `what-core@0.5.0`
- `what-router@0.5.0`
- `what-server@0.5.0`
- `what-compiler@0.5.0`
- `what-framework@0.5.0`
- `create-what@0.5.0`
- `what-framework-cli@0.3.0`

Verified on npm via `npm view <pkg>@<version> version`.

## App Validation Result

All 8 apps install and build successfully from npm packages.

Build output status:

- `app-01-signals`: PASS
- `app-02-computed`: PASS
- `app-03-store`: PASS
- `app-04-forms`: PASS
- `app-05-focus`: PASS
- `app-06-html`: PASS
- `app-07-events-style`: PASS
- `app-08-data`: PASS

## Findings (Prioritized)

## P1 — Tooling abstraction gap (Vite exposed directly)

Current scaffold scripts are:

- `dev: "vite"`
- `build: "vite build"`
- `preview: "vite preview"`

This works, but it keeps Vite visible as a required mental model. If the product goal is React-like abstraction, this should be wrapped by framework-owned commands (e.g. `what dev/build/preview`) while still using Vite internally.

Recommendation:

- Route scaffold scripts through `what-framework-cli` and treat Vite as implementation detail.

## P2 — npm package metadata cleanup warnings during publish

`npm publish` reported autocorrections on several packages (repository URL normalization and bin name cleaning). Publish still succeeds, but this adds noise and release uncertainty.

Recommendation:

- Run `npm pkg fix` (or manual metadata normalization) across publishable packages before next release.

## P2 — Default scaffold security noise (moderate vulnerabilities)

Fresh `npm install` on scaffolded apps reports `2 moderate` vulnerabilities (Vite ecosystem transitive advisory state). This may concern adopters despite not being framework runtime issues.

Recommendation:

- Periodically bump scaffolded Vite version and monitor advisories.

## Confirmed Good in 0.5.0

- Event casing compatibility: both `onClick` and `onclick` compile and run.
- Form API alignment: `formState.errors` getter + `ErrorMessage` usage works.
- Signal write compatibility: callable setter and `.set(...)` both work.
- HTML APIs: `innerHTML` and `dangerouslySetInnerHTML` compile correctly in consumer apps.
- Focus tooling: `FocusTrap` + `useFocusRestore` compose in modal flow.

## Suggested Next Iteration

1. Introduce framework-native CLI script targets in scaffolds to hide Vite details.
2. Add generated app smoke command (one command in root) to run/build all npm sample apps.
3. Add CI check to compile every docs snippet against published package versions.
4. Add `npm publish` preflight lint for package metadata consistency.
