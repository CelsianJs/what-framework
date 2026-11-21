/**
 * What Framework Babel Plugin
 *
 * One front end, two back ends, chosen with the `generate` option:
 *
 *   generate: 'dom' (default)  JSX -> cloned templates + fine-grained bindings
 *     const _tmpl$0 = _$template('<div class="container"><h1>Title</h1><p></p></div>');
 *     function App() {
 *       const _el$0 = _tmpl$0();
 *       _$insert(_el$0.firstChild.nextSibling, () => desc());
 *       return _el$0;
 *     }
 *
 *   generate: 'ssr'            JSX -> pre-joined server strings, holes as h() gets them
 *     const _tmpl$0 = ['<div class="container"><h1>Title</h1><p>', '</p></div>'];
 *     function App() {
 *       return _$ssr(_tmpl$0, () => desc());
 *     }
 *
 * Both back ends read the same element classification, attribute aliases,
 * child layout, list detection and component lowering decisions, so server
 * markup and client templates cannot drift apart. Modules:
 *
 *   babel/common.js         shared front end: names, attributes, namespaces, child slots
 *   babel/reactivity.js     which expressions read signals
 *   babel/lists.js          `.map()` detection and key analysis
 *   babel/nesting.js        compile-time HTML nesting rules
 *   babel/dom.js            DOM back end (what-framework/render)
 *   babel/auto-selector.js  DOM-only `sel() === row.id` rewrite
 *   babel/ssr.js            server back end (what-framework/ssr-runtime)
 *   babel/dev-metadata.js   development names and source locations
 *   babel/server-actions.js stable server action ids
 *
 * Options:
 *   generate      'dom' | 'ssr'   which back end lowers JSX (default 'dom')
 *   hydratable    boolean         DOM back end: output that hydrate() can adopt
 *                                 server-rendered markup with (default false)
 *   production    boolean         production build: no development warnings or metadata
 *   devMetadata   boolean         development builds only: component, signal and
 *                                 binding names with source locations
 *   projectRoot   string          root that source locations and action ids are relative to
 *   autoSelector  boolean         DOM back end: rewrite `sel() === row.key` (default true)
 *   onActionId    (meta) => void  called for every server action id
 */

import { t, setTypes } from './babel/types.js';
import { deferForwardedChildren, initFileState, isWhatModuleSource, recordName } from './babel/common.js';
import { initDomState, finishDomProgram, transformJsxRoot } from './babel/dom.js';
import { initSsrState, finishSsrProgram, transformSsrRoot } from './babel/ssr.js';
import { SERVER_ACTION_SOURCES, normalizeActionFilename, transformServerAction } from './babel/server-actions.js';
import { annotatePrimitive } from './babel/dev-metadata.js';

export default function whatBabelPlugin({ types }) {
  setTypes(types);

  return {
    name: 'what-jsx-transform',

    visitor: {
      Program: {
        enter(path, state) {
          const generate = state.opts?.generate ?? 'dom';
          if (generate !== 'dom' && generate !== 'ssr') {
            throw new Error(`[what-compiler] Unknown "generate" option ${JSON.stringify(generate)}: use "dom" or "ssr".`);
          }
          state.ssr = generate === 'ssr';
          initFileState(state);
          if (state.ssr) initSsrState(state);
          else initDomState(state);

          state.serverActionBindings = new Set();
          state.serverActionNamespaces = new Set();
          state.serverActionIds = new Map();
          state.serverActionFilename = normalizeActionFilename(
            state.file?.opts?.filename,
            state.opts?.projectRoot || state.file?.opts?.cwd
          );

          // --- Imported Signal Tracking ---
          // Only mark imports as potentially reactive if they come from known
          // reactive sources: what-framework, what-framework/*, relative paths
          // (user stores), or functions matching use*/create* naming conventions.
          // This prevents over-wrapping of utility imports (lodash, etc.).
          state.importedIdentifiers = new Set();
          // <Switch>, <Show>, <For> and <Match> are dispatched on the bare tag
          // name, and Ant Design, Headless UI and MUI all ship a <Switch>.
          // Recording which package a tag was imported from tells What's own
          // control flow apart from a third party's by provenance instead.
          state.whatImports = new Set();
          state.foreignImports = new Set();
          for (const node of path.node.body) {
            if (t.isImportDeclaration(node)) {
              const source = node.source.value;
              const isWhatSource = isWhatModuleSource(source);
              const isReactiveSource =
                isWhatSource ||
                source.startsWith('./') ||
                source.startsWith('../');

              for (const spec of node.specifiers) {
                let localName = null;
                if (t.isImportSpecifier(spec) && t.isIdentifier(spec.local)) {
                  localName = spec.local.name;
                } else if (t.isImportDefaultSpecifier(spec) && t.isIdentifier(spec.local)) {
                  localName = spec.local.name;
                } else if (t.isImportNamespaceSpecifier(spec) && t.isIdentifier(spec.local)) {
                  localName = spec.local.name;
                }

                if (localName) {
                  // Mark as reactive if from a reactive source, or if the name
                  // matches use*/create* conventions (hooks/signal creators)
                  if (isReactiveSource || /^(use|create)[A-Z]/.test(localName)) {
                    state.importedIdentifiers.add(localName);
                  }
                  // A relative import can be a re-export of What's own control
                  // flow, so only a bare package specifier counts as foreign.
                  if (isWhatSource) state.whatImports.add(localName);
                  else if (!source.startsWith('.')) state.foreignImports.add(localName);
                }

                if (SERVER_ACTION_SOURCES.has(source)) {
                  if (
                    t.isImportSpecifier(spec)
                    && t.isIdentifier(spec.imported, { name: 'action' })
                    && t.isIdentifier(spec.local)
                  ) {
                    state.serverActionBindings.add(spec.local.name);
                  } else if (t.isImportNamespaceSpecifier(spec) && t.isIdentifier(spec.local)) {
                    state.serverActionNamespaces.add(spec.local.name);
                  }
                }
              }
            }
          }

          // Every name the file already spells, so a generated name never
          // collides with one.
          t.traverseFast(path.node, (node) => {
            if (node.type === 'Identifier' || node.type === 'JSXIdentifier') recordName(state, node.name);
          });
          // Before any JSX is lowered: forwarded children, server action ids
          // and development names, all read against the original source
          // positions.
          path.traverse({
            Function(fnPath) {
              deferForwardedChildren(fnPath);
            },
            CallExpression(callPath) {
              transformServerAction(callPath, state);
              annotatePrimitive(callPath, state);
            },
          });
        },

        exit(path, state) {
          if (state.ssr) finishSsrProgram(path, state);
          else finishDomProgram(path, state);
        },
      },

      JSXElement(path, state) {
        if (state.ssr) transformSsrRoot(path, state);
        else transformJsxRoot(path, state);
      },

      JSXFragment(path, state) {
        // Fragments share the element driver: their element children push
        // `const _el$N = ...` setup into _pendingSetup, which MUST be drained
        // here (hoisted or IIFE-wrapped) or the emitted `_el$N` references
        // are never declared (ReferenceError at runtime).
        if (state.ssr) transformSsrRoot(path, state);
        else transformJsxRoot(path, state);
      },
    },
  };
}
