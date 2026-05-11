# What Framework — Next Session Pickup

## Current wrapped state — 2026-05-11

Code-side hardening sprint work is wrapped for What Framework.

Current head:

- Use `git rev-parse --short HEAD` on `main`; this handoff file is intentionally committed after release code changes, so avoid copying a stale self-referential hash.
- Tag `v0.8.4` pushed.
- Working tree was clean at final audit.

Released public registry state:

- `what-core@0.8.4`
- `what-server@0.8.4`
- `what-framework@0.8.4`
- `what-framework-cli@0.8.4`
- `create-what@0.8.4`

Latest verified gates:

- GitHub CI passed on the handoff-doc head after this file was restored; see workspace audit for the latest run id.
- GitHub Release artifact: https://github.com/CelsianJs/what-framework/releases/tag/v0.8.4
- Registry smoke verified `npx create-what@0.8.4 --help` prints usage without scaffolding.
- Registry smoke verified `npx create-what@0.8.4 demo-app --yes` generates dependencies at `^0.8.4` and the generated app builds.
- Registry smoke verified `npx --package what-framework-cli@0.8.4 what --help` and `npx --package what-framework-cli@0.8.4 what build` both pass.

Important fixes landed during wrap:

- `create-what --help` no longer scaffolds an app.
- Generated app dependency versions derive from package metadata instead of stale constants.
- CLI `_configCache` temporal-dead-zone crash in registry `what build` was fixed.
- CLI/init tests are included in the root gate.

Open queue:

- No open PRs at final audit.

Resume command:

```bash
cd what-fw
npm test
npm run build
npm run verify:registry
```
