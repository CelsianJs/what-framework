import { signal, computed, effect, batch, untrack } from './reactive.js';
import { getCurrentComponent } from './dom.js';
function getCtx() {
const ctx = getCurrentComponent();
if (!ctx) throw new Error('Hooks must be called inside a component');
return ctx;
}
function getHook(ctx) {
const index = ctx.hookIndex++;
return { index, exists: index < ctx.hooks.length };
}
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
return context._value;
}
export function createContext(defaultValue) {
const ctx = {
_value: defaultValue,
Provider: ({ value, children }) => {
ctx._value = value;
return children;
},
};
return ctx;
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
function depsChanged(oldDeps, newDeps) {
if (oldDeps === undefined) return true;
if (!oldDeps || !newDeps) return true;
if (oldDeps.length !== newDeps.length) return true;
for (let i = 0; i < oldDeps.length; i++) {
if (!Object.is(oldDeps[i], newDeps[i])) return true;
}
return false;
}