/**
 * Shared signal-tracking utility for eslint-plugin-what rules.
 *
 * Single source of truth for identifying signal variables across all rules.
 * Tracks variables from useSignal, signal, useComputed, computed,
 * useSWR destructured fields, useFetch, useQuery, useInfiniteQuery, and createResource.
 */

// Functions that return a signal or computed directly
export const SIGNAL_CREATORS = [
  'signal', 'useSignal', 'computed', 'useComputed', 'memo',
];

// Functions whose return value has signal-like getter properties
export const SWR_LIKE_HOOKS = [
  'useSWR', 'useFetch', 'useQuery', 'useInfiniteQuery',
];

// Properties on SWR-like return objects that are getter functions (must be called)
export const SWR_GETTER_FIELDS = new Set([
  'data', 'error', 'isLoading', 'isValidating',
  'isFetching', 'isError', 'isSuccess',
  'status', 'fetchStatus',
  'hasNextPage', 'hasPreviousPage',
  'isFetchingNextPage', 'isFetchingPreviousPage',
]);

// Properties on signals/computeds that are safe to access without calling
export const SIGNAL_METHODS = new Set([
  'set', 'peek', 'subscribe', '_signal', '_subs', '_debugName',
]);

/**
 * Creates a signal tracker for use in ESLint rule visitors.
 *
 * Returns an object with:
 * - visitors: AST visitors to merge into the rule's return
 * - isSignal(name): check if a variable is a known signal
 * - isSWRGetter(objectName, propName): check if obj.prop is a SWR getter field
 * - swrObjects: Set of variable names that hold SWR-like return objects
 */
export function createSignalTracker() {
  const signalVars = new Set();
  const swrObjects = new Set();
  // Track SWR destructured fields: { data, error, isLoading } = useSWR(...)
  const swrGetterVars = new Set();

  const visitors = {
    VariableDeclarator(node) {
      if (!node.init) return;

      // Direct signal creation: const x = useSignal(0)
      if (
        node.init.type === 'CallExpression' &&
        node.init.callee.type === 'Identifier' &&
        SIGNAL_CREATORS.includes(node.init.callee.name) &&
        node.id.type === 'Identifier'
      ) {
        signalVars.add(node.id.name);
      }

      // SWR-like hook call
      if (
        node.init.type === 'CallExpression' &&
        node.init.callee.type === 'Identifier' &&
        SWR_LIKE_HOOKS.includes(node.init.callee.name)
      ) {
        // const swr = useSWR(...) — track the whole object
        if (node.id.type === 'Identifier') {
          swrObjects.add(node.id.name);
        }

        // const { data, error, isLoading } = useSWR(...)
        if (node.id.type === 'ObjectPattern') {
          for (const prop of node.id.properties) {
            if (
              prop.type === 'Property' &&
              prop.key.type === 'Identifier' &&
              SWR_GETTER_FIELDS.has(prop.key.name) &&
              prop.value.type === 'Identifier'
            ) {
              swrGetterVars.add(prop.value.name);
            }
          }
        }
      }

      // createResource returns [dataSignal, { loading, error, ... }]
      if (
        node.init.type === 'CallExpression' &&
        node.init.callee.type === 'Identifier' &&
        node.init.callee.name === 'createResource' &&
        node.id.type === 'ArrayPattern'
      ) {
        const elements = node.id.elements;
        // First element is a signal
        if (elements[0]?.type === 'Identifier') {
          signalVars.add(elements[0].name);
        }
      }
    },
  };

  return {
    visitors,
    isSignal: (name) => signalVars.has(name),
    isSignalLike: (name) => signalVars.has(name) || swrGetterVars.has(name),
    isSWRObject: (name) => swrObjects.has(name),
    isSWRGetterField: (propName) => SWR_GETTER_FIELDS.has(propName),
    signalVars,
    swrObjects,
    swrGetterVars,
  };
}
