# Starter gallery maintenance

The gallery at `/templates` extends the existing marketing design. The agent path is `/templates/agents`; the public metadata and retrieval index are `/templates/catalog.json` and `/templates/llms.txt`.

## Release one starter

Edit only `catalog.json` for its metadata. Keep `status: "draft"` and `release: null` until the deployment owner has verified the public repository, the live Vura app, its `/build` route and the repository's `BUILD.md` at the recorded commit. Draft entries are never emitted into the public HTML, JSON or text index.

Add an actual locally hosted screenshot under `templates/previews/`, then fill the entry:

```json
{
  "preview": {
    "src": "/templates/previews/your-starter.webp",
    "alt": "A factual description of the app screen",
    "width": 1440,
    "height": 900
  },
  "release": {
    "demoUrl": "https://your-verified-host.vura.app/",
    "buildUrl": "https://your-verified-host.vura.app/build",
    "verifiedAt": "2026-10-01T16:00:00.000Z",
    "deploymentId": "the-verified-deployment-uuid",
    "commitSha": "the-full-verified-repository-commit-sha"
  },
  "status": "published"
}
```

These are illustrative placeholders, not release evidence. Replace all of them with the real values. Public source and `BUILD.md` links are derived from the slug as `https://github.com/CelsianJs/<slug>`. Do not change architecture labels until the implemented behavior has been checked. In particular, local persistence is not a server database, and a static build is not request-time SSR.

Validation fails before rebuilding output when published metadata is malformed or its preview is missing. Metadata is an evidence record, not a network health check: recording a URL does not verify that URL. The release owner still exercises the deployment before publication.

## Check the integration

```sh
npm run test:templates
npm run build
npm run preview
```

The focused tests cover unpublished-entry exclusion, safe metadata, working link/clone shapes and built output contracts. With the page running, test search, combined rendering filters, no-results reset, copy success/failure, dark/light themes, keyboard navigation and a mobile width. The gallery content and all cards remain usable without JavaScript; only filters and copy are enhanced.

From the framework checkout, `npm run test:templates:ui` uses its existing Playwright dependency to exercise an isolated eight-entry fixture. Fixture URLs are test data, not deployed starters or publication evidence. Screenshots are written outside the repository under `/tmp/what-gallery-*`. Optionally set `WHAT_GALLERY_QA_PREVIEW` to a local PNG for the fixture previews; no image is published by that test.

After publication, run `npm run smoke:templates -- --base https://whatfw.com --expected-count 8` (use the actual release count). This read-only check fetches the gallery, agent page, public metadata, preview assets, every live demo and `/build` page, plus README/BUILD.md from each recorded public repository commit. It checks link consistency and HTTP responses, not app workflow correctness; the starter's own tests and browser QA still matter.

## Public build updates

`status.json` is the delivery owner's separate progress seam. It covers every catalog starter, including planned work, and builds `/templates/status`, `/templates/status/<slug>`, `/templates/status.json` and `/templates/status/llms.txt`. The live gallery still admits only verified published releases. Planned scope is labeled as intended features, not delivered behavior.

Each entry records `phase`, `updatedAt`, a plain-language `summary`, `verification` records (`at`, `label`, `result`, `details`), `lessons`, `limitations`, `blockers` and a chronological `journal` (`at`, `phase`, `title`, `summary`). Phases are `planned`, `building`, `local_verified`, `review` and `live`. Results are `passed`, `failed`, `pending` and `reported`; reported progress is explicitly not independent verification. A `local_verified` phase needs a recorded passed check, and a `live` phase needs a matching verified gallery release.

Source starts as `{"state":"reserved","verifiedAt":null,"commitSha":null}`. A reserved name is not linked as runnable public code. Switch to `state: "published"` only after checking that the implementation, README and BUILD.md exist publicly at the full `commitSha`; record its `verifiedAt`. Source can publish before deployment. Live source and release SHAs must agree.

After a build batch, update the actual facts and append a concise public journal event. Do not paste prompts, private task identifiers, machine paths, keys or raw agent logs. Verification summaries should describe commands and results, not dump terminal output. Record real lessons and limitations; leave lessons empty rather than inventing a build history. Update entry/batch timestamps and run the complete docs build. No background process edits these source records.

The status overview fetches the published status JSON every60seconds with `cache: 'no-store'`, offers manual refresh/retry, pauses checks while offline and shows the last successful check time. It announces progress only when entry facts actually change; a batch timestamp change alone is not a new product update. Rebuilding/deploying the page is how new facts reach watchers. No-JavaScript readers see the last static snapshot and no inactive refresh control.

For a status mirror or the marketing release, add `--expected-status-count 18` to the smoke command. It checks all status journal routes and that reserved/unreleased entries have no source or demo links in their metadata. The live count remains dynamic: use `--expected-count` with the actual number of verified releases, not the number of planned products.

The marketing site still deploys through its existing GitHub/Vercel integration. Starter apps deploy separately to Vura using their repository instructions. `vura-platform deploy` uploads an existing `dist/` and does not execute the app build.
