// packages/router/src/index.js
import { signal, effect, computed, batch, h, ErrorBoundary } from "what-core";
function isSafeUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  const normalized = trimmed.replace(/[\s\x00-\x1f]/g, "").toLowerCase();
  if (normalized.startsWith("javascript:")) return false;
  if (normalized.startsWith("data:")) return false;
  if (normalized.startsWith("vbscript:")) return false;
  return true;
}
var _url = signal(typeof location !== "undefined" ? location.pathname + location.search + location.hash : "/");
var _params = signal({});
var _query = signal({});
var _isNavigating = signal(false);
var _navigationError = signal(null);
var route = {
  get url() {
    return _url();
  },
  get path() {
    return _url().split("?")[0].split("#")[0];
  },
  get params() {
    return _params();
  },
  get query() {
    return _query();
  },
  get hash() {
    const h2 = _url().split("#")[1];
    return h2 ? "#" + h2 : "";
  },
  get isNavigating() {
    return _isNavigating();
  },
  get error() {
    return _navigationError();
  }
};
async function navigate(to, opts = {}) {
  const { replace = false, state = null, transition = true, _fromPopstate = false } = opts;
  if (!isSafeUrl(to)) {
    if (typeof console !== "undefined") {
      console.warn(`[what-router] Blocked navigation to unsafe URL: ${to}`);
    }
    return;
  }
  if (typeof window !== "undefined" && to.startsWith("#")) {
    const currentUrl = _url();
    const basePath = currentUrl.split("#")[0];
    const newUrl = basePath + to;
    history.replaceState(state, "", newUrl);
    _url.set(newUrl);
    const el = document.querySelector(to);
    if (el) el.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (to === _url()) return;
  if (_isNavigating.peek()) return;
  _isNavigating.set(true);
  _navigationError.set(null);
  const doNavigation = () => {
    if (!_fromPopstate) {
      if (typeof window !== "undefined") {
        scrollPositions.set(_url(), { x: scrollX, y: scrollY });
      }
      if (replace) {
        history.replaceState(state, "", to);
      } else {
        history.pushState(state, "", to);
      }
    }
    _url.set(to);
    _isNavigating.set(false);
  };
  if (transition && typeof document !== "undefined" && document.startViewTransition) {
    try {
      await document.startViewTransition(doNavigation).finished;
    } catch (e) {
    }
  } else {
    doNavigation();
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    scrollPositions.set(_url(), { x: scrollX, y: scrollY });
    const newUrl = location.pathname + location.search + location.hash;
    navigate(newUrl, { replace: true, _fromPopstate: true, transition: false }).then(() => {
      const saved = scrollPositions.get(newUrl);
      if (saved) {
        requestAnimationFrame(() => window.scrollTo(saved.x, saved.y));
      }
    });
  });
}
function compilePath(path) {
  const normalized = path.replace(/\([\w-]+\)\//g, "").replace(/\[\.\.\.(\w+)\]/g, (_, name) => `*:${name}`).replace(/\[(\w+)\]/g, ":$1");
  const paramNames = [];
  let catchAll = null;
  const regexStr = normalized.split("/").map((segment) => {
    if (segment.startsWith("*:")) {
      catchAll = segment.slice(2);
      paramNames.push(catchAll);
      return "(.+)";
    }
    if (segment === "*") {
      catchAll = "rest";
      paramNames.push("rest");
      return "(.+)";
    }
    if (segment.startsWith(":")) {
      paramNames.push(segment.slice(1));
      return "([^/]+)";
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  const regex = new RegExp(`^${regexStr}$`);
  return { regex, paramNames, catchAll };
}
function matchRoute(path, routes) {
  const routable = routes.filter((r) => r.path);
  const sorted = routable.sort((a, b) => {
    const aSpecific = (a.path.match(/:/g) || []).length + (a.path.includes("*") ? 100 : 0);
    const bSpecific = (b.path.match(/:/g) || []).length + (b.path.includes("*") ? 100 : 0);
    return aSpecific - bSpecific;
  });
  for (const route2 of sorted) {
    const { regex, paramNames } = compilePath(route2.path);
    const match = path.match(regex);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { route: route2, params };
    }
  }
  return null;
}
function parseQuery(search) {
  const params = {};
  if (!search) return params;
  const qs = search.startsWith("?") ? search.slice(1) : search;
  for (const pair of qs.split("&")) {
    const [key, val] = pair.split("=");
    if (!key) continue;
    const decodedKey = decodeURIComponent(key);
    const decodedVal = val ? decodeURIComponent(val) : "";
    if (decodedKey in params) {
      if (Array.isArray(params[decodedKey])) {
        params[decodedKey].push(decodedVal);
      } else {
        params[decodedKey] = [params[decodedKey], decodedVal];
      }
    } else {
      params[decodedKey] = decodedVal;
    }
  }
  return params;
}
function buildLayoutChain(route2, routes) {
  const layouts = [];
  if (!route2.path) return layouts;
  const segments = route2.path.split("/").filter(Boolean);
  let currentPath = "";
  for (const segment of segments) {
    currentPath += "/" + segment;
    const layoutRoute = routes.find(
      (r) => r.layout && r.path === currentPath + "/_layout"
    );
    if (layoutRoute) {
      layouts.push(layoutRoute.layout);
    }
  }
  if (route2.layout) {
    layouts.push(route2.layout);
  }
  return layouts;
}
var _redirectHistory = [];
var MAX_REDIRECTS = 10;
function Router({ routes, fallback, globalLayout }) {
  return () => {
    const currentUrl = _url();
    const path = currentUrl.split("?")[0].split("#")[0];
    const search = currentUrl.split("?")[1]?.split("#")[0] || "";
    const isNavigating = _isNavigating();
    const matched = matchRoute(path, routes);
    if (matched) {
      batch(() => {
        _params.set(matched.params);
        _query.set(parseQuery(search));
      });
      const { route: r, params } = matched;
      const queryObj = parseQuery(search);
      if (r.middleware && r.middleware.length > 0) {
        for (const mw of r.middleware) {
          const result = mw({ path, params, query: queryObj, route: r });
          if (result === false) {
            if (fallback) return h(fallback, {});
            return h("div", { class: "what-403" }, h("h1", null, "403"), h("p", null, "Access denied"));
          }
          if (typeof result === "string") {
            _redirectHistory.push(result);
            if (_redirectHistory.length > MAX_REDIRECTS) {
              const cycle = _redirectHistory.slice(-5).join(" \u2192 ");
              _redirectHistory.length = 0;
              console.error(`[what-router] Redirect loop detected: ${cycle}`);
              _isNavigating.set(false);
              return h(
                "div",
                { class: "what-redirect-loop" },
                h("h1", null, "Redirect Loop"),
                h("p", null, "Too many redirects. Check your middleware configuration.")
              );
            }
            const seen = /* @__PURE__ */ new Set();
            let hasCycle = false;
            for (const url of _redirectHistory) {
              if (seen.has(url)) {
                hasCycle = true;
                break;
              }
              seen.add(url);
            }
            if (hasCycle) {
              const cycle = _redirectHistory.join(" \u2192 ");
              _redirectHistory.length = 0;
              console.error(`[what-router] Redirect cycle detected: ${cycle}`);
              _isNavigating.set(false);
              return h(
                "div",
                { class: "what-redirect-loop" },
                h("h1", null, "Redirect Loop"),
                h("p", null, "Circular redirect detected. Check your middleware configuration.")
              );
            }
            navigate(result, { replace: true });
            return null;
          }
        }
      }
      _redirectHistory.length = 0;
      let element;
      if (r.loading && isNavigating) {
        element = h(r.loading, {});
      } else {
        element = h(r.component, {
          params,
          query: queryObj,
          route: r
        });
      }
      if (r.error) {
        element = h(ErrorBoundary, { fallback: r.error }, element);
      }
      const layouts = buildLayoutChain(r, routes);
      for (const Layout of layouts.reverse()) {
        element = h(Layout, { params, query: queryObj }, element);
      }
      if (globalLayout) {
        element = h(globalLayout, {}, element);
      }
      return element;
    }
    if (fallback) return h(fallback, {});
    return h(
      "div",
      { class: "what-404" },
      h("h1", null, "404"),
      h("p", null, "Page not found")
    );
  };
}
function Link({
  href,
  class: cls,
  className,
  children,
  replace: rep,
  prefetch: shouldPrefetch = true,
  activeClass = "active",
  exactActiveClass = "exact-active",
  transition = true,
  ...rest
}) {
  const safeHref = isSafeUrl(href) ? href : "about:blank";
  if (!isSafeUrl(href) && typeof console !== "undefined") {
    console.warn(`[what-router] Link blocked unsafe href: ${href}`);
  }
  const hrefPath = safeHref.split("?")[0].split("#")[0];
  const reactiveClass = () => {
    const currentPath = route.path;
    const isActive = hrefPath === "/" ? currentPath === "/" : currentPath === hrefPath || currentPath.startsWith(hrefPath + "/");
    const isExactActive = currentPath === hrefPath;
    return [
      cls || className,
      isActive && activeClass,
      isExactActive && exactActiveClass
    ].filter(Boolean).join(" ") || void 0;
  };
  return h("a", {
    href: safeHref,
    class: reactiveClass,
    onclick: (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(safeHref, { replace: rep, transition });
    },
    onmouseenter: shouldPrefetch ? () => prefetch(safeHref) : void 0,
    ...rest
  }, ...Array.isArray(children) ? children : [children]);
}
function NavLink(props) {
  return Link(props);
}
function defineRoutes(config) {
  return Object.entries(config).map(([path, value]) => {
    if (typeof value === "function") {
      return { path, component: value };
    }
    return { path, ...value };
  });
}
function nestedRoutes(basePath, children, options = {}) {
  const { layout, loading, error } = options;
  return children.map((child) => ({
    ...child,
    path: basePath + child.path,
    layout: child.layout || layout,
    loading: child.loading || loading,
    error: child.error || error
  }));
}
function routeGroup(name, routes, options = {}) {
  const { layout, middleware } = options;
  return routes.map((route2) => ({
    ...route2,
    _group: name,
    layout: route2.layout || layout,
    middleware: [...route2.middleware || [], ...middleware || []]
  }));
}
function Redirect({ to }) {
  navigate(to, { replace: true });
  return null;
}
function guard(check, fallback) {
  return (Component) => {
    return function GuardedRoute(props) {
      const result = check(props);
      if (result instanceof Promise) {
        return h("div", { class: "what-guard-loading" }, "Loading...");
      }
      if (result) {
        return h(Component, props);
      }
      if (typeof fallback === "string") {
        navigate(fallback, { replace: true });
        return null;
      }
      return h(fallback, props);
    };
  };
}
function asyncGuard(check, options = {}) {
  const { fallback = "/login", loading = null } = options;
  return (Component) => {
    return function AsyncGuardedRoute(props) {
      const status = signal("pending");
      const checkResult = signal(null);
      let cancelled = false;
      effect(() => {
        cancelled = false;
        Promise.resolve(check(props)).then((result) => {
          if (cancelled) return;
          checkResult.set(result);
          status.set(result ? "allowed" : "denied");
        }).catch(() => {
          if (!cancelled) status.set("denied");
        });
        return () => {
          cancelled = true;
        };
      });
      return () => {
        const currentStatus = status();
        if (currentStatus === "pending") {
          return loading ? h(loading, {}) : null;
        }
        if (currentStatus === "allowed") {
          return h(Component, props);
        }
        if (typeof fallback === "string") {
          navigate(fallback, { replace: true });
          return null;
        }
        return h(fallback, props);
      };
    };
  };
}
var prefetchedUrls = /* @__PURE__ */ new Set();
function prefetch(href) {
  if (typeof document === "undefined") return;
  if (prefetchedUrls.has(href)) return;
  prefetchedUrls.add(href);
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = href;
  document.head.appendChild(link);
}
var scrollPositions = /* @__PURE__ */ new Map();
function enableScrollRestoration() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", () => {
    scrollPositions.set(location.pathname, window.scrollY);
  });
  effect(() => {
    const path = route.path;
    const savedPosition = scrollPositions.get(path);
    requestAnimationFrame(() => {
      if (savedPosition !== void 0) {
        window.scrollTo(0, savedPosition);
      } else if (route.hash) {
        const el = document.querySelector(route.hash);
        el?.scrollIntoView();
      } else {
        window.scrollTo(0, 0);
      }
    });
  });
}
function viewTransitionName(name) {
  return { style: { viewTransitionName: name } };
}
function setViewTransition(type) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.transition = type;
}
function useRoute() {
  return {
    path: computed(() => route.path),
    params: computed(() => route.params),
    query: computed(() => route.query),
    hash: computed(() => route.hash),
    isNavigating: computed(() => route.isNavigating),
    navigate,
    prefetch
  };
}
function Outlet({ children }) {
  return children || null;
}
function FileRouter({
  routes,
  layout: globalLayout,
  fallback,
  error: globalError
}) {
  const routerRoutes = routes.map((r) => ({
    path: r.path,
    component: r.component,
    layout: r.layout || void 0,
    // Attach page mode as metadata for build system
    _mode: r.mode || "client"
  }));
  return Router({
    routes: routerRoutes,
    globalLayout,
    fallback: fallback || Default404
  });
}
function Default404() {
  return h(
    "div",
    { style: "text-align:center;padding:60px 20px" },
    h("h1", { style: "font-size:48px;margin-bottom:8px" }, "404"),
    h("p", { style: "color:#64748b" }, "Page not found")
  );
}
export {
  FileRouter,
  Link,
  NavLink,
  Outlet,
  Redirect,
  Router,
  asyncGuard,
  defineRoutes,
  enableScrollRestoration,
  guard,
  isSafeUrl,
  navigate,
  nestedRoutes,
  prefetch,
  route,
  routeGroup,
  setViewTransition,
  useRoute,
  viewTransitionName
};
//# sourceMappingURL=index.js.map
