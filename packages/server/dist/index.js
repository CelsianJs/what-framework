// packages/server/src/index.js
import { h } from "what-core";

// packages/server/src/actions.js
import { signal, batch } from "what-core";
var actionRegistry = /* @__PURE__ */ new Map();
function getCsrfToken() {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="what-csrf-token"]');
    if (meta) {
      return meta.getAttribute("content");
    }
    const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}
function generateCsrfToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("[what] No secure random source available for CSRF token generation");
}
function validateCsrfToken(requestToken, sessionToken) {
  if (!requestToken || !sessionToken) return false;
  if (requestToken.length !== sessionToken.length) return false;
  let result = 0;
  for (let i = 0; i < requestToken.length; i++) {
    result |= requestToken.charCodeAt(i) ^ sessionToken.charCodeAt(i);
  }
  return result === 0;
}
function csrfMetaTag(token) {
  const escaped = String(token).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<meta name="what-csrf-token" content="${escaped}">`;
}
var _actionCounter = 0;
function generateActionId() {
  const rand = typeof crypto !== "undefined" && crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("") : `c${(++_actionCounter).toString(36)}_${Date.now().toString(36)}`;
  return `a_${rand}`;
}
function action(fn, options = {}) {
  const id = options.id || generateActionId();
  const { onError, onSuccess, revalidate } = options;
  if (typeof window === "undefined") {
    actionRegistry.set(id, { fn, options });
  }
  async function callAction(...args) {
    if (typeof window === "undefined") {
      return fn(...args);
    }
    const timeout = options.timeout || 3e4;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const csrfToken = getCsrfToken();
      const headers = {
        "Content-Type": "application/json",
        "X-What-Action": id
      };
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      const response = await fetch("/__what_action", {
        method: "POST",
        headers,
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({ args })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Action failed" }));
        throw new Error(error.message || "Action failed");
      }
      const result = await response.json();
      if (onSuccess) onSuccess(result);
      if (revalidate) {
        for (const path of revalidate) {
          invalidatePath(path);
        }
      }
      return result;
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error(`Action "${id}" timed out after ${timeout}ms`);
        timeoutError.code = "TIMEOUT";
        if (onError) onError(timeoutError);
        throw timeoutError;
      }
      if (onError) onError(error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  callAction._actionId = id;
  callAction._isAction = true;
  return callAction;
}
function formAction(actionFn, options = {}) {
  const { onSuccess, onError, resetOnSuccess = true } = options;
  return async (formDataOrEvent) => {
    let formData;
    let form;
    if (formDataOrEvent instanceof Event) {
      formDataOrEvent.preventDefault();
      form = formDataOrEvent.target;
      formData = new FormData(form);
    } else {
      formData = formDataOrEvent;
    }
    const data = {};
    let hasFiles = false;
    for (const [key, value] of formData.entries()) {
      if (typeof File !== "undefined" && value instanceof File) {
        hasFiles = true;
      }
      if (data[key]) {
        if (Array.isArray(data[key])) {
          data[key].push(value);
        } else {
          data[key] = [data[key], value];
        }
      } else {
        data[key] = value;
      }
    }
    try {
      const result = hasFiles ? await actionFn(data, formData) : await actionFn(data);
      if (onSuccess) onSuccess(result, form);
      if (resetOnSuccess && form) form.reset();
      return result;
    } catch (error) {
      if (onError) onError(error, form);
      throw error;
    }
  };
}
function useAction(actionFn) {
  const isPending = signal(false);
  const error = signal(null);
  const data = signal(null);
  async function trigger(...args) {
    isPending.set(true);
    error.set(null);
    try {
      const result = await actionFn(...args);
      data.set(result);
      return result;
    } catch (e) {
      error.set(e);
      throw e;
    } finally {
      isPending.set(false);
    }
  }
  return {
    trigger,
    isPending: () => isPending(),
    error: () => error(),
    data: () => data(),
    reset: () => {
      error.set(null);
      data.set(null);
    }
  };
}
function useFormAction(actionFn, options = {}) {
  const { resetOnSuccess = true } = options;
  const formRef = { current: null };
  const actionState = useAction(formAction(actionFn, { resetOnSuccess }));
  function handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    formRef.current = e.target;
    return actionState.trigger(formData);
  }
  return {
    ...actionState,
    handleSubmit,
    formRef
  };
}
function useOptimistic(initialValue, reducer) {
  const value = signal(initialValue);
  const pending = signal([]);
  const baseValue = signal(initialValue);
  function addOptimistic(action2) {
    const optimisticValue = reducer(value.peek(), action2);
    batch(() => {
      pending.set([...pending.peek(), action2]);
      value.set(optimisticValue);
    });
  }
  function resolve(action2, serverValue) {
    batch(() => {
      pending.set(pending.peek().filter((a) => a !== action2));
      if (serverValue !== void 0) {
        baseValue.set(serverValue);
        let current = serverValue;
        for (const a of pending.peek()) {
          current = reducer(current, a);
        }
        value.set(current);
      }
    });
  }
  function rollback(action2, realValue) {
    batch(() => {
      const newPending = pending.peek().filter((a) => a !== action2);
      pending.set(newPending);
      const base = realValue !== void 0 ? realValue : baseValue.peek();
      baseValue.set(base);
      let current = base;
      for (const a of newPending) {
        current = reducer(current, a);
      }
      value.set(current);
    });
  }
  async function withOptimistic(action2, asyncFn) {
    addOptimistic(action2);
    try {
      const result = await asyncFn();
      resolve(action2, result);
      return result;
    } catch (e) {
      rollback(action2);
      throw e;
    }
  }
  return {
    value: () => value(),
    isPending: () => pending().length > 0,
    addOptimistic,
    resolve,
    rollback,
    withOptimistic,
    set: (v) => {
      value.set(v);
      baseValue.set(v);
    }
  };
}
var revalidationCallbacks = /* @__PURE__ */ new Map();
function onRevalidate(path, callback) {
  if (!revalidationCallbacks.has(path)) {
    revalidationCallbacks.set(path, /* @__PURE__ */ new Set());
  }
  revalidationCallbacks.get(path).add(callback);
  return () => {
    revalidationCallbacks.get(path)?.delete(callback);
  };
}
function invalidatePath(path) {
  const callbacks = revalidationCallbacks.get(path);
  if (callbacks) {
    for (const cb of callbacks) {
      try {
        cb();
      } catch (e) {
        console.error("[what] Revalidation error:", e);
      }
    }
  }
}
function handleActionRequest(req, actionId, args, options = {}) {
  const { csrfToken: sessionCsrfToken, skipCsrf = false } = options;
  if (!skipCsrf) {
    if (!sessionCsrfToken) {
      return Promise.resolve({
        status: 500,
        body: {
          message: "[what] CSRF token not configured. Pass { csrfToken: sessionToken } to handleActionRequest, or { skipCsrf: true } to explicitly opt out."
        }
      });
    }
    const requestCsrfToken = req?.headers?.["x-csrf-token"] || req?.headers?.["X-CSRF-Token"];
    if (!validateCsrfToken(requestCsrfToken, sessionCsrfToken)) {
      return Promise.resolve({ status: 403, body: { message: "Invalid CSRF token" } });
    }
  }
  const action2 = actionRegistry.get(actionId);
  if (!action2) {
    return Promise.resolve({ status: 404, body: { message: "Action not found" } });
  }
  if (!Array.isArray(args)) {
    return Promise.resolve({ status: 400, body: { message: "Invalid action arguments" } });
  }
  return action2.fn(...args).then((result) => ({ status: 200, body: result })).catch((error) => {
    console.error(`[what] Action "${actionId}" error:`, error);
    return {
      status: 500,
      body: { message: "Action failed" }
    };
  });
}
function getRegisteredActions() {
  return [...actionRegistry.keys()];
}
function useMutation(mutationFn, options = {}) {
  const { onSuccess, onError, onSettled } = options;
  const state = {
    isPending: signal(false),
    error: signal(null),
    data: signal(null)
  };
  async function mutate(...args) {
    state.isPending.set(true);
    state.error.set(null);
    try {
      const result = await mutationFn(...args);
      state.data.set(result);
      if (onSuccess) onSuccess(result, ...args);
      return result;
    } catch (error) {
      state.error.set(error);
      if (onError) onError(error, ...args);
      throw error;
    } finally {
      state.isPending.set(false);
      if (onSettled) onSettled(state.data.peek(), state.error.peek(), ...args);
    }
  }
  return {
    mutate,
    isPending: () => state.isPending(),
    error: () => state.error(),
    data: () => state.data(),
    reset: () => {
      state.error.set(null);
      state.data.set(null);
    }
  };
}

// packages/server/src/index.js
var _hydrationIdCounter = 0;
function resetHydrationId() {
  _hydrationIdCounter = 0;
}
function nextHydrationId() {
  return "h" + _hydrationIdCounter++;
}
function renderToHydratableString(vnode) {
  resetHydrationId();
  return _renderHydratable(vnode);
}
function _renderHydratable(vnode) {
  if (vnode == null || vnode === false || vnode === true) return "";
  if (typeof vnode === "string" || typeof vnode === "number") {
    return escapeHtml(String(vnode));
  }
  if (typeof vnode === "function" && vnode._signal) {
    return `<!--$-->${_renderHydratable(vnode())}<!--/$-->`;
  }
  if (typeof vnode === "function") {
    try {
      return `<!--$-->${_renderHydratable(vnode())}<!--/$-->`;
    } catch (e) {
      if (typeof process !== "undefined" && true) {
        console.warn("[what-server] Error rendering reactive function in SSR:", e.message);
      }
      return "<!--$--><!--/$-->";
    }
  }
  if (Array.isArray(vnode)) {
    return `<!--[]-->${vnode.map(_renderHydratable).join("")}<!--/[]-->`;
  }
  if (typeof vnode.tag === "function") {
    const hkId = nextHydrationId();
    const result = vnode.tag({ ...vnode.props, children: vnode.children });
    const html = _renderHydratable(result);
    return injectHydrationKey(html, hkId);
  }
  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  const open = `<${tag}${attrs}>`;
  if (VOID_ELEMENTS.has(tag)) return open;
  const rawInner = _resolveInnerHTML(props);
  const inner = rawInner != null ? String(rawInner) : children.map(_renderHydratable).join("");
  return `${open}${inner}</${tag}>`;
}
function injectHydrationKey(html, hkId) {
  const match = html.match(/^((?:<!--.*?-->)*)<([a-zA-Z][a-zA-Z0-9-]*)/);
  if (match) {
    const prefix = match[1];
    const tagName = match[2];
    const insertAt = prefix.length + 1 + tagName.length;
    return html.slice(0, insertAt) + ` data-hk="${hkId}"` + html.slice(insertAt);
  }
  return html;
}
function renderToString(vnode) {
  if (vnode == null || vnode === false || vnode === true) return "";
  if (typeof vnode === "string" || typeof vnode === "number") {
    return escapeHtml(String(vnode));
  }
  if (typeof vnode === "function" && vnode._signal) {
    return renderToString(vnode());
  }
  if (typeof vnode === "function") {
    try {
      return renderToString(vnode());
    } catch (e) {
      if (typeof process !== "undefined" && true) {
        console.warn("[what-server] Error rendering reactive function in SSR:", e.message);
      }
      return "";
    }
  }
  if (Array.isArray(vnode)) {
    return vnode.map(renderToString).join("");
  }
  if (typeof vnode.tag === "function") {
    const result = vnode.tag({ ...vnode.props, children: vnode.children });
    return renderToString(result);
  }
  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  const open = `<${tag}${attrs}>`;
  if (VOID_ELEMENTS.has(tag)) return open;
  const rawInner = _resolveInnerHTML(props);
  const inner = rawInner != null ? String(rawInner) : children.map(renderToString).join("");
  return `${open}${inner}</${tag}>`;
}
async function* renderToStream(vnode) {
  if (vnode == null || vnode === false || vnode === true) return;
  if (typeof vnode === "string" || typeof vnode === "number") {
    yield escapeHtml(String(vnode));
    return;
  }
  if (typeof vnode === "function" && vnode._signal) {
    yield* renderToStream(vnode());
    return;
  }
  if (typeof vnode === "function") {
    try {
      yield* renderToStream(vnode());
    } catch (e) {
      if (typeof process !== "undefined" && true) {
        console.warn("[what-server] Error rendering reactive function in stream SSR:", e.message);
      }
    }
    return;
  }
  if (Array.isArray(vnode)) {
    for (const child of vnode) {
      yield* renderToStream(child);
    }
    return;
  }
  if (typeof vnode.tag === "function") {
    try {
      const result = vnode.tag({ ...vnode.props, children: vnode.children });
      const resolved = result instanceof Promise ? await result : result;
      yield* renderToStream(resolved);
    } catch (e) {
      if (typeof process !== "undefined" && true) {
        console.warn("[what-server] Error rendering component in stream SSR:", e.message);
      }
      yield _isDevMode ? `<!-- SSR Error: ${escapeHtml(e.message || "Component error")} -->` : `<!-- SSR Error -->`;
    }
    return;
  }
  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  yield `<${tag}${attrs}>`;
  if (!VOID_ELEMENTS.has(tag)) {
    const rawInner = _resolveInnerHTML(props);
    if (rawInner != null) {
      yield String(rawInner);
    } else {
      for (const child of children) {
        yield* renderToStream(child);
      }
    }
    yield `</${tag}>`;
  }
}
function definePage(config) {
  return {
    // 'static' = pre-render at build time (default)
    // 'server' = render on each request
    // 'client' = render in browser (SPA)
    // 'hybrid' = static shell + islands
    mode: "static",
    ...config
  };
}
function generateStaticPage(page, data = {}) {
  const vnode = page.component(data);
  const html = renderToString(vnode);
  const islands = page.islands || [];
  return wrapDocument({
    title: page.title || "",
    meta: page.meta || {},
    body: html,
    islands,
    scripts: page.mode === "static" ? [] : page.scripts || [],
    styles: page.styles || [],
    mode: page.mode
  });
}
function wrapDocument({ title, meta, body, islands, scripts, styles, mode }) {
  const metaTags = Object.entries(meta).map(([name, content]) => `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`).join("\n    ");
  const styleTags = styles.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("\n    ");
  const islandScript = islands.length > 0 ? `
    <script type="module">
      import { hydrateIslands } from '/@what/islands.js';
      hydrateIslands();
    <\/script>` : "";
  const scriptTags = scripts.map((src) => `<script type="module" src="${escapeHtml(src)}"><\/script>`).join("\n    ");
  const clientScript = mode === "client" ? `
    <script type="module" src="/@what/client.js"><\/script>` : "";
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${metaTags}
    <title>${escapeHtml(title)}</title>
    ${styleTags}
  </head>
  <body>
    <div id="app">${body}</div>
    ${islandScript}
    ${scriptTags}
    ${clientScript}
  </body>
</html>`;
}
function server(Component) {
  Component._server = true;
  return Component;
}
var _isDevMode = typeof process !== "undefined" ? true : true;
function _resolveInnerHTML(props) {
  if (!props) return null;
  if (props.dangerouslySetInnerHTML) {
    return props.dangerouslySetInnerHTML.__html ?? null;
  }
  if (props.innerHTML && typeof props.innerHTML === "object" && "__html" in props.innerHTML) {
    return props.innerHTML.__html ?? null;
  }
  if (props.innerHTML != null && typeof props.innerHTML === "string") {
    if (_isDevMode) {
      console.warn(
        "[what-server] innerHTML received a raw string. This is a security risk (XSS). Use innerHTML={{ __html: trustedString }} or dangerouslySetInnerHTML={{ __html: trustedString }} instead."
      );
    }
    return null;
  }
  return null;
}
function renderAttrs(props) {
  let out = "";
  for (const [key, val] of Object.entries(props)) {
    if (key === "key" || key === "ref" || key === "children" || key === "dangerouslySetInnerHTML" || key === "innerHTML") continue;
    if (key.startsWith("on") && key.length > 2) continue;
    if (val === false || val == null) continue;
    if (key === "className" || key === "class") {
      out += ` class="${escapeHtml(String(val))}"`;
    } else if (key === "style" && typeof val === "object") {
      const css = Object.entries(val).map(([p, v]) => `${camelToKebab(p)}:${v}`).join(";");
      out += ` style="${escapeHtml(css)}"`;
    } else if (val === true) {
      if (key.startsWith("aria-") || key === "role") {
        out += ` ${key}="true"`;
      } else {
        out += ` ${key}`;
      }
    } else {
      out += ` ${key}="${escapeHtml(String(val))}"`;
    }
  }
  return out;
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function camelToKebab(str) {
  if (str.startsWith("--")) return str;
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}
var VOID_ELEMENTS = /* @__PURE__ */ new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
export {
  action,
  csrfMetaTag,
  definePage,
  formAction,
  generateCsrfToken,
  generateStaticPage,
  getRegisteredActions,
  handleActionRequest,
  invalidatePath,
  onRevalidate,
  renderToHydratableString,
  renderToStream,
  renderToString,
  server,
  useAction,
  useFormAction,
  useMutation,
  useOptimistic,
  validateCsrfToken
};
//# sourceMappingURL=index.js.map
