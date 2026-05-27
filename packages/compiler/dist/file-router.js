// packages/compiler/src/file-router.js
import fs from "fs";
import path from "path";
var PAGE_EXTENSIONS = /* @__PURE__ */ new Set([".jsx", ".tsx", ".js", ".ts"]);
var IGNORED_FILES = /* @__PURE__ */ new Set(["_layout", "_error", "_loading", "_404"]);
function scanPages(pagesDir) {
  const pages = [];
  const layouts = [];
  const apiRoutes = [];
  function walk(dir, urlPrefix = "") {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const groupMatch = entry.name.match(/^\((.+)\)$/);
        if (groupMatch) {
          walk(fullPath, urlPrefix);
          continue;
        }
        if (entry.name === "api" && urlPrefix === "") {
          walkApi(fullPath, "/api");
          continue;
        }
        walk(fullPath, urlPrefix + "/" + fileNameToSegment(entry.name));
        continue;
      }
      const ext = path.extname(entry.name);
      if (!PAGE_EXTENSIONS.has(ext)) continue;
      const baseName = path.basename(entry.name, ext);
      if (baseName === "_layout") {
        layouts.push({
          filePath: fullPath,
          urlPrefix: urlPrefix || "/"
        });
        continue;
      }
      if (IGNORED_FILES.has(baseName)) continue;
      const urlSegment = fileNameToSegment(baseName);
      const routePath = baseName === "index" ? urlPrefix || "/" : urlPrefix + "/" + urlSegment;
      pages.push({
        filePath: fullPath,
        routePath: normalizePath(routePath),
        isDynamic: routePath.includes(":") || routePath.includes("*")
      });
    }
  }
  function walkApi(dir, urlPrefix) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkApi(fullPath, urlPrefix + "/" + fileNameToSegment(entry.name));
        continue;
      }
      const ext = path.extname(entry.name);
      if (!PAGE_EXTENSIONS.has(ext)) continue;
      const baseName = path.basename(entry.name, ext);
      const segment = fileNameToSegment(baseName);
      const routePath = baseName === "index" ? urlPrefix : urlPrefix + "/" + segment;
      apiRoutes.push({
        filePath: fullPath,
        routePath: normalizePath(routePath)
      });
    }
  }
  walk(pagesDir);
  pages.sort((a, b) => {
    const aWeight = routeWeight(a.routePath);
    const bWeight = routeWeight(b.routePath);
    return aWeight - bWeight;
  });
  return { pages, layouts, apiRoutes };
}
function fileNameToSegment(name) {
  const catchAll = name.match(/^\[\.\.\.(\w+)\]$/);
  if (catchAll) return "*" + catchAll[1];
  const dynamic = name.match(/^\[(\w+)\]$/);
  if (dynamic) return ":" + dynamic[1];
  return name.toLowerCase();
}
function normalizePath(p) {
  let result = p.replace(/\/+/g, "/");
  if (result.length > 1 && result.endsWith("/")) {
    result = result.slice(0, -1);
  }
  return result || "/";
}
function routeWeight(path2) {
  if (path2.includes("*")) return 100;
  if (path2.includes(":")) return 10;
  return 0;
}
function extractPageConfig(source) {
  const match = source.match(
    /export\s+const\s+page\s*=\s*(\{[^}]*\})/s
  );
  if (!match) {
    return { mode: "client" };
  }
  try {
    const obj = match[1].replace(/'/g, '"').replace(/(\w+)\s*:/g, '"$1":').replace(/,\s*}/g, "}").replace(/\/\/[^\n]*/g, "");
    return { mode: "client", ...JSON.parse(obj) };
  } catch {
    return { mode: "client" };
  }
}
function generateRoutesModule(pagesDir, rootDir) {
  const { pages, layouts, apiRoutes } = scanPages(pagesDir);
  const imports = [];
  const routeEntries = [];
  const layoutMap = /* @__PURE__ */ new Map();
  layouts.forEach((layout, i) => {
    const varName = `_layout${i}`;
    const relPath = toImportPath(layout.filePath, rootDir);
    imports.push(`import ${varName} from '${relPath}';`);
    layoutMap.set(layout.urlPrefix, varName);
  });
  pages.forEach((page, i) => {
    const varName = `_page${i}`;
    const relPath = toImportPath(page.filePath, rootDir);
    imports.push(`import ${varName} from '${relPath}';`);
    let pageConfig = { mode: "client" };
    try {
      const source = fs.readFileSync(page.filePath, "utf-8");
      pageConfig = extractPageConfig(source);
    } catch {
    }
    const layoutVar = findLayout(page.routePath, layoutMap);
    const entry = {
      path: page.routePath,
      component: varName,
      mode: pageConfig.mode || "client",
      layout: layoutVar || null
    };
    routeEntries.push(entry);
  });
  const apiEntries = [];
  apiRoutes.forEach((route, i) => {
    const varName = `_api${i}`;
    const relPath = toImportPath(route.filePath, rootDir);
    imports.push(`import * as ${varName} from '${relPath}';`);
    apiEntries.push({
      path: route.routePath,
      handlers: varName
    });
  });
  const lines = [
    "// Auto-generated by What Framework file router",
    "// Do not edit \u2014 changes will be overwritten",
    "",
    ...imports,
    "",
    "export const routes = [",
    ...routeEntries.map(
      (r) => `  { path: '${r.path}', component: ${r.component}, mode: '${r.mode}'${r.layout ? `, layout: ${r.layout}` : ""} },`
    ),
    "];",
    "",
    `export const apiRoutes = [`,
    ...apiEntries.map(
      (r) => `  { path: '${r.path}', handlers: ${r.handlers} },`
    ),
    "];",
    "",
    // Export page modes for the build system
    "export const pageModes = {",
    ...routeEntries.map(
      (r) => `  '${r.path}': '${r.mode}',`
    ),
    "};"
  ];
  return lines.join("\n");
}
function toImportPath(filePath, rootDir) {
  const rel = path.relative(rootDir, filePath);
  return "/" + rel.split(path.sep).join("/");
}
function findLayout(routePath, layoutMap) {
  const segments = routePath.split("/").filter(Boolean);
  while (segments.length > 0) {
    const prefix = "/" + segments.join("/");
    if (layoutMap.has(prefix)) return layoutMap.get(prefix);
    segments.pop();
  }
  if (layoutMap.has("/")) return layoutMap.get("/");
  return null;
}
export {
  extractPageConfig,
  generateRoutesModule,
  scanPages
};
//# sourceMappingURL=file-router.js.map
