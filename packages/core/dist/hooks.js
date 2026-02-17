import { signal, computed, effect, batch, untrack, __DEV__ } from './reactive.js';
import { getCurrentComponent } from './dom.js';
function getCtx() {
const ctx = getCurrentComponent();
if (!ctx) {
throw new Error(
'[what] Hooks must be called inside a component function. ' +
'If you need reactive state outside a component, use signal() directly.'
);
}
return ctx;
}
function getHook(ctx) {
const index = ctx.hookIndex++;
return { index, exists: index < ctx.hooks.length };
}
let _useMemoNoDepsWarned = false;
export function useState(initial) {
const ctx = getCtx();
const { index, exists } = getHook(ctx);
if (!exists) {
const s = signal(typeof initial === 'function' ? initial() : initial);
ctx.hooks[index] = s;
}
const s = ctx.hooks[index];
return [s(), s.set];
}
export function useSignal(initial) {
const ctx = getCtx();
const { index, exists } = getHook(ctx);
if (!exists) {
ctx.hooks[index] = signal(typeof initial === 'function' ? initial() : initial);
}
return ctx.hooks[index];
}
export function useComputed(fn) {
const ctx = getCtx();
const { index, exists } = getHook(ctx);
if (!exists) {
ctx.hooks[index] = computed(fn);
}
return ctx.hooks[index];
}
export function useEffect(fn, deps) {
const ctx = getCtx();
const { index, exists } = getHook(ctx);
if (!exists) {
ctx.hooks[index] = { deps: undefined, cleanup: null };
}
const hook = ctx.hooks[index];
if (depsChanged(hook.deps, deps)) {
queueMicrotask(() => {
if (ctx.disposed) return;
if (hook.cleanup) hook.cleanup();
hook.cleanup = fn() || null;
});
hook.deps = deps;
}
}
export function useMemo(fn, deps) {
const ctx = getCtx();
const { index, exists } = getHook(ctx);
if (__DEV__ && deps === undefined && !_useMemoNoDepsWarned) {
_useMemoNoDepsWarned = true;
console.warn(
'[what] useMemo() called without a deps array. ' +
'This recomputes every render. Use useComputed() for signal-derived values, ' +
'or pass deps to useMemo().'
);
}
if (!exists) {
ctx.hooks[index] = { value: undefined, deps: undefined };
}
const hook = ctx.hooks[index];
if (depsChanged(hook.deps, deps)) {
hook.value = fn();
hook.deps = deps;
}
return hook.value;
}
export function useCallback(fn, deps) {
return useMemo(() => fn, deps);
}
export function useRef(initial) {
const ctx = getCtx();
const { index, exists } = getHook(ctx);
if (!exists) {
ctx.hooks[index] = { current: initial };
}
return ctx.hooks[index];
}
export function useContext(context) {
let ctx = getCurrentComponent();
if (__DEV__ && !ctx) {
console.warn(
`[what] useContext(${context?.displayName || 'Context'}) called outside of component render. ` +
'useContext must be called during component rendering, not inside effects or event handlers. ' +
'Store the context value in a variable during render and use that variable in your callback.'
);
}
while (ctx) {
if (ctx._contextValues && ctx._contextValues.has(context)) {
const val = ctx._contextValues.get(context);
return (val && val._signal) ? val() : val;
}
ctx = ctx._parentCtx;
}
return context._defaultValue;
}
export function createContext(defaultValue) {
const context = {
_defaultValue: defaultValue,
Provider: ({ value, children }) => {
const ctx = getCtx();
if (!ctx._contextValues) ctx._contextValues = new Map();
if (!ctx._contextSignals) ctx._contextSignals = new Map();
if (!ctx._contextSignals.has(context)) {
const s = signal(value);
ctx._contextSignals.set(context, s);
ctx._contextValues.set(context, s);
} else {
ctx._contextSignals.get(context).set(value);
}
return children;
},
};
return context;
}
export function useReducer(reducer, initialState, init) {
const ctx = getCtx();
const { index, exists } = getHook(ctx);
if (!exists) {
const initial = init ? init(initialState) : initialState;
const s = signal(initial);
const dispatch = (action) => {
s.set(prev => reducer(prev, action));
};
ctx.hooks[index] = { signal: s, dispatch };
}
const hook = ctx.hooks[index];
return [hook.signal(), hook.dispatch];
}
export function onMount(fn) {
const ctx = getCtx();
if (!ctx.mounted) {
ctx._mountCallbacks = ctx._mountCallbacks || [];
ctx._mountCallbacks.push(fn);
}
}
export function onCleanup(fn) {
const ctx = getCtx();
ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
ctx._cleanupCallbacks.push(fn);
}
export function createResource(fetcher, options = {}) {
const data = signal(options.initialValue ?? null);
const loading = signal(!options.initialValue);
const error = signal(null);
let controller = null;
const refetch = async (source) => {
if (controller) controller.abort();
controller = new AbortController();
const { signal: abortSignal } = controller;
loading.set(true);
error.set(null);
try {
const result = await fetcher(source, { signal: abortSignal });
if (!abortSignal.aborted) {
batch(() => {
data.set(result);
loading.set(false);
});
}
} catch (e) {
if (!abortSignal.aborted) {
batch(() => {
error.set(e);
loading.set(false);
});
}
}
};
const mutate = (value) => {
data.set(typeof value === 'function' ? value(data()) : value);
};
const ctx = getCurrentComponent?.();
if (ctx) {
ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
ctx._cleanupCallbacks.push(() => {
if (controller) controller.abort();
});
}
if (!options.initialValue) {
refetch(options.source);
}
return [data, { loading, error, refetch, mutate }];
}
function depsChanged(oldDeps, newDeps) {
if (oldDeps === undefined) return true;
if (!oldDeps || !newDeps) return true;
if (oldDeps.length !== newDeps.length) return true;
for (let i = 0; i < oldDeps.length; i++) {
if (!Object.is(oldDeps[i], newDeps[i])) return true;
}
return false;
}