# what-devtools

Development tools for [What Framework](https://whatfw.com). Provides runtime instrumentation to inspect signals, effects, and components. Exposes a `window.__WHAT_DEVTOOLS__` global for console-based debugging and a subscribable event system for custom tooling.

## Install

```bash
npm install what-devtools --save-dev
```

## Quick Start

Call `installDevTools()` once at app startup:

```js
import { installDevTools } from 'what-devtools';

installDevTools();
```

Then inspect your app in the browser console:

```js
__WHAT_DEVTOOLS__.signals      // All live signals with names and values
__WHAT_DEVTOOLS__.effects      // All active effects
__WHAT_DEVTOOLS__.components   // All mounted components
__WHAT_DEVTOOLS__.getSnapshot() // Full state snapshot
```

## Event Subscription

Subscribe to real-time devtools events for custom tooling or a UI panel:

```js
import { subscribe } from 'what-devtools';

const unsub = subscribe((event, data) => {
  console.log(event, data);
  // Events:
  //   'signal:created'    { id, name, ref, createdAt }
  //   'signal:updated'    { id, name, value }
  //   'signal:disposed'   { id }
  //   'effect:created'    { id, name, createdAt }
  //   'effect:disposed'   { id }
  //   'component:mounted'   { id, name, element, mountedAt }
  //   'component:unmounted' { id }
});
```

## DevPanel Component

A built-in panel component for visual debugging (import separately):

```js
import DevPanel from 'what-devtools/panel';
```

## API

| Export | Description |
|---|---|
| `installDevTools(core?)` | Initialize devtools and wire into what-core's hooks |
| `subscribe(fn)` | Subscribe to devtools events. Returns unsubscribe function |
| `getSnapshot()` | Get a snapshot of all signals, effects, and components |
| `registerSignal(sig, name?)` | Manually register a signal |
| `notifySignalUpdate(sig)` | Notify devtools of a signal value change |
| `unregisterSignal(sig)` | Unregister a signal |
| `registerEffect(e, name?)` | Manually register an effect |
| `unregisterEffect(e)` | Unregister an effect |
| `registerComponent(name, element)` | Register a component mount |
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
