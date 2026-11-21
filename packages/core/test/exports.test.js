// The public surface is a decision, not a drift: this file pins what the root
// entry and each subpath export, and checks that import-changes.js (the table
// of names the root entry dropped in 0.15) agrees with the modules it points
// at, with what-framework's mirror of what-core, and with docs/UPGRADING.md.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IMPORT_CHANGES } from '../src/import-changes.js';
import { renderSection } from '../../../scripts/generate-import-changes.mjs';

const names = async (path) => Object.keys(await import(path)).sort();

const ROOT = [
  // Reactivity
  'signal', 'computed', 'effect', 'batch', 'untrack', 'flushSync', 'createRoot', 'getOwner', 'runWithOwner',
  'createSelector',
  // Async values, transitions and optimistic updates
  'refresh', 'isPending', 'startTransition', 'useTransition', 'useOptimistic', 'use', 'settled',
  // Rendering
  'h', 'Fragment', 'html', 'mount', 'hydrate', 'applyStreamedBoundaries',
  // Hooks
  'useState', 'useSignal', 'useComputed', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer',
  'createContext', 'useContext', 'onMount', 'onCleanup', 'createResource', 'useLoaderData', 'useId',
  // Components and boundaries
  'memo', 'lazy', 'Suspense', 'ErrorBoundary', 'Show', 'For', 'Switch', 'Match', 'Island', 'Portal',
  // Stores
  'createStore', 'derived',
  // Document head and the server response
  'Head', 'getResponse',
  // Diagnostics
  'getDiagnostics', 'subscribeDiagnostics', 'clearDiagnostics', 'getErrorDefinition', 'WhatError',
];

const KITS = {
  a11y: [
    'useFocus', 'useFocusRestore', 'useFocusTrap', 'FocusTrap', 'announce', 'announceAssertive', 'SkipLink',
    'useAriaExpanded', 'useAriaSelected', 'useAriaChecked', 'useRovingTabIndex', 'VisuallyHidden', 'LiveRegion',
    'useIds', 'useDescribedBy', 'useLabelledBy', 'Keys', 'onKey', 'onKeys',
  ],
  ui: ['Skeleton', 'SkeletonText', 'SkeletonAvatar', 'SkeletonCard', 'SkeletonTable', 'IslandSkeleton', 'useSkeleton', 'Placeholder', 'LoadingDots', 'Spinner'],
  motion: ['spring', 'tween', 'easings', 'useTween', 'useGesture', 'useAnimatedValue', 'createTransitionClasses', 'cssTransition', 'transitionClass'],
  dom: [
    'scheduleRead', 'scheduleWrite', 'flushScheduler', 'measure', 'mutate', 'useScheduledEffect', 'nextFrame', 'raf',
    'onResize', 'onIntersect', 'smoothScrollTo', 'cls', 'style', 'debounce', 'throttle', 'useMediaQuery',
    'useLocalStorage', 'useClickOutside', 'clearHead',
  ],
  form: ['useForm', 'useField', 'rules', 'simpleResolver', 'zodResolver', 'yupResolver', 'Input', 'Textarea', 'Select', 'Checkbox', 'Radio', 'ErrorMessage'],
  data: ['useFetch', 'useSWR', 'useQuery', 'useInfiniteQuery', 'invalidateQueries', 'prefetchQuery', 'setQueryData', 'getQueryData', 'clearCache'],
};

// Where a module specifier in the table lives in this repo.
const MODULE = {
  'what-framework/render': '../../what/src/render.js',
  'what-core/render': '../src/render.js',
  'what-core/internal': '../src/entries/internal.js',
  ...Object.fromEntries(Object.keys(KITS).map((kit) => [`what-framework/${kit}`, `../src/entries/${kit}.js`])),
};

describe('the root entry', () => {
  it('exports exactly the pinned names', async () => {
    assert.deepEqual(await names('../src/index.js'), [...ROOT].sort());
  });

  it('what-framework re-exports it unchanged', async () => {
    assert.deepEqual(await names('../../what/src/index.js'), [...ROOT].sort());
  });

  it('does not give React\'s names another meaning', async () => {
    const root = await import('../src/index.js');
    const motion = await import('../src/entries/motion.js');
    // useTransition / startTransition are React's transition API.
    assert.notEqual(root.useTransition, motion.useTween);
    const [isPending, startTransition] = root.useTransition();
    assert.equal(typeof isPending, 'function', 'isPending is an accessor');
    assert.equal(isPending(), false);
    assert.equal(typeof startTransition, 'function');
    assert.ok(!('transition' in root), 'the class helper is transitionClass in what-framework/motion');
    assert.ok(!('on' in root), 'the DOM listener lives in what-framework/render');
    assert.equal(typeof root.useId('t'), 'string', 'useId returns a string, as in React');
  });
});

describe('the domain kits', () => {
  for (const [kit, expected] of Object.entries(KITS)) {
    it(`what-core/${kit} exports exactly its kit, and what-framework/${kit} mirrors it`, async () => {
      assert.deepEqual(await names(`../src/entries/${kit}.js`), [...expected].sort());
      assert.deepEqual(await names(`../../what/src/${kit}.js`), [...expected].sort());
    });
  }

  it('no name is exported by two public entries', async () => {
    const seen = new Map(ROOT.map((n) => [n, '.']));
    for (const [kit, list] of Object.entries(KITS)) {
      for (const n of list) {
        assert.ok(!seen.has(n), `${n} is exported by both ${seen.get(n)} and ${kit}`);
        seen.set(n, kit);
      }
    }
  });
});

describe('import-changes.js', () => {
  it('names each dropped name once, and none that the root entry still exports', () => {
    const dropped = IMPORT_CHANGES.map((c) => c.name);
    assert.equal(new Set(dropped).size, dropped.length);
    for (const c of IMPORT_CHANGES) {
      assert.equal(ROOT.includes(c.name), c.onRoot === true, `${c.name} is on the root entry and in the table without onRoot`);
    }
  });

  it('points every moved name at a module that exports it, under its new name', async () => {
    for (const change of IMPORT_CHANGES) {
      assert.equal(typeof change.note, 'string');
      if (change.to === null) continue;
      const path = MODULE[change.to];
      assert.ok(path, `unknown module ${change.to}`);
      const mod = await import(path);
      assert.ok((change.as || change.name) in mod, `${change.to} does not export ${change.as || change.name}`);
    }
  });

  it('is what docs/UPGRADING.md shows (npm run docs:imports regenerates it)', () => {
    const doc = readFileSync(new URL('../../../docs/UPGRADING.md', import.meta.url), 'utf8');
    assert.ok(doc.includes(renderSection()), 'docs/UPGRADING.md is stale: run npm run docs:imports');
  });
});
