## What changed

<!-- One or two sentences. What does this do that the repo did not do before? -->

## Why

<!-- The problem, not the patch. If it fixes a bug, what was the symptom and
     what was actually wrong? Link the issue if there is one. -->

## How it was verified

<!-- Say what you ran and what it printed. "Tests pass" is not verification;
     "2,503 pass / 0 fail, and the new test fails 3/3 against the old code" is. -->

- [ ] `npm test` passes
- [ ] `npm run lint`, `npm run typecheck` and `npm run typecheck:src` pass
- [ ] A bug fix has a test that **fails without the fix** (say so, with the count)
- [ ] Anything touching bundle size ran `npm run build && npm run check:size`
- [ ] Anything touching rendering, hydration or actions ran `npm run smoke:apps`
- [ ] A new public export has a `.d.ts` declaration (`npm run hygiene:types`)
- [ ] A new `throw` carries an `ERR_*` code catalogued in `packages/core/src/errors.js`

## Anything a reviewer should look at twice

<!-- Trade-offs you made, things you were unsure about, behaviour that changed
     even slightly. Say it here rather than letting a reviewer find it. -->
