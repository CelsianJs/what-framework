// import-changes.js against the 0.14 root entry it describes. check:import-docs
// only compares docs/UPGRADING.md with the table, so a name that left the root
// with no record (getCollectedErrors and the agent-context API did) went
// unnoticed; this pins the 0.14 export list and holds the table to it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { IMPORT_CHANGES } from '../src/import-changes.js';
import { validateImports, configureGuardrails } from '../src/guardrails.js';

// `git show v0.14.0:packages/core/src/index.js`, every name it exported, by module.
const ROOT_0_14 = [
  // reactive.js
  'signal', 'computed', 'effect', 'signalMemo', 'batch', 'untrack', 'flushSync', 'createRoot', 'getOwner',
  'runWithOwner', 'onRootCleanup', '__setDevToolsHooks', '__drainPreinstallBuffer',
  // render.js
  'template', '_template', '_$template', 'svgTemplate', 'insert', 'mapArray', 'spread', 'setProp',
  'delegateEvents', 'on', 'classList', 'hydrate', 'isHydrating', '_$createComponent', '_mapArrayToArray',
  '_setTextInsertHook',
  // h.js, dom.js
  'h', 'Fragment', 'html', 'mount', '_isAriaAttr', '_beginComponentSSR', '_endComponentSSR',
  // hooks.js
  'useState', 'useSignal', 'useComputed', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext',
  'useReducer', 'createContext', 'onMount', 'onCleanup', 'createResource', 'useLoaderData',
  // components.js
  'memo', 'lazy', 'Suspense', 'ErrorBoundary', 'Show', 'For', 'Switch', 'Match', 'Island',
  // store.js
  'createStore', 'derived', 'storeComputed', 'atom',
  // head.js
  'Head', 'clearHead', 'beginHeadCollection', 'endHeadCollection',
  // server-context.js
  'getServerContext', 'setServerContext', 'runWithServerContext', '__installServerContextStorage',
  // hydration-data.js
  '__readHydrationData', '__resetHydrationData', 'getLoaderData', 'getResource',
  // helpers.js
  'each', 'cls', 'style', 'debounce', 'throttle', 'useMediaQuery', 'useLocalStorage', 'useClickOutside',
  'Portal', 'transition',
  // scheduler.js
  'scheduleRead', 'scheduleWrite', 'flushScheduler', 'measure', 'mutate', 'useScheduledEffect', 'nextFrame',
  'raf', 'onResize', 'onIntersect', 'smoothScrollTo',
  // animation.js
  'spring', 'tween', 'easings', 'useTransition', 'useGesture', 'useAnimatedValue', 'createTransitionClasses',
  'cssTransition',
  // a11y.js
  'useFocus', 'useFocusRestore', 'useFocusTrap', 'FocusTrap', 'announce', 'announceAssertive', 'SkipLink',
  'useAriaExpanded', 'useAriaSelected', 'useAriaChecked', 'useRovingTabIndex', 'VisuallyHidden', 'LiveRegion',
  'useId', 'useIds', 'useDescribedBy', 'useLabelledBy', 'Keys', 'onKey', 'onKeys',
  // skeleton.js
  'Skeleton', 'SkeletonText', 'SkeletonAvatar', 'SkeletonCard', 'SkeletonTable', 'IslandSkeleton',
  'useSkeleton', 'Placeholder', 'LoadingDots', 'Spinner',
  // data.js
  'useFetch', 'useSWR', 'useQuery', 'useInfiniteQuery', 'invalidateQueries', 'prefetchQuery', 'setQueryData',
  'getQueryData', 'clearCache', '__getCacheSnapshot',
  // form.js
  'useForm', 'useField', 'rules', 'simpleResolver', 'zodResolver', 'yupResolver', 'Input', 'Textarea', 'Select',
  'Checkbox', 'Radio', 'ErrorMessage',
  // errors.js
  'WhatError', 'ERROR_CODES', 'getErrorDefinition', 'createWhatError', 'classifyError', 'collectError',
  'getCollectedErrors', 'clearCollectedErrors',
  // guardrails.js
  'configureGuardrails', 'getGuardrailConfig', 'installSignalReadGuardrail', 'checkComponentName',
  'validateImports',
  // agent-context.js
  'installAgentContext', 'registerComponent', 'unregisterComponent', 'getMountedComponents', 'registerSignal',
  'unregisterSignal', 'getActiveSignals', 'getHealth',
];

const root = Object.keys(await import('../src/index.js'));
const internal = Object.keys(await import('../src/entries/internal.js'));
const recordFor = (name) => IMPORT_CHANGES.find((c) => c.name === name);

describe('import-changes.js and the 0.14 root entry', () => {
  it('pins the 177 names the 0.14 root entry exported', () => {
    assert.equal(ROOT_0_14.length, 177);
    assert.equal(new Set(ROOT_0_14).size, 177);
  });

  it('answers every 0.14 name that left the root entry', () => {
    const unanswered = ROOT_0_14.filter((name) => !root.includes(name) && !recordFor(name));
    assert.deepEqual(unanswered, [], 'left the root entry with no record in import-changes.js');
    for (const name of ROOT_0_14.filter((n) => !root.includes(n))) {
      assert.ok(!recordFor(name).neverOnRoot, `${name} was on the 0.14 root entry`);
    }
  });

  it('claims no name the 0.14 root entry did not export, except in the internal group', () => {
    const claimed = IMPORT_CHANGES.filter((c) => !c.neverOnRoot && !ROOT_0_14.includes(c.name)).map((c) => c.name);
    assert.deepEqual(claimed, [], 'never on the 0.14 root entry: mark the record neverOnRoot');
    const internalGroup = IMPORT_CHANGES.filter((c) => c.neverOnRoot);
    for (const c of internalGroup) {
      assert.ok(!ROOT_0_14.includes(c.name) && !root.includes(c.name), `${c.name} is or was on the root entry`);
      assert.equal(c.to, 'what-core/internal', c.name);
    }
  });

  it('lists every what-core/internal export the root entry never had in the internal group', () => {
    const unlisted = internal.filter((name) => !ROOT_0_14.includes(name) && !root.includes(name) && !recordFor(name)?.neverOnRoot);
    assert.deepEqual(unlisted, [], 'a new what-core/internal export needs a neverOnRoot record in import-changes.js');
  });
});

describe('the answer each record gives', () => {
  it('is the note, then the import to write, or says the name was removed', () => {
    for (const c of IMPORT_CHANGES) {
      const expected = c.to ? `${c.note} Import it with: import { ${c.as || c.name} } from '${c.to}'.` : `It was removed in 0.15. ${c.note}`;
      assert.equal(c.answer, expected, c.name);
    }
  });

  it('records where the animation helper useTransition went, and that the root entry has React\'s', () => {
    const record = recordFor('useTransition');
    assert.equal(record.onRoot, true);
    assert.ok(root.includes('useTransition') && root.includes('startTransition'));
    assert.match(record.answer, /useTransition and startTransition on the root entry are React's transition API/);
    assert.match(record.answer, /import \{ useTween \} from 'what-framework\/motion'\.$/);
  });

  it('points the error collector at diagnostics and the agent context at what-devtools', () => {
    for (const name of ['collectError', 'getCollectedErrors', 'clearCollectedErrors']) assert.match(recordFor(name).note, /Diagnostics\(/, name);
    for (const name of ['installAgentContext', 'registerComponent', 'unregisterComponent', 'getMountedComponents', 'registerSignal', 'unregisterSignal', 'getActiveSignals', 'getHealth']) {
      assert.match(recordFor(name).note, /what-devtools|what_\w+ MCP tool/, name);
    }
  });
});

describe('validateImports answers from the table', () => {
  configureGuardrails({ importValidation: true });

  it('gives a name that left the root entry its record\'s answer', () => {
    for (const name of ['getCollectedErrors', 'installAgentContext', 'useFocusTrap']) {
      const [result] = validateImports([name]);
      assert.equal(result.message, `"${name}" is not exported by what-framework.`);
      assert.equal(result.suggestion, recordFor(name).answer);
    }
  });

  it('accepts a name the root entry exports again, and answers its old export\'s new name', () => {
    assert.deepEqual(validateImports(['useTransition']), []);
    const [result] = validateImports(['useTween']);
    assert.equal(result.message, '"useTween" is not exported by what-framework.');
    assert.equal(result.suggestion, recordFor('useTransition').answer);
  });

  it('answers an internal name imported from the root entry with its module', () => {
    const [result] = validateImports(['__depsOf']);
    assert.match(result.suggestion, /import \{ __depsOf \} from 'what-core\/internal'/);
  });

  it('says nothing about a guess when there is no close match', () => {
    const [result] = validateImports(['useSyncExternalStore']);
    assert.equal(result.suggestion, 'Check the API reference.');
    assert.equal(validateImports(['startTransitionNow'])[0].suggestion, 'Check the API reference. Did you mean startTransition?');
    assert.doesNotMatch(JSON.stringify(validateImports(['qqqqqqqq', 'zzzzzzzzzz'])), /no close match|Did you mean/);
    assert.equal(validateImports(['singal'])[0].suggestion, 'Check the API reference. Did you mean signal?');
  });
});
