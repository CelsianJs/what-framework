// packages/server/src/index.js
import { h, runWithServerContext, beginHeadCollection, endHeadCollection } from "what-core";

// packages/server/src/serialize.js
var SCRIPT_UNSAFE = new RegExp("[<>&\\u2028\\u2029]", "g");
var ESCAPES = {
  60: "\\u003c",
  // <
  62: "\\u003e",
  // >
  38: "\\u0026",
  // &
  8232: "\\u2028",
  8233: "\\u2029"
};
function serializeState(value) {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, (c) => ESCAPES[c.charCodeAt(0)]);
}

// packages/server/src/islands.js
import { mount, hydrate, signal, batch } from "what-core";
var sharedStores = /* @__PURE__ */ new Map();
function getIslandStoresSnapshot() {
  const data = {};
  for (const [name, store] of sharedStores) {
    data[name] = store._getSnapshot();
  }
  return data;
}

// packages/server/src/actions.js
import { signal as signal2, batch as batch2 } from "what-core";

// packages/server/src/revalidation-registry.js
var _handler = null;
var isDev = typeof process !== "undefined" ? true : true;
function setRevalidationHandler(handler) {
  _handler = handler;
}
function getRevalidationHandler() {
  return _handler;
}
async function revalidatePath(path, options) {
  if (_handler && _handler.revalidatePath) return _handler.revalidatePath(path, options);
  if (isDev) {
    console.warn(
      `[what] revalidatePath('${path}') had no effect: no cache engine is bound. Create a what-isr engine and bind it in your adapter (setRevalidationHandler).`
    );
  }
}
async function revalidateTag(tag, options) {
  if (_handler && _handler.revalidateTag) return _handler.revalidateTag(tag, options);
  if (isDev) {
    console.warn(
      `[what] revalidateTag('${tag}') had no effect: no cache engine is bound.`
    );
  }
}

// packages/server/src/actions.js
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
  const isPending = signal2(false);
  const error = signal2(null);
  const data = signal2(null);
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
  const value = signal2(initialValue);
  const pending = signal2([]);
  const baseValue = signal2(initialValue);
  function addOptimistic(action2) {
    const optimisticValue = reducer(value.peek(), action2);
    batch2(() => {
      pending.set([...pending.peek(), action2]);
      value.set(optimisticValue);
    });
  }
  function resolve(action2, serverValue) {
    batch2(() => {
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
    batch2(() => {
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
  return action2.fn(...args).then(async (result) => {
    const opts = action2.options || {};
    if (Array.isArray(opts.revalidate)) {
      for (const p of opts.revalidate) await revalidatePath(p);
    }
    if (Array.isArray(opts.revalidateTags)) {
      for (const t of opts.revalidateTags) await revalidateTag(t);
    }
    return { status: 200, body: result };
  }).catch((error) => {
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
    isPending: signal2(false),
    error: signal2(null),
    data: signal2(null)
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

// packages/server/src/action-handler.js
var DEFAULT_BASE_PATH = "/__what_action";
var MAX_BODY_BYTES = 1024 * 1024;
function lowerHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === "function" && typeof headers.get === "function") {
    const out2 = {};
    headers.forEach((v, k) => {
      out2[k.toLowerCase()] = v;
    });
    return out2;
  }
  const out = {};
  for (const k in headers) out[k.toLowerCase()] = headers[k];
  return out;
}
function jsonResponse(status, bodyObj) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj)
  };
}
function htmlResponse(status, message) {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: `<!DOCTYPE html><html><body><h1>${status}</h1><p>${String(message).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p></body></html>`
  };
}
function safeLocalPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (/^[/\\]{2}/.test(value) || value.includes("\\")) return null;
  try {
    const u = new URL(value, "http://localhost");
    if (u.origin !== "http://localhost") return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}
function safeRedirectTarget(form, headers) {
  const explicit = safeLocalPath(form && form._redirect);
  if (explicit) return explicit;
  const referer = headers.referer || headers.referrer;
  if (referer) {
    try {
      const u = new URL(referer, "http://localhost");
      const path = safeLocalPath(u.pathname + u.search);
      if (path) return path;
    } catch {
    }
  }
  return "/";
}
var RESERVED_FORM_FIELDS = /* @__PURE__ */ new Set(["_action", "data-action", "_csrf", "_redirect"]);
function createActionHandler(options = {}) {
  const { getCsrfToken: getCsrfToken2, skipCsrf = false } = options;
  return async function handle(reqLike) {
    const method = (reqLike.method || "POST").toUpperCase();
    if (method !== "POST") {
      return jsonResponse(405, { message: "Method Not Allowed" });
    }
    const headers = lowerHeaders(reqLike.headers);
    const headerActionId = headers["x-what-action"];
    const contentType = headers["content-type"] || "";
    const isFormPost = !headerActionId && contentType.includes("application/x-www-form-urlencoded");
    const sessionCsrfToken = skipCsrf ? void 0 : getCsrfToken2 ? await getCsrfToken2(reqLike) : void 0;
    if (isFormPost) {
      const form = reqLike.body || {};
      const actionId = form._action || form["data-action"] || reqLike.query && reqLike.query.action;
      if (!actionId) {
        return htmlResponse(400, 'Missing action name (add a hidden "_action" field or ?action= query param)');
      }
      const formHeaders = { ...headers };
      if (form._csrf && !formHeaders["x-csrf-token"]) formHeaders["x-csrf-token"] = String(form._csrf);
      if (!skipCsrf && getCsrfToken2 && !sessionCsrfToken) {
        return htmlResponse(403, "Missing CSRF token");
      }
      const data = {};
      for (const [k, v] of Object.entries(form)) {
        if (!RESERVED_FORM_FIELDS.has(k)) data[k] = v;
      }
      const result2 = await handleActionRequest(
        { headers: formHeaders },
        actionId,
        [data],
        { csrfToken: sessionCsrfToken, skipCsrf }
      );
      if (result2.status === 200) {
        return {
          status: 303,
          headers: { location: safeRedirectTarget(form, headers) },
          body: ""
        };
      }
      return htmlResponse(result2.status, result2.body && result2.body.message || "Action failed");
    }
    if (!headerActionId) {
      return jsonResponse(400, { message: "Missing X-What-Action header" });
    }
    if (!skipCsrf && getCsrfToken2 && !sessionCsrfToken) {
      return jsonResponse(403, { message: "Missing CSRF token" });
    }
    const body = reqLike.body || {};
    const args = body.args;
    const result = await handleActionRequest(
      { headers },
      headerActionId,
      args,
      { csrfToken: sessionCsrfToken, skipCsrf }
    );
    return jsonResponse(result.status, result.body);
  };
}
function nodeActionMiddleware(options = {}) {
  const basePath = options.basePath || DEFAULT_BASE_PATH;
  const handle = createActionHandler(options);
  return async function middleware(req, res, next) {
    const [url, search] = (req.url || "").split("?");
    if (url !== basePath || (req.method || "").toUpperCase() !== "POST") {
      return next ? next() : void 0;
    }
    let body;
    try {
      const raw = await readRawBody(req);
      body = parseActionBody(raw, req.headers["content-type"] || "");
    } catch (err) {
      res.writeHead(err.code === "BODY_TOO_LARGE" ? 413 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: err.code === "BODY_TOO_LARGE" ? "Payload too large" : "Invalid request body" }));
      return;
    }
    const query = Object.fromEntries(new URLSearchParams(search || ""));
    const out = await handle({ method: req.method, headers: req.headers, body, query });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  };
}
function parseActionBody(raw, contentType) {
  if ((contentType || "").includes("application/x-www-form-urlencoded")) {
    const fields = {};
    for (const [k, v] of new URLSearchParams(String(raw))) {
      if (fields[k] === void 0) fields[k] = v;
      else if (Array.isArray(fields[k])) fields[k].push(v);
      else fields[k] = [fields[k], v];
    }
    return fields;
  }
  if (raw == null || raw === "") return {};
  return JSON.parse(String(raw));
}
async function readFetchBodyCapped(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    return { tooLarge: true };
  }
  const body = request.body;
  if (!body || typeof body.getReader !== "function") {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > limit) return { tooLarge: true };
    return { raw };
  }
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      size += value.byteLength;
      if (size > limit) {
        try {
          await reader.cancel();
        } catch {
        }
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  }
  return { raw: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const e = new Error("Body too large");
        e.code = "BODY_TOO_LARGE";
        reject(e);
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve("");
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}
function fetchActionHandler(options = {}) {
  const handle = createActionHandler(options);
  return async function(request) {
    let body = {};
    try {
      const read = await readFetchBodyCapped(request);
      if (read.tooLarge) {
        return new Response(JSON.stringify({ message: "Payload too large" }), {
          status: 413,
          headers: { "content-type": "application/json" }
        });
      }
      body = parseActionBody(read.raw, request.headers.get("content-type") || "");
    } catch {
      body = {};
    }
    let query = {};
    try {
      query = Object.fromEntries(new URL(request.url, "http://localhost").searchParams);
    } catch {
    }
    const out = await handle({ method: request.method, headers: request.headers, body, query });
    return new Response(out.body, { status: out.status, headers: out.headers });
  };
}

// packages/server/src/adapter/core.js
import { matchRoute, parseQuery } from "what-router/match";
var ACTION_PATH = "/__what_action";
var REVALIDATE_PATH = "/__what_revalidate";
var CSRF_COOKIE = "what-csrf";
function headersToObject(headers) {
  const out = {};
  if (headers && typeof headers.forEach === "function") headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}
function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = String(cookieHeader).match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
async function readActionBody(request) {
  try {
    const read = await readFetchBodyCapped(request);
    if (read.tooLarge) return { tooLarge: true };
    return parseActionBody(read.raw, request.headers.get("content-type") || "");
  } catch {
    return {};
  }
}
async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
function defaultRenderRoute(documentOptions) {
  return async function renderRoute(routeMatch) {
    const { route, params, query, request } = routeMatch;
    const pageModule = { default: route.component, loader: route.loader };
    const opts = routeMatch.csrfToken ? { ...documentOptions, csrfToken: routeMatch.csrfToken } : documentOptions;
    const html = await renderDocument(pageModule, { params, query, request }, opts);
    return {
      html,
      status: 200,
      tags: routeMatch.config && routeMatch.config.tags || [],
      path: routeMatch.path
    };
  };
}
function createRequestHandler(options = {}) {
  const {
    routes = [],
    cache,
    render,
    revalidateWebhook,
    document: documentOptions = {},
    notFound,
    basePath = "",
    csrf = true
  } = options;
  const autoCsrf = csrf !== false && !options.actionHandler;
  const actionHandler = options.actionHandler || createActionHandler(
    autoCsrf ? { getCsrfToken: (reqLike) => readCookie(reqLike.headers && reqLike.headers.cookie, CSRF_COOKIE) } : { skipCsrf: true }
  );
  const renderRoute = render || defaultRenderRoute(documentOptions);
  if (cache && (cache.revalidatePath || cache.revalidateTag)) {
    setRevalidationHandler({
      revalidatePath: cache.revalidatePath,
      revalidateTag: cache.revalidateTag
    });
  }
  return async function handle(request) {
    const url = new URL(request.url, "http://localhost");
    let pathname = url.pathname;
    if (basePath && pathname.startsWith(basePath)) pathname = pathname.slice(basePath.length) || "/";
    if (request.method === "POST" && pathname === ACTION_PATH) {
      const body = await readActionBody(request);
      if (body && body.tooLarge) {
        return new Response(JSON.stringify({ message: "Payload too large" }), {
          status: 413,
          headers: { "content-type": "application/json" }
        });
      }
      const out2 = await actionHandler({
        method: "POST",
        headers: headersToObject(request.headers),
        body,
        query: Object.fromEntries(url.searchParams)
      });
      return new Response(out2.body, { status: out2.status, headers: out2.headers });
    }
    let csrfToken = null;
    let csrfSetCookie = null;
    if (autoCsrf) {
      csrfToken = readCookie(headersToObject(request.headers).cookie, CSRF_COOKIE);
      if (!csrfToken) {
        csrfToken = generateCsrfToken();
        const reqHeaders = headersToObject(request.headers);
        const isHttps = reqHeaders["x-forwarded-proto"] === "https" || url.protocol === "https:" || false;
        csrfSetCookie = `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax` + (isHttps ? "; Secure" : "");
      }
    }
    const withCsrfCookie = (headers2) => {
      if (csrfSetCookie) headers2["set-cookie"] = csrfSetCookie;
      return headers2;
    };
    if (request.method === "POST" && pathname === REVALIDATE_PATH && revalidateWebhook) {
      const body = await readJsonBody(request);
      const out2 = await revalidateWebhook({ headers: headersToObject(request.headers), body });
      return new Response(JSON.stringify(out2.body), {
        status: out2.status,
        headers: { "content-type": "application/json" }
      });
    }
    const matched = matchRoute(pathname, routes);
    if (!matched) {
      const html = notFound ? notFound() : "<!DOCTYPE html><html><body><h1>404 \u2014 Not Found</h1></body></html>";
      return new Response(html, { status: 404, headers: withCsrfCookie({ "content-type": "text/html; charset=utf-8" }) });
    }
    const { route, params } = matched;
    const config = route.page || { mode: route.mode || "client" };
    const routeMatch = { path: pathname, query: parseQuery(url.search), config, route, params, request };
    if (cache && config.mode !== "server") {
      const result = await cache.handle(routeMatch, () => renderRoute(routeMatch));
      return new Response(result.html, {
        status: result.status || 200,
        headers: withCsrfCookie({ "content-type": "text/html; charset=utf-8", ...result.headers || {} })
      });
    }
    if (csrfToken) routeMatch.csrfToken = csrfToken;
    const out = await renderRoute(routeMatch);
    const headers = withCsrfCookie({ "content-type": "text/html; charset=utf-8" });
    if (config.mode === "server") headers["Cache-Control"] = "private, no-store";
    return new Response(out.html, { status: out.status || 200, headers });
  };
}

// packages/server/src/adapter/node.js
import http from "node:http";
async function nodeToWebRequest(req) {
  const host = req.headers.host || "localhost";
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length) body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body });
}
async function sendWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await webRes.text();
  res.end(text);
}
function toNodeListener(handler) {
  return async function listener(req, res) {
    try {
      const webReq = await nodeToWebRequest(req);
      const webRes = await handler(webReq);
      await sendWebResponse(res, webRes);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body><h1>500 \u2014 Server Error</h1></body></html>");
      console.error("[what-server] request error:", err);
    }
  };
}
function whatMiddleware(options = {}) {
  const handler = createRequestHandler(options);
  return async function middleware(req, res, next) {
    const webReq = await nodeToWebRequest(req);
    const webRes = await handler(webReq);
    if (webRes.status === 404 && typeof next === "function") return next();
    await sendWebResponse(res, webRes);
  };
}
function createServer(options = {}) {
  const handler = createRequestHandler(options);
  const server2 = http.createServer(toNodeListener(handler));
  const { scheduler } = options;
  if (scheduler) {
    scheduler.start();
    const stop = () => {
      try {
        scheduler.stop();
      } catch {
      }
      server2.close();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }
  return server2;
}

// packages/server/src/adapter/static.js
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { matchRoute as matchRoute2 } from "what-router/match";
function isDynamic(path) {
  return path.includes(":") || path.includes("*") || path.includes("[");
}
function buildConcretePath(pattern, params) {
  return pattern.replace(/\[\.\.\.(\w+)\]/g, (_, n) => params[n] ?? "").replace(/\[(\w+)\]/g, (_, n) => params[n] ?? "").replace(/[:*](\w+)/g, (_, n) => params[n] ?? "");
}
async function exportStatic({ routes = [], outDir, render, documentOptions = {} } = {}) {
  const written = [];
  for (const route of routes) {
    const mode = route.page && route.page.mode || route.mode;
    if (mode !== "static" && mode !== "hybrid") continue;
    const pageModule = { default: route.component, loader: route.loader };
    let concrete = [route.path];
    if (isDynamic(route.path)) {
      if (typeof route.getStaticPaths !== "function") continue;
      const result = await route.getStaticPaths();
      concrete = (result.paths || []).map((p) => buildConcretePath(route.path, p.params || {}));
    }
    for (const urlPath of concrete) {
      const matched = matchRoute2(urlPath, [route]);
      const params = matched ? matched.params : {};
      const reqCtx = { params, query: {} };
      const html = render ? await render(pageModule, reqCtx) : await renderDocument(pageModule, reqCtx, documentOptions);
      const dirPath = join(outDir, urlPath === "/" ? "" : urlPath);
      await mkdir(dirPath, { recursive: true });
      await writeFile(join(dirPath, "index.html"), html);
      if (typeof route.loader === "function") {
        const data = await route.loader(reqCtx);
        await writeFile(join(dirPath, "__what_data.json"), serializeState({ loaderData: data }));
      }
      written.push(urlPath);
    }
  }
  return { pages: written };
}

// packages/server/src/adapter/cloudflare.js
function createCloudflareHandler(options = {}) {
  const handle = createRequestHandler(options);
  return {
    async fetch(request, env, ctx) {
      if (env) request.__env = env;
      if (ctx) request.__ctx = ctx;
      return handle(request);
    }
  };
}

// packages/server/src/adapter/vercel.js
function createVercelHandler(options = {}) {
  return createRequestHandler(options);
}
async function buildVercelOutput({
  outDir = ".vercel/output",
  functionName = "render",
  runtime = "nodejs22.x",
  files = null,
  handler = "index.mjs",
  staticDir = null
} = {}) {
  const { mkdir: mkdir2, writeFile: writeFile2, cp } = await import("node:fs/promises");
  const { join: join2, dirname } = await import("node:path");
  await mkdir2(outDir, { recursive: true });
  const config = {
    version: 3,
    routes: [
      // CDN-served static assets win before the render function runs.
      { handle: "filesystem" },
      { src: "/.*", dest: `/${functionName}` }
    ]
  };
  await writeFile2(join2(outDir, "config.json"), JSON.stringify(config, null, 2));
  if (staticDir) {
    await cp(staticDir, join2(outDir, "static"), { recursive: true });
  }
  let functionDir = null;
  if (files && typeof files === "object") {
    functionDir = join2(outDir, "functions", `${functionName}.func`);
    await mkdir2(functionDir, { recursive: true });
    const vcConfig = {
      runtime,
      handler,
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true
    };
    await writeFile2(join2(functionDir, ".vc-config.json"), JSON.stringify(vcConfig, null, 2));
    for (const [rel, contents] of Object.entries(files)) {
      const dest = join2(functionDir, rel);
      await mkdir2(dirname(dest), { recursive: true });
      await writeFile2(dest, contents);
    }
    if (!(handler in files)) {
      console.warn(`[what-server] buildVercelOutput: files does not include the handler entry "${handler}" \u2014 the deploy will 500 until your build emits it.`);
    }
  }
  return { config, outDir, functionDir };
}

// packages/server/src/index.js
function createRenderContext(loaderData) {
  return {
    head: beginHeadCollection(),
    loaderData,
    resources: /* @__PURE__ */ new Map(),
    resourceCounter: 0,
    boundaryCounter: 0,
    suspended: []
  };
}
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
  if (vnode.tag === "__suspense") {
    try {
      return (vnode.children || []).map(renderToString).join("");
    } catch (e) {
      if (e && typeof e.then === "function") {
        return renderToString(vnode.props && vnode.props.fallback);
      }
      throw e;
    }
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
function renderToStringWithHead(vnode) {
  const ctx = createRenderContext(void 0);
  const body = runWithServerContext(ctx, () => renderToString(vnode));
  return { body, head: endHeadCollection(ctx.head) };
}
async function renderPage(pageModule, reqCtx = {}) {
  const Component = pageModule.default || pageModule;
  const loaderData = typeof pageModule.loader === "function" ? await pageModule.loader(reqCtx) : void 0;
  const ctx = createRenderContext(loaderData);
  const params = reqCtx.params || {};
  const body = runWithServerContext(
    ctx,
    () => renderToString(h(Component, { ...params, loaderData }))
  );
  return { body, head: endHeadCollection(ctx.head), loaderData };
}
var MAX_RESOLVE_PASSES = 12;
async function renderToStringAsync(vnode, ctx) {
  if (!ctx) ctx = createRenderContext(void 0);
  let body = "";
  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
    body = runWithServerContext(ctx, () => renderToString(vnode));
    const pending = [...ctx.resources.values()].filter((r) => r.status === "pending").map((r) => r.promise);
    if (pending.length === 0) break;
    await Promise.all(pending);
  }
  const resources = {};
  for (const [k, v] of ctx.resources) if (v.status === "ready") resources[k] = v.value;
  return { body, head: endHeadCollection(ctx.head), loaderData: ctx.loaderData, resources, ctx };
}
async function renderDocument(pageModule, reqCtx = {}, options = {}) {
  const Component = pageModule.default || pageModule;
  const loaderData = typeof pageModule.loader === "function" ? await pageModule.loader(reqCtx) : void 0;
  const ctx = createRenderContext(loaderData);
  const params = reqCtx.params || {};
  const { body, head, resources } = await renderToStringAsync(
    h(Component, { ...params, loaderData }),
    ctx
  );
  const payload = {
    loaderData: loaderData ?? null,
    resources,
    islandStores: getIslandStoresSnapshot()
  };
  return wrapHtmlDocument({ body, head, payload, options });
}
function wrapHtmlDocument({ body, head, payload, options = {} }) {
  const lang = options.lang || "en";
  const dataScript = `<script id="__what_data" type="application/json">${serializeState(payload)}<\/script>`;
  const clientScript = options.clientEntry ? `<script type="module" src="${escapeHtml(options.clientEntry)}"><\/script>` : "";
  const csrfHead = options.csrfToken ? csrfMetaTag(options.csrfToken) : "";
  const extraHead = csrfHead + (options.head || "");
  const bodyClass = options.bodyClass ? ` class="${escapeHtml(options.bodyClass)}"` : "";
  return `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head || ""}${extraHead}</head><body${bodyClass}>${body}${dataScript}${clientScript}</body></html>`;
}
async function* renderToStream(vnode, ctx) {
  if (ctx === void 0) ctx = createRenderContext(void 0);
  if (vnode == null || vnode === false || vnode === true) return;
  if (typeof vnode === "string" || typeof vnode === "number") {
    yield escapeHtml(String(vnode));
    return;
  }
  if (typeof vnode === "function" && vnode._signal) {
    yield* renderToStream(vnode(), ctx);
    return;
  }
  if (typeof vnode === "function") {
    try {
      yield* renderToStream(vnode(), ctx);
    } catch (e) {
      if (typeof process !== "undefined" && true) {
        console.warn("[what-server] Error rendering reactive function in stream SSR:", e.message);
      }
    }
    return;
  }
  if (Array.isArray(vnode)) {
    for (const child of vnode) {
      yield* renderToStream(child, ctx);
    }
    return;
  }
  if (vnode.tag === "__suspense") {
    let html = null;
    for (let attempt = 0; attempt < MAX_RESOLVE_PASSES && html === null; attempt++) {
      let suspended = null;
      try {
        html = runWithServerContext(ctx, () => (vnode.children || []).map(renderToString).join(""));
      } catch (e) {
        if (e && typeof e.then === "function") suspended = e;
        else throw e;
      }
      if (html === null) {
        const pending = [...ctx.resources.values()].filter((r) => r.status === "pending").map((r) => r.promise);
        await Promise.all([suspended, ...pending].filter(Boolean));
      }
    }
    if (html === null) {
      html = runWithServerContext(ctx, () => renderToString(vnode.props && vnode.props.fallback));
    }
    yield html;
    return;
  }
  if (typeof vnode.tag === "function") {
    try {
      const result = vnode.tag({ ...vnode.props, children: vnode.children });
      const resolved = result instanceof Promise ? await result : result;
      yield* renderToStream(resolved, ctx);
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
        yield* renderToStream(child, ctx);
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
var SAFE_ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9:._-]*$/;
function renderAttrs(props) {
  let out = "";
  for (const [key, val] of Object.entries(props)) {
    if (key === "key" || key === "ref" || key === "children" || key === "dangerouslySetInnerHTML" || key === "innerHTML") continue;
    if (key.startsWith("on") && key.length > 2) continue;
    if (val === false || val == null) continue;
    if (!SAFE_ATTR_NAME.test(key)) {
      if (_isDevMode) {
        console.warn(`[what-server] Skipping invalid attribute name in SSR: ${JSON.stringify(key)}`);
      }
      continue;
    }
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
      if (isUnsafeUrlAttribute(key, val)) continue;
      out += ` ${key}="${escapeHtml(String(val))}"`;
    }
  }
  return out;
}
function isUnsafeUrlAttribute(key, val) {
  const normalizedKey = key.toLowerCase();
  if (!URL_ATTRS.has(normalizedKey)) return false;
  const normalizedValue = String(val).trim().replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase();
  return normalizedValue.startsWith("javascript:") || normalizedValue.startsWith("vbscript:") || normalizedValue.startsWith("data:");
}
var URL_ATTRS = /* @__PURE__ */ new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href"
]);
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
  buildVercelOutput,
  createActionHandler,
  createCloudflareHandler,
  createRequestHandler,
  createServer,
  createVercelHandler,
  csrfMetaTag,
  definePage,
  exportStatic,
  fetchActionHandler,
  formAction,
  generateCsrfToken,
  generateStaticPage,
  getRegisteredActions,
  getRevalidationHandler,
  handleActionRequest,
  invalidatePath,
  nodeActionMiddleware,
  onRevalidate,
  renderDocument,
  renderPage,
  renderToHydratableString,
  renderToStream,
  renderToString,
  renderToStringAsync,
  renderToStringWithHead,
  revalidatePath,
  revalidateTag,
  serializeState,
  server,
  setRevalidationHandler,
  toNodeListener,
  useAction,
  useFormAction,
  useMutation,
  useOptimistic,
  validateCsrfToken,
  whatMiddleware
};
//# sourceMappingURL=index.js.map
