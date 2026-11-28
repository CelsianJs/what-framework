# what-devtools

Development tools for [What Framework](https://whatfw.com). Provides runtime instrumentation to inspect signals, effects, and components. Exposes a `window.__WHAT_DEVTOOLS__` global for console-based debugging and a subscribable event system for custom tooling.

## Install

```bash
npm install what-devtools --save-dev
```

## Quick Start

Call `installDevTools()` once at app startup, before your app code runs (checks that fire while modules load are only seen once it is installed; the what-devtools-mcp Vite plugin does this for you):

```js
import { installDevTools } from 'what-devtools';

installDevTools();
```

Then inspect your app in the browser console:

```js
__WHAT_DEVTOOLS__.signals      // All live signals with names and values
__WHAT_DEVTOOLS__.effects      // All active effects
__WHAT_DEVTOOLS__.components   // All mounted components
__WHAT_DEVTOOLS__.getSnapshot() // Full state snapshot, live values
__WHAT_DEVTOOLS__.getState()    // The same, JSON-safe, values previewed
__WHAT_DEVTOOLS__.getDiagnostics({ since: 0 }) // Coded diagnostics: { events, seq, dropped }
```

## Event Subscription

Subscribe to real-time devtools events for custom tooling or a UI panel:

```js
import { subscribe } from 'what-devtools';

const unsub = subscribe((event, data) => {
  console.log(event, data);
  // Events:
  //   'signal:created'    { id, name, componentId }
  //   'signal:updated'    { id, name, value, prev, rev, writerEffectId }
  //   'signal:disposed'   { id }
  //   'effect:created'    { id, name, kind, componentId }
  //   'effect:run'        { id, runCount, depSignalIds, causeSignalIds?, causeComputedIds? }
  //   'effect:disposed'   { id }
  //   'component:mounted'   { id, name, parentId }
  //   'component:unmounted' { id }
  //   'error:captured'    { message, stack, type, effectId, code?, timestamp }
  //   'diagnostic'        { seq, firstSeq, code, severity, message, fix, owner, loc, subject, data, count }
});
```

`writerEffectId` is the effect that was running when the signal was written
(null for a write from an event handler or plain code); `causeSignalIds` and
`causeComputedIds` are the dependencies whose change made the effect re-run.
`error:captured` covers errors thrown by effects (in their first run, a re-run
or a cleanup), by `onCleanup` callbacks, and errors that escape to the window
(event handlers, promises). When the engine stops a looping effect it reports
`ERR_INFINITE_EFFECT` itself, naming the effect and the re-runs it made, and
devtools passes it on as a `diagnostic` event. The reactive graph is read
through what-core's development API (`__depsOf`, `__currentEffect`).

## DevPanel Component

A built-in panel component for visual debugging (import separately):

```js
import DevPanel from 'what-devtools/panel';
```

## API

| Export | Description |
|---|---|
| `installDevTools(core?)` | Initialize devtools and wire into what-core's hooks (imports what-core itself when `core` is not passed) |
| `subscribe(fn)` | Subscribe to devtools events. Returns unsubscribe function |
| `getSnapshot()` | Get a snapshot of all signals, effects, and components, with live values |
| `getState({ budget? })` | The whole registry, JSON-safe: exact ids, names, revisions, run counts and dependencies, each signal value a bounded preview |
| `preview(value, budget?)` | A JSON-safe preview of any value, cut with explicit markers |
| `getDiagnostics({ since? })` | Coded diagnostics what-core reported after the cursor: `{ events, seq, dropped }` |
| `getErrors({ since? })` | Thrown errors devtools captured (`since` is a timestamp) |
| `safeSerialize(value, budget?)` | `preview()` with a larger budget (2000 characters of JSON by default) |
| `registerSignal(sig, name?)` | Manually register a signal |
| `notifySignalUpdate(sig, next?, prev?)` | Notify devtools of a signal write |
| `unregisterSignal(sig)` | Unregister a signal |
| `registerEffect(e, name?)` | Manually register an effect |
| `unregisterEffect(e)` | Unregister an effect |
| `registerComponent(name, element, parentId?)` | Register a component mount |
| `unregisterComponent(id)` | Unregister a component |
| `signals` | Map of all tracked signals |
| `effects` | Map of all tracked effects |
| `components` | Map of all tracked components |

## Sub-path Exports

| Path | Contents |
|---|---|
| `what-devtools` | Instrumentation API |
| `what-devtools/panel` | DevPanel UI component |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
