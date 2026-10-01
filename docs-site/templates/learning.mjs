const PRIVATE = /(?:\/(?:Users|home|private|tmp)\/|\bENG-\d+\b|\bBearer\s+[\w.-]{12,}|\b(?:npm_|cfut_|sk-)[\w-]{16,}|\beyJ[\w-]{30,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|<\/?(?:system|instructions|analysis)>|system prompt|developer prompt|you are an autonomous|raw agent logs?)/i;
const SOURCE_PATH = /^(?:src|scripts|tests?|BUILD\.md|README\.md|DESIGN\.md)(?:\/[A-Za-z0-9._-]+)*$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Starter learning: ${message}`);
}

function publicText(value, path, max = 1400) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${path} must be nonempty public text`);
  requireValue([...value].every(character => character.charCodeAt(0) > 31 || character === '\n'), `${path} must not contain control characters`);
  requireValue(!PRIVATE.test(value), `${path} contains private, credential-like or instruction content`);
  requireValue(!/https?:\/\//i.test(value), `${path}: URLs belong in verified source or release records`);
}

function sourcePath(value, path) {
  publicText(value, path, 160);
  requireValue(SOURCE_PATH.test(value), `${path} must be a repository-relative source path`);
}

function fields(value, allowed, path) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${path} must be an object`);
  for (const key of Object.keys(value)) requireValue(allowed.includes(key), `${path}.${key} is not supported`);
}

export const STARTER_LEARNING = Object.freeze({
  'what-starter-tempo': {
    overview: 'Tempo is a hybrid time-tracking SaaS reference: the browser owns workspace state and two serverless endpoints validate entries and summarize reports.',
    sourceFiles: [
      { label: 'Reactive workspace store', path: 'src/state.js', note: 'Signals hold editable state, computed values derive summaries, and navigation is a tiny path signal.' },
      { label: 'Bounded request parser', path: 'src/api/bounded-json.js', note: 'The function endpoint enforces byte limits while streaming the body as Uint8Array chunks.' },
      { label: 'Entry validation function', path: 'src/api/entry.js', note: 'The API validates project membership, note length, minutes and date shape before returning JSON.' },
    ],
    smooth: [
      'The local app and serverless validation share the same domain helpers, so UI and API constraints stayed aligned.',
      'The HMR disposal path made timer, effect and popstate cleanup explicit during development.',
    ],
    examples: [
      {
        title: 'Keep source state small, derive the clock math',
        path: 'src/state.js',
        language: 'js',
        code: "export const workspace = signal(loadWorkspace());\nexport const now = signal(Date.now());\n\nconst interval = setInterval(() => now(Date.now()), 15000);\n\nexport const summary = computed(() => summarizeWorkspace(workspace(), now()));",
        notes: 'The mutable state is the workspace and current time tick. Totals stay derived, so adding or stopping an entry updates every display that reads summary().',
      },
      {
        title: 'Bound function input by bytes, not text length',
        path: 'src/api/bounded-json.js',
        language: 'js',
        code: "const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);\ntotalBytes += chunk.byteLength;\nif (totalBytes > maxBytes) {\n  await reader.cancel().catch(() => {});\n  throw new JsonBodyError('Request body is too large.', 413);\n}",
        notes: 'This avoids UTF-16 string-length mistakes and cancels the request stream as soon as the payload exceeds the endpoint budget.',
      },
    ],
    issues: [
      {
        title: 'Large JSON bodies need stream-level limits',
        problem: 'A report endpoint can receive user-controlled JSON. Counting decoded text would miss the actual byte budget and keep reading after the limit.',
        fix: 'Both Tempo and Lens use a Uint8Array accumulator, cancel the reader on overflow and decode with fatal UTF-8 handling.',
        proof: 'The API parser returns 413 before parsing an oversized body and reports malformed JSON as a 400 response.',
        takeaway: 'Serverless demos should show request boundaries even when the data is synthetic.',
      },
    ],
    boundaries: [
      'Workspace data is browser-local seed data, not a multi-user database.',
      'Serverless functions validate and summarize posted data; they do not persist account records.',
    ],
  },
  'what-starter-launchpad': {
    overview: 'Launchpad is a static startup marketing site with small What islands for pricing and product-tour interaction.',
    sourceFiles: [
      { label: 'Server renderer', path: 'src/server/render.mjs', note: 'Static pages render through h() and renderToString() so the Node build never imports compiled browser JSX.' },
      { label: 'Client islands', path: 'src/client/main.jsx', note: 'The pricing calculator and tour island mount into server-rendered placeholders.' },
      { label: 'Output checker', path: 'scripts/check.mjs', note: 'The build fails if a route is missing, has multiple h1 elements or renders undefined/null text.' },
    ],
    smooth: [
      'Keeping route metadata in one content module made sitemap, llms text and page generation come from the same data.',
      'Server-safe h() rendering and browser-only JSX islands kept the static build understandable for agents.',
    ],
    examples: [
      {
        title: 'Clamp persisted pricing inputs before making signals',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const saved = safeJson(safeStorageGet('launchpad-pricing', storageStatus)) || {};\nconst seats = useSignal(coerceRange(saved.seats, 2, 80, 12));\nconst minutes = useSignal(coerceRange(saved.minutes, 1, 50, 8));\n\nfunction coerceRange(value, min, max, fallback) {\n  const number = Number(value);\n  if (!Number.isFinite(number)) return fallback;\n  return Math.min(max, Math.max(min, Math.round(number)));\n}",
        notes: 'The UI never starts from NaN or out-of-range persisted values, and range inputs reuse the same coercion path.',
      },
      {
        title: 'Treat static route generation as a contract',
        path: 'scripts/check.mjs',
        language: 'js',
        code: "for (const route of routes) {\n  const file = route.path === '/' ? 'dist/static/index.html' : `dist/static${route.path}/index.html`;\n  if (!existsSync(file)) fail(`missing ${file}`);\n  const html = readFileSync(file, 'utf8');\n  if ((html.match(/<h1[\\s>]/g) || []).length !== 1) fail(`${route.path} must have one h1`);\n}",
        notes: 'A marketing starter can still have build-time quality gates. Here route output, semantics and manifest shape are checked before packaging.',
      },
    ],
    issues: [
      {
        title: 'Persisted controls can poison the first render',
        problem: 'Saved localStorage values may be missing, malformed or outside the product range.',
        fix: 'Every saved range passes through coerceRange before a signal is created, and denied storage falls back to an in-memory Map.',
        proof: 'The build and smoke check complete with static pages plus browser islands, and no route renders nullish text.',
        takeaway: 'Static-first does not mean state-free; persisted island state still needs input hygiene.',
      },
    ],
    boundaries: [
      'The pricing calculator is an anonymous local estimate, not billing or entitlement logic.',
      'All application pages are static HTML with client islands; there is no request-time backend in this starter.',
    ],
  },
  'what-starter-fieldwork': {
    overview: 'Fieldwork is a client-rendered creative research archive with deterministic canvas art, filters and static aliases for every bundled research record.',
    sourceFiles: [
      { label: 'Shared gallery state', path: 'src/state/gallery.js', note: 'Module signals hold filters, canvas seed, drawing mode and the selected research slug.' },
      { label: 'Canvas lifecycle', path: 'src/components/GenerativeCanvas.jsx', note: 'The component draws from signal accessors and cleans up resize/keyboard listeners.' },
      { label: 'Alias generation', path: 'scripts/generate-static-aliases.mjs', note: 'Deployment aliases derive from the projects dataset so every detail route is directly openable.' },
      { label: 'Browser smoke', path: 'tests/smoke.mjs', note: 'The smoke test compares canvas pixels, opens every detail route and screenshots desktop/mobile pages.' },
    ],
    smooth: [
      'Deriving detail aliases from the dataset removed the chance of forgetting a single research record.',
      'The canvas smoke test checks pixel changes, not just button text, so it catches a silent rendering no-op.',
    ],
    examples: [
      {
        title: 'Use signal accessors as effect dependencies',
        path: 'src/components/GenerativeCanvas.jsx',
        language: 'jsx',
        code: "useEffect(() => {\n  draw();\n  const onResize = () => draw();\n  window.addEventListener('resize', onResize);\n  return () => window.removeEventListener('resize', onResize);\n}, [canvasSeed, drawingMode]);",
        notes: 'Passing the accessor lets the effect observe future signal writes. Passing canvasSeed() would sample one value and miss redraws.',
      },
      {
        title: 'Generate route aliases from the content source',
        path: 'scripts/generate-static-aliases.mjs',
        language: 'js',
        code: "const aliases = [\n  '/projects',\n  ...projects.map((project) => `/projects/${project.slug}`),\n  '/build',\n  '/404',\n];",
        notes: 'The deploy shape follows the data list, so new records get static entry points when the dataset changes.',
      },
      {
        title: 'Assert the canvas really redraws',
        path: 'tests/smoke.mjs',
        language: 'js',
        code: "const beforeCanvas = await page.locator('canvas').evaluate((canvas) => canvas.toDataURL());\nawait page.getByRole('button', { name: 'New seed' }).click();\nawait page.waitForFunction((before) => {\n  const canvas = document.querySelector('canvas');\n  return canvas && canvas.toDataURL() !== before;\n}, beforeCanvas);",
        notes: 'A visual starter needs evidence that the visual state changed, not only that the event handler ran.',
      },
    ],
    issues: [
      {
        title: 'The first canvas effect read snapshots instead of subscribing',
        problem: 'The dependency array used sampled values, so the effect did not rerun after the seed or drawing mode changed.',
        before: "useEffect(() => {\n  draw();\n}, [canvasSeed(), drawingMode()]);",
        after: "useEffect(() => {\n  draw();\n}, [canvasSeed, drawingMode]);",
        fix: 'Use the signal accessors as dependencies and verify the canvas data URL changes after the seed button.',
        proof: 'The browser smoke test now compares canvas pixels after a seed change and opens every research detail route directly.',
        takeaway: 'When an effect must follow a signal over time, pass the accessor, not a sampled value.',
      },
      {
        title: 'Fieldwork passed deploy checks before visual review passed',
        problem: 'The live host, source and route checks passed, but the first visual direction did not meet the public showcase bar.',
        fix: 'Keep the hosting evidence valid while a separate design owner iterates the Fieldwork visuals.',
        proof: 'Status can honestly say live baseline while style verification remains a separate gate.',
        takeaway: 'Deployment success and design quality are different claims. The public journal should name both.',
      },
      {
        title: 'A PASS line is not enough when the wrapper stays alive',
        problem: 'A browser smoke can print a passing summary while the Node wrapper still holds an open handle and eventually times out.',
        fix: 'Treat the workflow as pending until the harness exits cleanly after closing browser and server resources.',
        proof: 'The current repair belongs to the Fieldwork executor; this journal records the quality gate without claiming the repaired run has landed.',
        takeaway: 'For public starter evidence, process exit is part of the proof, not bookkeeping after the proof.',
      },
    ],
    boundaries: [
      'Canvas art is deterministic browser drawing, not live AI inference.',
      'The archive is client rendered; research detail content is not request-time SSR article HTML.',
    ],
  },
  'what-starter-oscillator': {
    overview: 'Oscillator is a browser music studio that demonstrates global pattern state, Web Audio lifecycle cleanup and routeable studio/build pages.',
    sourceFiles: [
      { label: 'Audio engine', path: 'src/audio/engine.js', note: 'A single startGeneration and startingPromise coordinate async AudioContext startup.' },
      { label: 'Lifecycle tests', path: 'src/audio/engine.lifecycle.test.js', note: 'Tests cover duplicate starts, stop-before-resume and dispose-before-resume races.' },
      { label: 'Studio state', path: 'src/state/studio.js', note: 'Signals store pattern, playback state, current step and user-facing audio status.' },
    ],
    smooth: [
      'The fake AudioContext test harness made browser-only race conditions testable without playing sound.',
      'Keeping pattern state separate from the engine let the UI mutate tracks while the scheduler reads the latest pattern.',
    ],
    examples: [
      {
        title: 'Coalesce async audio starts',
        path: 'src/audio/engine.js',
        language: 'js',
        code: "if (startingPromise) {\n  audioStatus('Audio starting.');\n  return startingPromise;\n}\nconst generation = ++startGeneration;\nstartingPromise = (async () => {\n  await context.resume();\n  if (generation !== startGeneration || timer || isPlaying()) return;\n  timer = window.setInterval(scheduler, 25);\n})();",
        notes: 'Repeated Start clicks before AudioContext.resume() resolves share the same promise instead of creating duplicate intervals.',
      },
      {
        title: 'Prove pending starts can be cancelled',
        path: 'src/audio/engine.lifecycle.test.js',
        language: 'js',
        code: "const pendingStart = startEngine();\nstopEngine();\nFakeAudioContext.resumePromises[0].resolve();\nawait pendingStart;\n\nexpect(intervals).toHaveLength(0);\nexpect(isPlaying()).toBe(false);",
        notes: 'The regression test models the exact race: the user stops playback while browser audio permission is still resolving.',
      },
    ],
    issues: [
      {
        title: 'Double-start race created multiple schedulers',
        problem: 'Two quick start calls could both await resume and then install intervals.',
        fix: 'A shared startingPromise coalesces callers, and startGeneration invalidates any pending resume when stop or dispose runs.',
        proof: 'Lifecycle tests assert one interval for simultaneous starts and zero intervals when stop/dispose wins the race.',
        takeaway: 'Long-running browser resources need idempotent start and explicit cancellation, even in a demo.',
      },
    ],
    boundaries: [
      'The studio runs entirely in the browser; it does not stream audio or save patterns to a server.',
      'Audio support depends on the browser exposing AudioContext.',
    ],
  },
  'what-starter-lens': {
    overview: 'Lens is a client analytics dashboard with a serverless report endpoint, synthetic event data and CSV export.',
    sourceFiles: [
      { label: 'Analytics store', path: 'src/state.js', note: 'Filter signals derive active filters, filtered events and aggregate dashboard metrics.' },
      { label: 'Report API', path: 'src/api/report.js', note: 'The function endpoint parses filter input and returns aggregate rows for the current selection.' },
      { label: 'Bounded JSON reader', path: 'src/api/bounded-json.js', note: 'The parser enforces function payload limits before JSON decoding.' },
    ],
    smooth: [
      'The same parseFilters path feeds client charts and server reports, reducing drift between local and function-rendered numbers.',
      'CSV export reads the currently filtered event set, so the download matches the visible table.',
    ],
    examples: [
      {
        title: 'Treat filters as the source of truth',
        path: 'src/state.js',
        language: 'js',
        code: "export const activeFilters = computed(() => parseFilters({\n  range: range(),\n  channel: channel(),\n  cohort: cohort(),\n}));\nexport const filteredEvents = computed(() => filterEvents(syntheticEvents, activeFilters()));\nexport const analytics = computed(() => aggregateEvents(filteredEvents()));",
        notes: 'Dashboard cards, charts, CSV and server reports all follow the same reactive filter shape.',
      },
      {
        title: 'Post only the filter contract to the function',
        path: 'src/state.js',
        language: 'js',
        code: "const response = await fetch('/api/report', {\n  method: 'POST',\n  headers: { 'content-type': 'application/json' },\n  body: JSON.stringify(activeFilters())\n});",
        notes: 'The function does not receive DOM state. It receives the small normalized contract it can validate and aggregate.',
      },
    ],
    issues: [
      {
        title: 'Payload limits must count bytes',
        problem: 'A pasted analytics filter body may be larger in bytes than in JavaScript string length.',
        fix: 'Lens uses the shared Uint8Array bounded reader and cancels oversized streams.',
        proof: 'The parser path distinguishes 413 payload failures from 400 malformed JSON before report aggregation runs.',
        takeaway: 'Serverless examples should teach safe request handling next to happy-path charts.',
      },
    ],
    boundaries: [
      'Events are synthetic fixtures, not customer telemetry.',
      'The report endpoint computes a response from posted filters; it is not a warehouse query service.',
    ],
  },
  'what-starter-harbor': {
    overview: 'Harbor is an operations console reference for filters, incident overrides, saved views, activity logs and routeable detail pages.',
    sourceFiles: [
      { label: 'Operations store', path: 'src/state/ops.js', note: 'Module signals hold overrides, filters, saved views, log entries and save status.' },
      { label: 'Routes', path: 'src/routes.js', note: 'The app includes overview, incidents, services, deploys, activity, build and incident-detail routes.' },
      { label: 'Build page', path: 'src/pages/Build.jsx', note: 'The in-app guide names local-only persistence and generated static aliases.' },
    ],
    smooth: [
      'Incident overrides are layered over immutable fixtures, so reset and filtering are simple to reason about.',
      'Computed rollups keep summary cards, service health and deploy risk synchronized with the same incident state.',
    ],
    examples: [
      {
        title: 'Layer local overrides over seed incidents',
        path: 'src/state/ops.js',
        language: 'js',
        code: "export const incidentOverrides = signal(initial.overrides, 'harbor.overrides');\nexport const filters = signal(initial.filters, 'harbor.filters');\n\nexport const mergedIncidents = computed(() =>\n  incidents.map((incident) => ({ ...incident, ...(incidentOverrides()[incident.id] || {}) }))\n);",
        notes: 'The seed incident data stays unchanged; user edits live in a separate signal keyed by incident id.',
      },
      {
        title: 'Persist one snapshot and degrade gracefully',
        path: 'src/state/ops.js',
        language: 'js',
        code: "effect(() => {\n  const snapshot = {\n    overrides: incidentOverrides(),\n    filters: filters(),\n    saved: savedFilters(),\n    log: activityLog(),\n  };\n  if (typeof localStorage !== 'undefined') persistSnapshot(snapshot);\n});",
        notes: 'The effect watches every source signal used in the snapshot and tells the user when storage writes fail.',
      },
    ],
    issues: [
      {
        title: 'LocalStorage can fail in privacy or embedded contexts',
        problem: 'An operations demo cannot crash when the browser denies storage.',
        fix: 'safeLoad catches malformed reads, persistSnapshot catches denied writes and the UI reports session-only state.',
        proof: 'The store keeps operating from seed state even when persistence cannot be used.',
        takeaway: 'Local persistence should be a capability, not a prerequisite for routeable app behavior.',
      },
    ],
    boundaries: [
      'Harbor edits are local simulation state, not shared incident-management storage.',
      'No real service monitors, deploy systems or alert feeds are connected.',
    ],
  },
  'what-starter-gather': {
    overview: 'Gather is a recipe and meal-planning starter with static recipe routes, client filters, scaled servings and a derived shopping list.',
    sourceFiles: [
      { label: 'Planner store', path: 'src/state/planner.js', note: 'Signals hold filters, weekly plan and serving overrides; computed values derive meals, stats and grocery totals.' },
      { label: 'Static aliases', path: 'scripts/static-aliases.mjs', note: 'Recipe detail routes and private planner routes are emitted as concrete Vura pages.' },
      { label: 'Build page', path: 'src/pages/Build.jsx', note: 'The guide explains local state, routing and generated aliases for agents.' },
    ],
    smooth: [
      'The shopping list came naturally from computed aggregation over planned meals.',
      'Route aliases derive from the recipe dataset, so new recipes produce direct detail URLs during build.',
    ],
    examples: [
      {
        title: 'Derive grocery totals from the plan',
        path: 'src/state/planner.js',
        language: 'js',
        code: "export const shoppingList = computed(() => {\n  const totals = new Map();\n  for (const { recipe } of plannedMeals()) {\n    const servings = getServings(recipe.slug);\n    for (const ingredient of recipe.ingredients.map((item) => scaleIngredient(item, recipe.baseServings, servings))) {\n      const key = `${ingredient.item}|${ingredient.unit}`;\n      const existing = totals.get(key) || { item: ingredient.item, unit: ingredient.unit, amount: 0, recipes: new Set() };\n      existing.amount += ingredient.amount;\n      existing.recipes.add(recipe.title);\n      totals.set(key, existing);\n    }\n  }\n});",
        notes: 'The shopping list is not separately editable state. It is a projection of planned meals plus serving overrides.',
      },
      {
        title: 'Emit every recipe detail alias',
        path: 'scripts/static-aliases.mjs',
        language: 'js',
        code: "const routes = [\n  ['/recipes', 'Recipes — Gather', 'A static recipe index with client-side dietary filters.'],\n  ...recipes.map((recipe) => [\n    `/recipes/${recipe.slug}`,\n    `${recipe.title} — Gather`,\n    recipe.subtitle,\n  ]),\n  ['/planner', 'Planner — Gather', 'A persisted weekly meal planner.'],\n];",
        notes: 'Dataset-driven aliases prevent the static host from treating a known recipe URL like an unknown SPA fallback.',
      },
    ],
    issues: [
      {
        title: 'Saved plans can reference recipes that no longer exist',
        problem: 'A browser may hold old route slugs after recipe fixtures change.',
        fix: 'safeLoad filters saved day arrays through findRecipe before creating the weeklyPlan signal.',
        proof: 'Planner state loads seed data or only known slugs, so recipe detail and shopping-list views do not dereference missing recipes.',
        takeaway: 'Local storage migrations can be tiny, but they must exist before demos become references.',
      },
    ],
    boundaries: [
      'Recipes and nutrition-like details are fixtures for interaction design, not a live recipe API.',
      'Planner and shopping list state stays in the browser.',
    ],
  },
  'what-starter-marginalia': {
    overview: 'Marginalia is a static editorial site with client islands for search, bookmarks and reading progress.',
    sourceFiles: [
      { label: 'Server renderer', path: 'src/server/render.mjs', note: 'Article pages are generated with h() and renderToString().' },
      { label: 'Client utilities', path: 'src/client/main.jsx', note: 'The browser bundle mounts search, bookmark and progress-bar islands.' },
      { label: 'Article content', path: 'src/content/articles.mjs', note: 'The same article index feeds static routes and client-side search.' },
    ],
    smooth: [
      'Embedding a small JSON article index lets the static search island work without a remote search service.',
      'Separating article rendering from browser utilities keeps static content readable with JavaScript disabled.',
    ],
    examples: [
      {
        title: 'Make static search an island',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const query = useSignal('');\nconst results = useComputed(() => {\n  const q = query().trim().toLowerCase();\n  if (!q) return index;\n  return index.filter((article) =>\n    [article.title, article.category, article.dek].join(' ').toLowerCase().includes(q)\n  );\n});",
        notes: 'The static article list becomes searchable in the browser while the underlying pages remain prerendered.',
      },
      {
        title: 'Fallback when localStorage is unavailable',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "function safeStorageSet(key, value, storageStatus) {\n  try {\n    window.localStorage.setItem(key, value);\n  } catch {\n    storageStatus('memory');\n    storageFallback.set(key, value);\n    const store = readFallbackStore();\n    store[key] = value;\n    writeFallbackStore(store);\n  }\n}",
        notes: 'Bookmarks keep working in the current browsing context instead of crashing when storage is blocked.',
      },
    ],
    issues: [
      {
        title: 'Clearing bookmarks exposed a static empty branch',
        problem: 'A bookmark list rendered from an earlier array snapshot could fail to show the empty state after clearing.',
        fix: 'Render the saved list through computed state and a reactive branch that checks saved().length.',
        proof: 'The Bookmarks island now switches between the list and empty panel from the same saved computed value.',
        takeaway: 'In static sites, client islands still need reactive branches for empty, saved and cleared states.',
      },
    ],
    boundaries: [
      'Bookmarks are local reading-list state, not an account feature.',
      'Search uses the bundled article index; there is no hosted search backend.',
    ],
  },
  'what-starter-meridian': {
    overview: 'Meridian is a static travel-planning reference with build-time guide pages and a client-mounted itinerary planner island.',
    sourceFiles: [
      { label: 'Server route renderer', path: 'src/server/render.mjs', note: 'Every guide, alias, planner, build and not-found page renders with h() and renderToString().' },
      { label: 'Planner island', path: 'src/client/main.jsx', note: 'Signals store stops, timezone, export text and storage mode; computed values group stops by day.' },
      { label: 'Static build script', path: 'scripts/build.mjs', note: 'The build rewrites the Vite asset name, writes static pages, sitemap, robots and manifest.' },
      { label: 'Browser smoke', path: 'scripts/smoke.mjs', note: 'The smoke checks direct routes, reorder, timezone switch, JSON export, corrupt storage, denied storage and 404.' },
    ],
    smooth: [
      'Guide aliases and sitemap rows come from the same route list, which keeps direct static paths and metadata aligned.',
      'Move buttons made itinerary reordering keyboard and touch friendly without needing drag/drop code.',
    ],
    examples: [
      {
        title: 'Decode escaped script JSON before mounting',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "const data = safeJson(decodeEntities(document.querySelector('#meridian-data')?.textContent || '')) || { sampleStops: [], guides: [] };\n\nfunction decodeEntities(value) {\n  const textarea = document.createElement('textarea');\n  textarea.innerHTML = value;\n  return textarea.value;\n}",
        notes: 'The server renderer escapes script content. The planner island decodes entities before JSON.parse so the static payload stays readable and safe.',
      },
      {
        title: 'Group route state from one stop list',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const stops = useSignal(saved.length ? saved : data.sampleStops);\nconst zone = useSignal(safeGet('meridian-zone', storageStatus) || 'America/Halifax');\nconst days = useComputed(() => groupByDay(stops()));\nconst localPreview = useComputed(() => formatLocal(zone()));",
        notes: 'The exported JSON, day cards and timezone preview follow the same source signals.',
      },
    ],
    issues: [
      {
        title: 'SSG JSON is HTML-escaped by the renderer',
        problem: 'The static route embeds guide data in a script tag, and server rendering escapes that text before the client reads it.',
        before: "const data = JSON.parse(document.querySelector('#meridian-data').textContent);",
        after: "const data = safeJson(decodeEntities(document.querySelector('#meridian-data')?.textContent || ''));",
        fix: 'Decode HTML entities and tolerate missing or malformed JSON before mounting the planner island.',
        proof: 'The smoke test exports a route plan after a production build, proving the planner received sample stops.',
        takeaway: 'Static script JSON needs the same rendering-boundary care as visible HTML.',
      },
    ],
    boundaries: [
      'Trip data is fictional and local-only.',
      'The planner is client-mounted over static fallback HTML; it is not SSR-preserving hydration.',
    ],
  },
  'what-starter-cartograph': {
    overview: 'Cartograph is a hybrid commerce reference with static catalog routes, local cart state and a serverless field-stock quote endpoint.',
    sourceFiles: [
      { label: 'Cart store', path: 'src/state/cart.js', note: 'Signals hold filters, cart, quote, receipt and storage notices; computed values derive cart lines and totals.' },
      { label: 'Quote API', path: 'src/api/quote.js', note: 'The function validates known products, stock limits and totals, then returns no-store JSON.' },
      { label: 'Vura build package', path: 'scripts/build-vura.mjs', note: 'The build emits static aliases, bundles /api/quote and writes the Vura manifest.' },
      { label: 'API tests', path: 'test/cartograph.test.js', note: 'Tests cover quote totals, over-stock rejection, malformed JSON, oversized streams and unknown products.' },
    ],
    smooth: [
      'Product slugs drive cards, details, quote validation and static aliases from one dataset.',
      'The quote function imports shared product data but not browser cart state, which keeps the serverless boundary clean.',
    ],
    examples: [
      {
        title: 'Sanitize persisted cart quantities',
        path: 'src/state/cart.js',
        language: 'js',
        code: "for (const [slug, value] of Object.entries(raw.cart)) {\n  const product = findProduct(slug);\n  const quantity = Math.max(0, Math.min(20, Math.round(Number(value))));\n  if (product && quantity > 0) clean.cart[slug] = quantity;\n}",
        notes: 'The cart restores only known product slugs and bounded positive quantities.',
      },
      {
        title: 'Validate quote requests on the function boundary',
        path: 'src/api/quote.js',
        language: 'js',
        code: "const slug = String(item?.slug || '').slice(0, 80);\nconst quantity = Math.max(0, Math.min(MAX_QTY, Math.round(Number(item?.quantity || 0))));\nconst product = products.find((entry) => entry.slug === slug);\nif (!product || quantity <= 0) continue;\nif (quantity > product.stock) {\n  errors.push(`${product.name} has ${product.stock} available in demo field stock.`);\n}",
        notes: 'The client cart is useful context, but stock and quantity checks run again in the serverless function.',
      },
    ],
    issues: [
      {
        title: 'Product route aliases should come from catalog data',
        problem: 'A static commerce demo with hand-written aliases can miss a product detail route.',
        fix: 'The Vura build imports products and emits one static alias per product slug, plus cart, receipt, build and 404 pages.',
        proof: 'The build script reports the generated page count and API bundle for /api/quote.',
        takeaway: 'Use the same content source for UI, API validation and static hosting shape.',
      },
    ],
    boundaries: [
      'Stock and receipts are fixtures; no order, payment, fulfillment or durable inventory is created.',
      'The serverless quote validates the posted cart but does not reserve stock across visitors.',
    ],
  },
  'what-starter-orbit': {
    overview: 'Orbit is a hybrid scheduling reference with local reservations, serverless availability validation and safe ICS download.',
    sourceFiles: [
      { label: 'Booking state', path: 'src/state/booking.js', note: 'Signals model service, date, slot, guest, availability result, status copy and reservations.' },
      { label: 'Availability API', path: 'src/api/availability.js', note: 'The function strictly validates services, slots, local reservations and overlap conflicts.' },
      { label: 'Shared calendar logic', path: 'src/data/studio.js', note: 'Services, deterministic slots, overlap math, display helpers and ICS text live in pure shared code.' },
      { label: 'Reservations page', path: 'src/pages/Reservations.jsx', note: 'The ICS control creates a temporary Blob URL, clicks it and revokes it after download.' },
      { label: 'API tests', path: 'test/orbit.test.js', note: 'Tests cover open slots, demo holds, local conflicts, strict service validation, ICS text, overlap boundaries and bounded JSON.' },
    ],
    smooth: [
      'Services and slot fixtures are deterministic October 2026 data, which keeps screenshots and API tests stable.',
      'Overlap math is pure shared code, so the API and unit tests can exercise booking logic without a browser.',
    ],
    examples: [
      {
        title: 'Validate local reservations strictly at the API boundary',
        path: 'src/api/availability.js',
        language: 'js',
        code: "for (const reservation of localReservations) {\n  if (!reservation || reservation.status === 'cancelled') continue;\n  const reservationService = findServiceStrict(reservation.serviceId);\n  if (!reservationService) {\n    errors.push('Local reservations must reference known Orbit services.');\n    continue;\n  }\n  activeLocal.push({ start: String(reservation.start || ''), duration: reservationService.duration });\n}",
        notes: 'Display fallbacks are fine in the UI. Posted reservation data needs strict lookup before it participates in conflict math.',
      },
      {
        title: 'Download ICS through a temporary Blob URL',
        path: 'src/pages/Reservations.jsx',
        language: 'jsx',
        code: "function downloadIcs(reservation) {\n  const url = URL.createObjectURL(new Blob([createIcs(reservation)], { type: 'text/calendar;charset=utf-8' }));\n  const anchor = document.createElement('a');\n  anchor.href = url;\n  anchor.download = `${reservation.id}.ics`;\n  anchor.click();\n  setTimeout(() => URL.revokeObjectURL(url), 1000);\n}",
        notes: 'The button creates the URL at click time instead of rendering an unsafe data: href into the document.',
      },
    ],
    issues: [
      {
        title: 'Display fallback caused a phantom reservation conflict',
        problem: 'The API initially reused a display helper that falls back to the first service when an id is unknown.',
        before: "const reservationService = findService(reservation.serviceId);\nactiveLocal.push({ start: reservation.start, duration: reservationService.duration });",
        after: "const reservationService = findServiceStrict(reservation.serviceId);\nif (!reservationService) {\n  errors.push('Local reservations must reference known Orbit services.');\n  continue;\n}",
        fix: 'Use findServiceStrict in the serverless API and keep the forgiving helper for display-only code.',
        proof: 'The API test rejects unknown local reservation service ids and still detects valid local conflicts after strict validation.',
        takeaway: 'A UI fallback can become a security or correctness bug when copied into a server boundary.',
      },
      {
        title: 'Calendar export needed a safe download path',
        problem: 'An early data:text/calendar href was unsafe to render as an anchor URL.',
        fix: 'The reservations page now creates a Blob URL on click and revokes it after the download starts.',
        proof: 'The browser smoke exercises the ICS button from the reservations ledger, and unit tests verify VCALENDAR text generation.',
        takeaway: 'Generate download URLs at the interaction boundary rather than storing unsafe URLs in render state.',
      },
    ],
    boundaries: [
      'Reservations are private to the current browser unless a durable calendar backend is added.',
      'The availability function validates local and demo holds, but it does not create shared locks across users.',
    ],
  },
  'what-starter-form': {
    overview: 'Form is a static architecture-portfolio starter with project detail pages, a filter island and a local proposal-brief generator.',
    sourceFiles: [
      { label: 'Server renderer', path: 'src/server/render.mjs', note: 'Project pages and static routes render with h() and renderToString().' },
      { label: 'Client islands', path: 'src/client/main.jsx', note: 'Filter and proposal islands mount over static fallback sections.' },
      { label: 'Static build', path: 'scripts/build.mjs', note: 'The build writes route aliases, assets, sitemap, robots and manifest.' },
      { label: 'Browser smoke', path: 'scripts/smoke.mjs', note: 'The smoke verifies filters, proposal persistence, denied storage, keyboard download activation and real 404.' },
    ],
    smooth: [
      'Original SVG studies avoid external media while still giving each case study a visual identity.',
      'The proposal output is a computed string, so preview and downloaded text stay in sync with field edits.',
    ],
    examples: [
      {
        title: 'Keep a local proposal preview computed',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const output = useComputed(() => `FORM PROPOSAL BRIEF\\n\\nClient: ${client()}\\nSite: ${site()}\\nScope: ${scope()}\\nBudget: ${budget()}\\n\\nPrepared locally in the Form starter.`);\n\nuseEffect(() => {\n  safeSet(STORAGE, JSON.stringify({ client: client(), site: site(), scope: scope(), budget: budget() }), storageStatus);\n});",
        notes: 'No separate preview state is needed; edits write source fields and the proposal text derives from them.',
      },
      {
        title: 'Verify accessible activation when pointer layout is dense',
        path: 'scripts/smoke.mjs',
        language: 'js',
        code: "await page.getByRole('button', { name: 'Download brief' }).focus();\nawait page.keyboard.press('Enter');\nif (!(await page.locator('p[aria-live=\"polite\"]').textContent()).includes('form-proposal-brief.txt')) {\n  throw new Error('download status missing');\n}",
        notes: 'The regression uses keyboard activation so the primary action remains testable even when mobile composition is tight.',
      },
    ],
    issues: [
      {
        title: 'Client mount replaces static fallback content',
        problem: 'The proposal route starts as static fallback HTML, then the island replaces that region when JavaScript loads.',
        fix: 'Keep fallback copy useful, keep browser JSX in the client entry and document that mount is enhancement, not SSR-preserving hydration.',
        proof: 'The smoke test exercises the mounted proposal editor and reload persistence from the generated static artifact.',
        takeaway: 'Do not describe these islands as hydrated server markup; they are client-mounted interactive regions.',
      },
    ],
    boundaries: [
      'Proposal data is local-only and never submitted to a CRM or server.',
      'The portfolio content is fictional and has no analytics or lead capture endpoint.',
    ],
  },
  'what-starter-beacon': {
    overview: 'Beacon is a static event site with session and speaker routes plus a local agenda island that exports VCALENDAR text.',
    sourceFiles: [
      { label: 'Agenda island', path: 'src/client/main.jsx', note: 'Signals store topic, timezone, saved session ids, storage mode and ICS output.' },
      { label: 'Server renderer', path: 'src/server/render.mjs', note: 'Session and speaker routes render as direct static pages.' },
      { label: 'Static build', path: 'scripts/build.mjs', note: 'The build emits route HTML, assets, sitemap, robots and manifest.' },
      { label: 'Browser smoke', path: 'scripts/smoke.mjs', note: 'The smoke covers route loads, filtering, saving, timezone switching, ICS export, denied storage and 404.' },
    ],
    smooth: [
      'The local agenda can export calendar text without any ticketing or account service.',
      'Direct session and speaker pages make the starter useful even without the agenda island.',
    ],
    examples: [
      {
        title: 'Escape VCALENDAR fields before export',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "function escapeIcs(value) {\n  return String(value)\n    .replace(/\\\\/g, '\\\\\\\\')\n    .replace(/,/g, '\\\\,')\n    .replace(/;/g, '\\\\;')\n    .replace(/\\n/g, '\\\\n');\n}",
        notes: 'Calendar files have their own escaping rules; saved session data should not be inserted raw.',
      },
      {
        title: 'Compute the calendar from saved sessions',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "const filtered = useComputed(() => topic() === 'all' ? data.sessions : data.sessions.filter((session) => session.topic === topic()));\nconst calendar = useComputed(() => makeIcs(data.sessions.filter((session) => saved().includes(session.slug)), zone()));",
        notes: 'Filtering changes the visible agenda; saved ids drive export, so a filtered-out saved session is still included in the user calendar.',
      },
    ],
    issues: [
      {
        title: 'The first page composition read like a poster, not an event tool',
        problem: 'A graphic-led homepage hid the next useful object for someone evaluating the starter.',
        fix: 'The current server render leads with next-session context and schedule density before ornamental content.',
        proof: 'The smoke loads the generated home page and records a desktop screenshot from the static artifact.',
        takeaway: 'Starter pages should foreground the workflow object, not only the aesthetic.',
      },
    ],
    boundaries: [
      'Sessions and speakers are fictional event fixtures.',
      'Agenda state and ICS output are local-only; there is no ticketing, sync or external calendar API.',
    ],
  },
  'what-starter-tally': {
    overview: 'Tally is a client invoice workspace with editable drafts, computed totals, direct receipt routes and local JSON export.',
    sourceFiles: [
      { label: 'Invoice store', path: 'src/state/workspace.js', note: 'Signals store invoice drafts, selected client, save status and export status.' },
      { label: 'Invoice math', path: 'src/data/invoices.js', note: 'Pure helpers calculate finite money totals before UI and exports use them.' },
      { label: 'Alias generation', path: 'scripts/static-aliases.mjs', note: 'The build writes direct client, invoice and receipt paths plus 404.html.' },
      { label: 'Unit tests', path: 'test/invoices.test.js', note: 'Tests cover subtotal/tax/total math and invalid money coercion.' },
    ],
    smooth: [
      'Computed invoice summaries allow draft list, client detail and receipt preview to agree on totals.',
      'The same seed invoices generate static aliases for both invoice editor and receipt paths.',
    ],
    examples: [
      {
        title: 'Keep invoice totals derived',
        path: 'src/state/workspace.js',
        language: 'js',
        code: "export const invoiceSummaries = computed(() => invoices().map((invoice) => ({\n  ...invoice,\n  client: clientById(invoice.clientId),\n  totals: calculateInvoice(invoice),\n})));\n\nexport const workspaceTotals = computed(() => invoiceSummaries().reduce((totals, invoice) => ({\n  drafts: totals.drafts + (invoice.status === 'draft' ? 1 : 0),\n  saved: totals.saved + (invoice.status === 'saved' ? 1 : 0),\n  outstanding: Math.round((totals.outstanding + invoice.totals.total) * 100) / 100,\n}), { drafts: 0, saved: 0, outstanding: 0 }));",
        notes: 'Draft state changes once; all financial summaries derive from current invoice lines.',
      },
      {
        title: 'Generate every direct invoice URL',
        path: 'scripts/static-aliases.mjs',
        language: 'js',
        code: "const routes = [\n  ['/clients', 'Clients — Tally', 'Synthetic freelance client ledger with direct detail routes.'],\n  ...clients.map((client) => [`/clients/${client.id}`, `${client.name} — Tally`, client.notes]),\n  ['/drafts', 'Drafts — Tally', 'Editable invoice draft queue with local persistence.'],\n  ...seedInvoices.flatMap((invoice) => [\n    [`/invoices/${invoice.id}`, `${invoice.id} — Tally`, invoice.title],\n    [`/receipt/${invoice.id}`, `Receipt ${invoice.id} — Tally`, 'Printable local receipt preview.'],\n  ]),\n];",
        notes: 'Static hosting receives concrete pages for both editable drafts and read-only receipt previews.',
      },
    ],
    issues: [
      {
        title: 'Money inputs can briefly be invalid',
        problem: 'Editable number inputs can produce empty, negative or non-finite values while a user is typing.',
        fix: 'The calculation helper coerces invalid money to zero before subtotal, tax and total math.',
        proof: 'The unit test asserts finiteMoney returns zero for bad and negative inputs while accepting numeric strings.',
        takeaway: 'Derived financial UI should guard calculations even when persistence is local-only.',
      },
    ],
    boundaries: [
      'Exports are local JSON only; no invoice is sent, paid or filed.',
      'The starter does not claim tax, payment, compliance or accounting coverage.',
    ],
  },
  'what-starter-drift': {
    overview: 'Drift is a project-board starter showing shared state across board, list, detail and activity routes.',
    sourceFiles: [
      { label: 'Board store', path: 'src/state/board.js', note: 'Signals own cards, view mode, filters, activity and persistence status.' },
      { label: 'Routes', path: 'src/routes.js', note: 'The app includes board, detail, activity, build and fallback routes.' },
      { label: 'Browser tests', path: 'test/browser/drift.spec.js', note: 'The browser suite exercises board/list switching, details, export, storage denial and mobile rendering.' },
    ],
    smooth: [
      'Route detail pages read from the same card signal as the board, so edits stay visible across views.',
      'Keyboard step movement reuses the same moveCard path as select/drop interactions.',
    ],
    examples: [
      {
        title: 'One card source feeds board and list views',
        path: 'src/state/board.js',
        language: 'js',
        code: "export const visibleCards = computed(() => cards()\n  .filter((card) => assigneeFilter() === 'all' || card.assignee === assigneeFilter())\n  .sort(byDueDate));\n\nexport const boardGroups = computed(() => columns.map((column) => ({\n  ...column,\n  cards: visibleCards().filter((card) => card.status === column.id),\n})));",
        notes: 'The list and board do not duplicate filters. They read the same derived set in different layouts.',
      },
    ],
    issues: [
      {
        title: 'Storage restore must validate cards',
        problem: 'Persisted cards can be stale, malformed or refer to a removed column.',
        fix: 'safeLoad requires every stored card to pass validCard before restoring state.',
        proof: 'Invalid stored data falls back to seed cards and reports that seed data loaded.',
        takeaway: 'Shared route state is only useful if restoration cannot poison every route at startup.',
      },
    ],
    boundaries: [
      'Planner edits and export data are browser-local.',
      'The board models workflow interactions, not team authorization or collaboration.',
    ],
  },
  'what-starter-finch': {
    overview: 'Finch is an educational starter with lessons, quizzes, flashcards and locally persisted progress.',
    sourceFiles: [
      { label: 'Progress store', path: 'src/state/progress.js', note: 'A single progress signal backs completed lessons, answers, flashcard index and streak.' },
      { label: 'Lesson data', path: 'src/data/lessons.js', note: 'Content includes explanation, quiz and flashcard data for the in-app curriculum.' },
      { label: 'Lesson routes', path: 'src/routes.js', note: 'Routes cover home, lesson list, detail, practice, build and fallback views.' },
    ],
    smooth: [
      'The lesson content doubles as app data and as the learning path the starter demonstrates.',
      'Debounced persistence keeps rapid answer/card changes from writing localStorage on every micro-update.',
    ],
    examples: [
      {
        title: 'Persist progress without duplicating derived counts',
        path: 'src/state/progress.js',
        language: 'js',
        code: "export const progress = signal(initial, 'finch.progress');\nexport const completedCount = computed(() => progress().completed.length);\nexport const completionPercent = computed(() => Math.round((completedCount() / lessons.length) * 100));\n\nlet saveTimer;\neffect(() => {\n  progress();\n  clearTimeout(saveTimer);\n  saveTimer = window.setTimeout(() => persistProgress(window.localStorage), 60);\n});",
        notes: 'Only source progress is stored. Counts and percentages are recomputed from that source.',
      },
    ],
    issues: [
      {
        title: 'Answers should persist before navigation can lose them',
        problem: 'A delayed-only save risks losing the latest answer if the user navigates immediately after a quiz response.',
        fix: 'answerQuiz updates the progress signal and then calls persistProgress directly in browser contexts.',
        proof: 'The answer path now performs an immediate save while the debounced effect still covers other progress changes.',
        takeaway: 'Debounce background persistence, but synchronously save user actions that feel final.',
      },
    ],
    boundaries: [
      'Progress is local to the browser and is not a hosted student account.',
      'Lesson content is a framework-learning fixture, not a certified curriculum.',
    ],
  },
  'what-starter-signal': {
    overview: 'Signal is a Vura server-rendered status page showing cached output, page config and a small serverless health route.',
    sourceFiles: [
      { label: 'Cached server page', path: 'src/pages/index.tsx', note: 'The page exports server mode, revalidation, tags, loader data and SSR markup.' },
      { label: 'Function route', path: 'src/api/health.ts', note: 'The health API declares serverless compute and returns JSON through the Vura reply object.' },
      { label: 'Static snapshot page', path: 'src/pages/snapshot.tsx', note: 'The starter contrasts cached server output with a static status snapshot.' },
    ],
    smooth: [
      'Literal page exports make rendering mode and cache tags visible to both Vura and readers.',
      'The render proof timestamp gives a simple way to observe cached versus uncached behavior.',
    ],
    examples: [
      {
        title: 'Declare a cached server-rendered page',
        path: 'src/pages/index.tsx',
        language: 'tsx',
        code: "export const page = {\n  mode: 'server' as const,\n  revalidate: 30,\n  tags: ['signal-overview'],\n  title: 'Signal Works status',\n};\n\nexport function loader() {\n  return {\n    renderedAt: new Date().toISOString(),\n    summary: statusSummary(),\n  };\n}",
        notes: 'The cache contract is near the page, not hidden in deployment notes.',
      },
      {
        title: 'Keep serverless route metadata literal',
        path: 'src/api/health.ts',
        language: 'ts',
        code: "export const route = {\n  kind: 'serverless',\n  compute: { class: 'function', memory: '1gb' },\n};\n\nexport function GET(_req: ThenRequest, reply: ThenReply) {\n  return reply.json({ ...healthSnapshot(), fictional: true });\n}",
        notes: 'Vura can see the route shape statically while the handler stays a small typed function.',
      },
    ],
    issues: [
      {
        title: 'The Vura page scanner needs literal exports',
        problem: 'If page config is computed indirectly, the build cannot reliably classify routes, cache tags or function shape.',
        fix: 'Signal keeps page and route exports as literal objects next to their handlers.',
        proof: 'The starter build can emit server, cache and function metadata from source inspection.',
        takeaway: 'For deployable metaframework features, explicit route metadata beats clever abstraction.',
      },
      {
        title: 'Visible escaped newlines are still under repair',
        problem: 'A visible literal newline escape can leak from metadata or head-string rendering into the rendered page.',
        fix: 'Keep this as a pending rendering lesson until the Signal author hands off a verified fix.',
        proof: 'No public journal should claim this repair passed until a fresh build and browser check record the corrected output.',
        takeaway: 'Rendering escape bugs belong in the learning log even before they are closed, as long as the page labels them pending.',
      },
    ],
    boundaries: [
      'Status data is fictional seed data.',
      'The server-render proof demonstrates cache behavior; it is not an uptime monitor.',
    ],
  },
  'what-starter-bloom': {
    overview: 'Bloom is a gardening planner starter with plant catalog routes, plot assignments, watering journal state and derived care queues.',
    sourceFiles: [
      { label: 'Garden store', path: 'src/state/garden.js', note: 'Signals store plot assignments, watering journal, filter and persistence status.' },
      { label: 'Routes', path: 'src/routes.js', note: 'The app includes catalog, plant detail, plots, journal, build and fallback routes.' },
      { label: 'Build page', path: 'src/pages/Build.jsx', note: 'The in-app guide explains local state, aliases and browser-only durability.' },
    ],
    smooth: [
      'The care queue is derived from plant fixtures plus the watering journal, so logging water changes the queue without manual sync code.',
      'Named plot keys make the state easy to inspect in exported JSON and localStorage.',
    ],
    examples: [
      {
        title: 'Derive a care queue from source state',
        path: 'src/state/garden.js',
        language: 'js',
        code: "export const careQueue = computed(() => filteredPlants()\n  .map((plant) => ({\n    ...plant,\n    urgency: plant.waterEvery <= 1 ? 'today' : plant.waterEvery <= 2 ? 'soon' : 'watch',\n    lastWatered: wateringJournal().find((entry) => entry.plant === plant.slug)?.day || 'not logged',\n  }))\n  .sort((a, b) => a.waterEvery - b.waterEvery));",
        notes: 'The queue reacts to both the season filter and journal entries without becoming a separate mutable list.',
      },
    ],
    issues: [
      {
        title: 'Stored garden plans need shape validation',
        problem: 'Old localStorage can contain plots with unknown plant slugs or malformed arrays.',
        fix: 'safeLoad checks validPlan before restoring, otherwise it falls back to seedPlan and initialJournal.',
        proof: 'Startup either restores a valid plan or reports that seed data loaded.',
        takeaway: 'Small starters should show recovery paths because agents will copy them into larger apps.',
      },
    ],
    boundaries: [
      'Plant and care data are fictional fixtures.',
      'Garden state is browser-local and not a synchronized account.',
    ],
  },
});

export function learningFor(slug) {
  return STARTER_LEARNING[slug] || null;
}

export function validateLearning(catalog, records = STARTER_LEARNING) {
  const slugs = new Set(catalog.templates.map((template) => template.slug));
  for (const [slug, entry] of Object.entries(records)) {
    requireValue(slugs.has(slug), `${slug} is not present in the starter catalog`);
    fields(entry, ['overview', 'sourceFiles', 'smooth', 'examples', 'issues', 'boundaries'], slug);
    publicText(entry.overview, `${slug}.overview`);
    for (const key of ['smooth', 'boundaries']) {
      requireValue(Array.isArray(entry[key]) && entry[key].length <= 8, `${slug}.${key} must contain at most 8 entries`);
      entry[key].forEach((value, index) => publicText(value, `${slug}.${key}[${index}]`));
    }
    requireValue(Array.isArray(entry.sourceFiles) && entry.sourceFiles.length <= 8, `${slug}.sourceFiles must contain at most 8 entries`);
    for (const [index, source] of entry.sourceFiles.entries()) {
      fields(source, ['label', 'path', 'note'], `${slug}.sourceFiles[${index}]`);
      publicText(source.label, `${slug}.sourceFiles[${index}].label`, 80);
      sourcePath(source.path, `${slug}.sourceFiles[${index}].path`);
      publicText(source.note, `${slug}.sourceFiles[${index}].note`);
    }
    requireValue(Array.isArray(entry.examples) && entry.examples.length <= 4, `${slug}.examples must contain at most 4 entries`);
    for (const [index, example] of entry.examples.entries()) {
      fields(example, ['title', 'path', 'language', 'code', 'notes'], `${slug}.examples[${index}]`);
      publicText(example.title, `${slug}.examples[${index}].title`, 100);
      sourcePath(example.path, `${slug}.examples[${index}].path`);
      requireValue(/^[a-z][a-z0-9-]*$/i.test(example.language), `${slug}.examples[${index}].language must be a simple language tag`);
      publicText(example.code, `${slug}.examples[${index}].code`, 1800);
      publicText(example.notes, `${slug}.examples[${index}].notes`);
    }
    requireValue(Array.isArray(entry.issues) && entry.issues.length <= 4, `${slug}.issues must contain at most 4 entries`);
    for (const [index, issue] of entry.issues.entries()) {
      fields(issue, ['title', 'problem', 'before', 'after', 'fix', 'proof', 'takeaway'], `${slug}.issues[${index}]`);
      for (const key of ['title', 'problem', 'fix', 'proof', 'takeaway']) publicText(issue[key], `${slug}.issues[${index}].${key}`, key === 'title' ? 100 : 1400);
      if (issue.before !== undefined) publicText(issue.before, `${slug}.issues[${index}].before`, 900);
      if (issue.after !== undefined) publicText(issue.after, `${slug}.issues[${index}].after`, 900);
    }
  }
  return records;
}
