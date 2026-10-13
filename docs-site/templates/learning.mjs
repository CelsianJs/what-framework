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
      { label: 'Relative seed data', path: 'src/domain.js', note: 'seedWorkspace(now) derives demo entry days from the visitor clock so today never renders empty by accident.' },
      { label: 'Editable row UI', path: 'src/app.jsx', note: 'Keyed For rows preserve focused inputs while immutable entry updates replace objects.' },
      { label: 'Bounded request parser', path: 'src/api/bounded-json.js', note: 'The function endpoint enforces byte limits while streaming the body as Uint8Array chunks.' },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"32px headings and 44px controls cover timer, projects, reports and build routes."},
    ],
    smooth: [
      'The local app and serverless validation share the same domain helpers, so UI and API constraints stayed aligned.',
      'The HMR disposal path made timer, effect and popstate cleanup explicit during development.',
      "The entry/report ownership checks fit the existing shared store and retained the continuous keyboard-edit regression without introducing a second workspace.",
      "Compact timer typography and 44px native controls preserve continuous entry editing; portable keyboard shortcuts keep the same checks useful across operating systems.",
    ],
    examples: [
      {
        title: 'Seed demo rows relative to now',
        path: 'src/domain.js',
        language: 'js',
        code: "export function seedWorkspace(now = Date.now()) {\n  const day = (offset) => isoToday(new Date(now + offset * 86400000));\n  return {\n    workspaceId: 'demo-' + Math.random().toString(36).slice(2, 8),\n    running: null,",
        notes: 'The seed data is stable enough for tests but relative enough that the Today panel always has current-day rows.',
      },
      {
        title: 'Keep focused rows stable during immutable edits',
        path: 'src/app.jsx',
        language: 'jsx',
        code: "<For each={() => todaysEntries()} key={(entry) => entry.id} fallback={<EmptyEntries />}>",
        notes: 'Each EntryRow receives a signal-wrapped accessor. The row can read entry().note and update by id without replacing the focused DOM node.',
      },
      {
        title: 'Bound function input by bytes, not text length',
        path: 'src/api/bounded-json.js',
        language: 'js',
        code: "const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);",
        notes: 'This avoids UTF-16 string-length mistakes and cancels the request stream as soon as the payload exceeds the endpoint budget.',
      },
      {
        title: "Let only the current workspace accept an async report",
        path: "src/state.js",
        language: "js",
        code: "const ownsResponse = () => generation === workspaceGeneration && request === reportRequest;",
        notes: "Reset advances the workspace generation; request counters also make the newer report win. Success, validation failures and network failures all check ownership."
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
      {
        title: 'Mapped editable rows can drop input focus',
        problem: 'The entries list updates immutably. A row that captures an immutable item can go stale, and some mapped render shapes can replace the input while the user is typing, leaving only the first typed character and moving focus to the body.',
        fix: 'Render today’s entries with keyed For and pass the row accessor into EntryRow.',
        proof: 'The browser regression marks the note and minutes inputs, performs select-all/backspace/type, and confirms the same DOM node stays focused.',
        takeaway: 'Use keyed accessors for editable repeated state when objects are replaced immutably.',
      },
      {
        title: "Reset must invalidate pending work",
        problem: "A delayed entry or report response could arrive after Reset and repopulate cleared state; a stale failure could clear the next pending guard.",
        fix: "Capture workspaceGeneration plus request counters before awaiting. Guard every result and cleanup, and reject duplicate timer/manual starts while validation is pending.",
        proof: "Controlled browser fetches delay entries and reports, reset, then release success and failure responses; the reset state or newer report remains authoritative.",
        takeaway: "Reset is an asynchronous ownership boundary, not just a group of signal writes."
      },
      {
        "title": "Style checks need a required delivery gate",
        "problem": "Unit tests and builds do not establish narrow-layout geometry, navigation target sizes or visible keyboard focus.",
        "fix": "Run test:style in CI alongside behavior checks using the existing production-preview harness.",
        "proof": "The CI workflow runs npm run test:style; modern-ui checks primary/build routes at desktop and mobile widths, controls, overflow and focus.",
        "takeaway": "Keep style regressions in the delivery path alongside behavior checks."
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
      {"label":"Responsive application stylesheet","path":"src/shared/site.css","note":"The timeline pseudo-element consumes --bar rather than inventing fixed decorative widths."},
    ],
    smooth: [
      'Keeping route metadata in one content module made sitemap, llms text and page generation come from the same data.',
      'Server-safe h() rendering and browser-only JSX islands kept the static build understandable for agents.',
      "The existing tour island could display richer evidence from the same records without adding requests or another state layer.",
      "Quiet dark surfaces keep release evidence readable while the timeline still reads its bar widths from authored duration records.",
    ],
    examples: [
      {
        title: 'Clamp persisted pricing inputs before making signals',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const retention = useSignal(coerceRange(saved.retention, 7, 90, 30));",
        notes: 'The UI never starts from NaN or out-of-range persisted values, and range inputs reuse the same coercion path.',
      },
      {
        title: 'Treat static route generation as a contract',
        path: 'scripts/check.mjs',
        language: 'js',
        code: "for (const route of routes) {\n  const file = route.path === '/' ? 'dist/static/index.html' : `dist/static${route.path}/index.html`;\n  if (!existsSync(file)) {\n    fail(`missing ${file}`);\n    continue;\n  }\n  const html = readFileSync(file, 'utf8');",
        notes: 'A marketing starter can still have build-time quality gates. Here route output, semantics and manifest shape are checked before packaging.',
      },
      {
        title: "Read tour evidence at the selected stage",
        path: "src/client/main.jsx",
        language: "jsx",
        code: "<ul class=\"build-list\">{() => current().evidence.map(item => <li>{item}</li>)}</ul>",
        notes: "Stage-specific evidence is authored in content records and is rendered reactively; the static first-stage fallback remains useful without JavaScript."
      },
      {
        "title": "Keep timeline fill driven by authored data",
        "path": "src/shared/site.css",
        "language": "css",
        "code": ".build-timeline li::before { content: \"\"; position: absolute; inset: 0 auto 0 0; width: var(--bar); background: #1a2b47; }",
        "notes": "The timeline pseudo-element consumes --bar rather than inventing fixed decorative widths."
      },
    ],
    issues: [
      {
        title: 'Pricing pages need the same hero spacing as the rest of the site',
        problem: 'The pricing route used the interactive calculator correctly but missed the page-hero headline class, so the headline and calculator crowded each other.',
        fix: 'Render the pricing section with the shared page-hero class and keep the route-specific calculator mount inside that frame.',
        proof: 'The smoke check requires at least 24px between the headline box and calculator panel at both 1440px and 390px.',
        takeaway: 'Static route classes are part of the component contract when a client island mounts inside them.',
      },
      {
        title: 'Persisted controls can poison the first render',
        problem: 'Saved localStorage values may be missing, malformed or outside the product range.',
        fix: 'Every saved range passes through coerceRange before a signal is created, and denied storage falls back to an in-memory Map.',
        proof: 'The build and smoke check complete with static pages plus browser islands, and no route renders nullish text.',
        takeaway: 'Static-first does not mean state-free; persisted island state still needs input hygiene.',
      },
      {
        title: "A tour needs evidence for each stage",
        problem: "The tour repeated shallow copy and displayed an unsupported time-saved claim.",
        fix: "Put distinct evidence on every tour record and replace the unsupported metric with the count of named owners. Read current evidence inside a reactive function child.",
        proof: "Product-depth checks require distinct records; browser checks switch stages, measure desktop/mobile layout and open static routes with JavaScript disabled.",
        takeaway: "Product claims should come from visible authored evidence, not decorative metrics."
      },
      {
        "title": "Retain data-driven duration bars during style changes",
        "problem": "Flattening decorative backgrounds can also erase a timeline fill that encodes an authored duration record.",
        "fix": "Keep the build-timeline pseudo-element width driven by --bar while simplifying surrounding surfaces and headings.",
        "proof": "The server renderer writes item.percent into --bar and displays item.duration; the stylesheet retains width: var(--bar).",
        "takeaway": "Distinguish decoration from a data encoding before removing a visual treatment."
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
      {
        label: "Authored research dossiers",
        path: "src/data/dossiers.js",
        note: "Each accession has a question, method, local specimens, reading notes and explicit limits; these are authored studies, not measured research."
      },
      { label: "Stable research card frame", path: "src/components/ProjectCard.jsx", note: "Card summaries stay top-aligned while only the footer stretches." },
      { label: "Dossier detail renderer", path: "src/pages/ProjectDetailPage.jsx", note: "Known route content selects its authored dossier and adjacent record without duplicating mutable canvas state." },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Bounded type and contained code preserve the archive specimen and dossier hierarchy."},
    ],
    smooth: [
      'Deriving detail aliases from the dataset removed the chance of forgetting a single research record.',
      'The canvas smoke test checks pixel changes, not just button text, so it catches a silent rendering no-op.',
      "The existing canvas accessor dependencies, listener cleanup and dataset-derived aliases supported the dossiers unchanged; pixel checks still verify redraw behavior.",
      "The paper, ink and citron archive retains its deterministic canvas and stable card footer while local sans-serif copy and 44px controls unify dossier routes.",
    ],
    examples: [
      {
        title: 'Use signal accessors as effect dependencies',
        path: 'src/components/GenerativeCanvas.jsx',
        language: 'jsx',
        code: "useEffect(() => {\n    draw();\n    const onResize = () => draw();\n    const onKey = (event) => {\n      if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;\n      if (event.key.toLowerCase() === 'n') {\n        handleNextSeed();\n      }",
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
        title: 'Let only the card footer stretch',
        path: 'src/components/ProjectCard.jsx',
        language: 'jsx',
        code: "<article class=\"project-card\" style={{ '--project-accent': project.accent }}>",
        notes: 'Variable summaries stay top-aligned; the CSS pushes only the tag and link footer to the bottom.',
      },
      {
        title: "Keep immutable route content out of mutable state",
        path: "src/pages/ProjectDetailPage.jsx",
        language: "jsx",
        code: "const dossier = dossiers[project.slug];",
        notes: "The route selects authored content once. Signals remain reserved for the shared canvas controls rather than duplicating dossier state."
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
        fix: 'Replace the first dark layout with a light research archive and a dominant canvas specimen, then review actual desktop and 390px captures separately from functional checks.',
        proof: 'The revised hosted artifact passed route checks and independent visual review; the first functional pass remains recorded as a different claim.',
        takeaway: 'Deployment success and design quality are different claims. The public journal should name both.',
      },
      {
        title: 'A PASS line is not enough when the wrapper stays alive',
        problem: 'A browser smoke can print a passing summary while the Node wrapper still holds an open handle and eventually times out.',
        fix: 'Launch the owned preview process directly, match readiness after stripping terminal control characters, and await bounded browser/server cleanup.',
        proof: 'Isolated repository copies exited after their smoke assertions, and the repaired Linux workflow passed. A colorized readiness regression covers the runner-specific failure.',
        takeaway: 'For public starter evidence, process exit is part of the proof, not bookkeeping after the proof.',
      },
      {
        title: "The dossier must contain what its metadata promises",
        problem: "Early metadata counted fragments and measurements that the detail pages did not actually show.",
        fix: "Author a complete dossier per record, render three local specimens and reading notes, and state which observations are design reflections rather than measured results.",
        proof: "Dossier tests require every known project to have a distinct question and complete content; browser smoke opens each record and follows next-record navigation.",
        takeaway: "Research-style presentation must distinguish authored specimens from empirical evidence."
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
      {
        label: "Pattern identity regression",
        path: "src/state/studio.test.js",
        note: "Tests restore saved presets, identify custom edits and exercise denied save/reset operations."
      },
      { label: "Sequencer grid", path: "src/components/Sequencer.jsx", note: "The step ruler owns its grid and the playhead is visible only during playback." },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Mobile steps and ruler share four columns; transport controls retain their numeric readouts."},
    ],
    smooth: [
      'The fake AudioContext test harness made browser-only race conditions testable without playing sound.',
      'Keeping pattern state separate from the engine let the UI mutate tracks while the scheduler reads the latest pattern.',
      "The existing audio scheduler reads current pattern state, so saved/custom identity needed no scheduler redesign or new audio resource.",
      "At 360px, the sixteen steps and their ruler reflow together into four-column groups, preserving 44px targets without altering audio state.",
    ],
    examples: [
      {
        title: 'Coalesce async audio starts',
        path: 'src/audio/engine.js',
        language: 'js',
        code: "if (startingPromise) {\n    audioStatus('Audio starting.');\n    return startingPromise;\n  }\n  if (!isAudioSupported()) {\n    browserError('This browser does not expose Web Audio. Try a current Chromium, Safari, or Firefox build.');\n    return;",
        notes: 'Repeated Start clicks before AudioContext.resume() resolves share the same promise instead of creating duplicate intervals.',
      },
      {
        title: 'Prove pending starts can be cancelled',
        path: 'src/audio/engine.lifecycle.test.js',
        language: 'js',
        code: "const pendingStart = startEngine();",
        notes: 'The regression test models the exact race: the user stops playback while browser audio permission is still resolving.',
      },
      {
        title: 'Only show the playhead while playback is active',
        path: 'src/components/Sequencer.jsx',
        language: 'jsx',
        code: "isPlaying() && currentStep() === step && 'playing',",
        notes: 'The stopped studio keeps selected steps visible without leaving a fake current-step highlight on the grid.',
      },
      {
        title: "Derive preset identity from the current patch",
        path: "src/state/studio.js",
        language: "js",
        code: "export const currentPresetId = computed(() => presets.find((preset) => JSON.stringify(preset) === JSON.stringify(pattern()))?.id || '');",
        notes: "The restored pattern, not a hard-coded first-preset id, determines the selected preset. An edited patch has custom identity."
      },
    ],
    issues: [
      {
        title: 'A sequencer ruler needs its own grid',
        problem: 'The old step header mixed a blank track cell and sixteen numbers in one parent grid, then hid the final child with CSS.',
        fix: 'Render the step numbers inside a dedicated .step-numbers element and let CSS give that child the same column count as the step buttons.',
        proof: 'The browser smoke checks the desktop sixteen-column ruler and the mobile eight-column wrap.',
        takeaway: 'A visual alignment bug can be a data-structure bug in the markup, not only a CSS spacing bug.',
      },
      {
        title: 'Double-start race created multiple schedulers',
        problem: 'Two quick start calls could both await resume and then install intervals.',
        fix: 'A shared startingPromise coalesces callers, and startGeneration invalidates any pending resume when stop or dispose runs.',
        proof: 'Lifecycle tests assert one interval for simultaneous starts and zero intervals when stop/dispose wins the race.',
        takeaway: 'Long-running browser resources need idempotent start and explicit cancellation, even in a demo.',
      },
      {
        title: "A restored patch should not claim the wrong preset",
        problem: "Reloading a saved patch could highlight Brass Grid regardless of its contents; custom edits and saved status were conflated.",
        fix: "Compute preset identity from exact pattern contents and track the saved serialized snapshot separately. Catch storage writes/removal so audio editing can continue in-session.",
        proof: "Studio regressions restore Slow Bloom, preserve custom identity after edits/reload, and verify save/reset do not throw under denied storage.",
        takeaway: "Preset identity, current edits and persistence success are separate facts."
      },
      {
        "title": "Reflow step controls and their ruler together",
        "problem": "Sixteen 44px sequencer targets cannot fit one 360px row; changing only the buttons leaves the ruler misaligned.",
        "fix": "Give both .steps and .step-numbers four equal columns at the narrow breakpoint and retain 44px step minimums.",
        "proof": "The stylesheet pairs the grid selectors and preserves the step minimums; browser regressions cover the narrow sequencer and ruler.",
        "takeaway": "Reflow related controls and labels together instead of shrinking targets."
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
      { label: "Shared analytics domain", path: "src/data.js", note: "Filter normalization, aggregation, chart semantics and CSV serialization use deterministic fixture data." },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Dashboard panels align to their content rather than stretching beside longer charts."},
    ],
    smooth: [
      'The same parseFilters path feeds client charts and server reports, reducing drift between local and function-rendered numbers.',
      'CSV export reads the currently filtered event set, so the download matches the visible table.',
      "Shared filter parsing still aligns client and function calculations; freshness copy exposes the remaining snapshot boundary instead of inventing live ingestion.",
      "Content-fit dashboard panels and quiet surfaces retain the real dataset chart geometry while bounded headings and 44px native selects unify report routes.",
    ],
    examples: [
      {
        title: 'Treat filters as the source of truth',
        path: 'src/state.js',
        language: 'js',
        code: "export const activeFilters = computed(() => parseFilters({ range: range(), channel: channel(), cohort: cohort() }));\nexport const filteredEvents = computed(() => filterEvents(syntheticEvents, activeFilters()));\nexport const analytics = computed(() => aggregateEvents(filteredEvents()));",
        notes: 'Dashboard cards, charts, CSV and server reports all follow the same reactive filter shape.',
      },
      {
        title: 'Post only the filter contract to the function',
        path: 'src/state.js',
        language: 'js',
        code: "const response = await fetch('/api/report', {\n      method: 'POST',\n      headers: { 'content-type': 'application/json' },\n      body: JSON.stringify(activeFilters())\n    });",
        notes: 'The function does not receive DOM state. It receives the small normalized contract it can validate and aggregate.',
      },
      {
        title: 'Let chart meaning choose the orientation',
        path: 'src/data.js',
        language: 'js',
        code: "export function chartSeries(rows, metric, kind = 'category') {\n  const ordered = kind === 'time'\n    ? [...rows].sort((a, b) => String(a.label).localeCompare(String(b.label)))\n    : [...rows];",
        notes: 'Revenue by day becomes a time series, while channel comparisons stay categorical.',
      },
      {
        title: "Block duplicate report refreshes",
        path: "src/state.js",
        language: "js",
        code: "if (report().status === 'loading') return;",
        notes: "The result remains a snapshot of its returned filters; the UI labels that snapshot and warns when current controls differ."
      },
    ],
    issues: [
      {
        title: 'Chart form should follow data semantics',
        problem: 'The first dashboard drew revenue by day as horizontal bars, making time-series data look like a ranking; later dense 7/14/30 day ranges exposed clipped labels and uneven bar baselines.',
        fix: 'chartSeries accepts a kind, sorts time rows, and returns vertical orientation for day-based trends. The chart CSS uses minmax columns plus a fixed label axis row.',
        proof: 'The overview slices the same chart to the selected 7/14/30 day range, and the build guide records the baseline/axis repair.',
        takeaway: 'A small metadata flag can keep chart components from flattening every metric into the same visual grammar.',
      },
      {
        title: 'Payload limits must count bytes',
        problem: 'A pasted analytics filter body may be larger in bytes than in JavaScript string length.',
        fix: 'Lens uses the shared Uint8Array bounded reader and cancels oversized streams.',
        proof: 'The parser path distinguishes 413 payload failures from 400 malformed JSON before report aggregation runs.',
        takeaway: 'Serverless examples should teach safe request handling next to happy-path charts.',
      },
      {
        title: "A report snapshot should not impersonate current filters",
        problem: "Changing controls after a report returned made the server summary look current even though it represented an earlier filter selection.",
        fix: "Show the filters supplied by the response, compare them with current controls, and disable refresh while a request is pending. Keep cohorts as a semantic horizontally scrollable table.",
        proof: "Smoke checks report freshness, chart geometry and compact mobile hierarchy without dropping cohort columns.",
        takeaway: "Label response snapshots explicitly when controls can change independently."
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
      {
        label: "Reactive incident detail",
        path: "src/pages/IncidentDetail.jsx",
        note: "The route id is stable setup; the current merged incident is read through an accessor for selects, severity and quick actions."
      },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"The incident detail grid uses start alignment with shared heading and control scales."},
    ],
    smooth: [
      'Incident overrides are layered over immutable fixtures, so reset and filtering are simple to reason about.',
      'Computed rollups keep summary cards, service health and deploy risk synchronized with the same incident state.',
      "The override read model already joined fixtures and edits; the repair moved reads to the right boundary without changing incident storage.",
      "Incident detail panels align to their own content so a short status form does not stretch beside a long timeline; cyan status and risk readouts retain their roles.",
    ],
    examples: [
      {
        title: 'Layer local overrides over seed incidents',
        path: 'src/state/ops.js',
        language: 'js',
        code: "export const mergedIncidents = computed(() => incidents.map((incident) => ({ ...incident, ...(incidentOverrides()[incident.id] || {}) })));",
        notes: 'The seed incident data stays unchanged; user edits live in a separate signal keyed by incident id.',
      },
      {
        title: 'Compute deploy risk display once',
        path: 'src/state/ops.js',
        language: 'js',
        code: "export const deployRollups = computed(() => deploys.map((deploy) => ({\n  ...deploy,\n  serviceName: serviceName(deploy.serviceId),\n  linkedIncidents: mergedIncidents().filter((incident) => incident.serviceId === deploy.serviceId && incident.status !== 'resolved').length,\n  tone: deployRiskTone(deploy.risk),\n  meterStyle: riskMeterStyle(deploy.risk)\n})));",
        notes: 'The UI receives risk tone and bounded meter style from one computed read model instead of rebuilding thresholds in cards.',
      },
      {
        title: "Capture identity, not the changing incident",
        path: "src/pages/IncidentDetail.jsx",
        language: "jsx",
        code: "const incidentId = route.params.id;\n  const incident = () => mergedIncidents().find((entry) => entry.id === incidentId);",
        notes: "A run-once component can capture a stable route id; editable record reads belong in an accessor used by reactive bindings."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": ".detail-grid {\n  display: grid;\n  grid-template-columns: minmax(260px, 0.8fr) minmax(300px, 1.2fr);\n  gap: 1rem;\n  align-items: start;\n}",
        "notes": "The incident detail grid uses start alignment with shared heading and control scales."
      },
    ],
    issues: [
      {
        title: 'Duplicated dashboard metrics weakened the first screen',
        problem: 'The status strip repeated the same operational counts as the main KPI grid, while deploy risk appeared as plain integers.',
        fix: 'Keep the strip for demo/storage context and compute risk tone plus meter CSS variables in deployRollups.',
        proof: 'The dashboard renders service rollups, owner load, and deploy meters from computed read models.',
        takeaway: 'Dashboards feel sharper when each region owns a distinct decision, not the same number in a different box.',
      },
      {
        title: 'LocalStorage can fail in privacy or embedded contexts',
        problem: 'An operations demo cannot crash when the browser denies storage.',
        fix: 'safeLoad catches malformed reads, persistSnapshot catches denied writes and the UI reports session-only state.',
        proof: 'The store keeps operating from seed state even when persistence cannot be used.',
        takeaway: 'Local persistence should be a capability, not a prerequisite for routeable app behavior.',
      },
      {
        title: "Run-once detail setup captured yesterday’s record",
        problem: "Quick actions updated incident overrides and storage while detail controls and severity still displayed the original object.",
        fix: "Capture only incidentId in setup, read the current merged incident through an accessor, and disable already-applied quick actions. Name saved views by severity/status/owner and deduplicate matching combinations.",
        proof: "Browser regressions apply quick actions and verify visible controls/rail, recognizable legacy views and a single saved view per filter combination.",
        takeaway: "A signal update cannot refresh a record sampled once during component setup."
      },
      {
        "title": "Short detail panels should not stretch to long content",
        "problem": "Default grid stretching can turn a compact status panel into a tall empty surface beside a long incident timeline.",
        "fix": "Align incident detail grid items to start so each panel follows its own content height.",
        "proof": "The .detail-grid source rule includes align-items: start; local style checks include incident detail routes.",
        "takeaway": "Use content-fit alignment where adjacent panels have different amounts of information."
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
      { label: "Recipe day selection", path: "src/pages/RecipeDetail.jsx", note: "A mount-local selected day feeds explicit planner actions rather than hard-coded destinations." },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Size the wrapping checkbox label; six equal mobile tracks balance three links above two."},
    ],
    smooth: [
      'The shopping list came naturally from computed aggregation over planned meals.',
      'Route aliases derive from the recipe dataset, so new recipes produce direct detail URLs during build.',
      "The computed grocery quantities remained unchanged; stable item/unit keys layered checklist completion over the existing plan.",
      "Shopping labels provide a 44px tap area without enlarging native checkbox glyphs; five mobile navigation links form deliberate rows of three and two.",
    ],
    examples: [
      {
        title: 'Choose the target day explicitly',
        path: 'src/pages/RecipeDetail.jsx',
        language: 'jsx',
        code: "const selectedDay = signal(firstOpenDay(), `gather.detailDay.${recipe.slug}`);",
        notes: 'The detail page starts on the first empty day but keeps the chosen day as local component state.',
      },
      {
        title: 'Derive grocery totals from the plan',
        path: 'src/state/planner.js',
        language: 'js',
        code: "const existing = totals.get(key) || { item: ingredient.item, unit: ingredient.unit, amount: 0, recipes: new Set() };",
        notes: 'The shopping list is not separately editable state. It is a projection of planned meals plus serving overrides.',
      },
      {
        title: 'Emit every recipe detail alias',
        path: 'scripts/static-aliases.mjs',
        language: 'js',
        code: "...recipes.map((recipe) => [",
        notes: 'Dataset-driven aliases prevent the static host from treating a known recipe URL like an unknown SPA fallback.',
      },
      {
        title: "Store market checks by ingredient identity",
        path: "src/state/planner.js",
        language: "js",
        code: "export const ingredientKey = (ingredient) => `${ingredient.item}|${ingredient.unit}`;",
        notes: "Checked keys survive navigation and reload; progress counts only keys in the current computed market list."
      },
    ],
    issues: [
      {
        title: 'A fixed Add to Monday button overwrote the lesson',
        problem: 'Recipe detail and card actions sent meals to fixed days, so the planner felt fake and hid duplicate/full-day behavior.',
        fix: 'Expose native day selects backed by firstOpenDay(), dayHasOpenSlot(), and daySlotLabel(), then keep button text reactive with a function child.',
        proof: 'Browser smoke selects Thursday, verifies the Thursday planner card, and checks that full-day or duplicate choices explain the no-op.',
        takeaway: 'Small native controls can teach state transitions more clearly than a hard-coded demo shortcut.',
      },
      {
        title: "DOM-only purchased marks disappeared on navigation",
        problem: "Native checkboxes appeared checked but their completion was not part of the planner snapshot.",
        fix: "Persist checkedIngredients alongside plan and servings. Ignore unknown keys, default old snapshots to no checks, and make Clear checks leave meals/servings intact.",
        proof: "Checklist unit and browser flows verify navigation, reload, clearing, planner reset and denied-storage session editing.",
        takeaway: "Persist user intent by stable item identity while deriving completion from the current list."
      },
      {
        "title": "Put the checkbox tap target on its label",
        "problem": "A small native checkbox is hard to tap, but enlarging the glyph itself distorts the control.",
        "fix": "Give the shopping-row label a 44px minimum height and leave the native checkbox width and height automatic.",
        "proof": "The browser regression measures all 21 seeded checklist labels at desktop/mobile widths, requiring 44px labels and checkbox widths no greater than 24px.",
        "takeaway": "Enlarge the associated label hit area while preserving native control geometry."
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
      {"label":"Responsive application stylesheet","path":"src/shared/site.css","note":"The article grid uses start alignment while the mobile masthead removes absolute brand positioning."},
    ],
    smooth: [
      'Embedding a small JSON article index lets the static search island work without a remote search service.',
      'Separating article rendering from browser utilities keeps static content readable with JavaScript disabled.',
      "The bookmark utility already finds its button anywhere on the page; moving it before the essay needed no new island or persistence model.",
      "The editorial masthead keeps a keyboard-reachable 44px wordmark; article and sidenote columns align to their content and the mobile brand returns to document flow.",
    ],
    examples: [
      {
        title: 'Make static search an island',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const results = useComputed(() => {",
        notes: 'The static article list becomes searchable in the browser while the underlying pages remain prerendered.',
      },
      {
        title: 'Fallback when localStorage is unavailable',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "function safeStorageSet(key, value, storageStatus) {\n  try {\n    window.localStorage.setItem(key, value);\n  } catch {\n    storageStatus('memory');\n    storageFallback.set(key, value);\n    const store = readFallbackStore();\n    store[key] = value;\n    writeFallbackStore(store);\n  }\n}",
        notes: 'Bookmarks keep working in the current browsing context instead of crashing when storage is blocked.',
      },
      {
        title: "Derive reading duration from the actual essay",
        path: "src/content/articles.mjs",
        language: "js",
        code: "article.minutes = Math.max(1, Math.ceil(article.body.join(' ').trim().split(/\\s+/).length / 220));",
        notes: "A simple content-based estimate replaces guessed 4–7 minute labels. It is an estimate, not a measured reading time."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/shared/site.css",
        "language": "css",
        "code": ".article { display: grid; grid-template-columns: minmax(0, 1fr) 240px; align-items: start; gap: 48px; padding-block: 40px; }",
        "notes": "The article grid uses start alignment while the mobile masthead removes absolute brand positioning."
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
      {
        title: "Reading-time labels outgrew the essays",
        problem: "Short three-paragraph stubs advertised several minutes of reading, and the article utility hierarchy made the bookmark action hard to find.",
        fix: "Expand authored essays, derive duration at 220 words per minute, and render compact byline, bookmark action, related reading and sidenotes on the server. Scope byline styling so body-copy scale does not enlarge metadata.",
        proof: "Product-depth tests validate every duration; browser checks preserve article reading without JavaScript, search, saved-list clearing and denied-storage behavior.",
        takeaway: "Editorial metadata should describe actual content rather than set a target the content must pretend to meet."
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
      {
        label: "Guide plans and slot movement",
        path: "src/content.mjs",
        note: "Known guide records seed local plans; pure movement swaps activities while retaining destination day/time slots."
      },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Start-aligned planner controls and larger mobile SVG text preserve the actual itinerary geometry."},
    ],
    smooth: [
      'Guide aliases and sitemap rows come from the same route list, which keeps direct static paths and metadata aligned.',
      'Move buttons made itinerary reordering keyboard and touch friendly without needing drag/drop code.',
      "Native move buttons reused pure plan operations; guide context and the reactive route projection did not require drag/drop or a map service.",
      "Route maps retain their 400-by-120 SVG coordinates; larger mobile labels compensate for scaling while content-fit planner controls keep itinerary actions together.",
    ],
    examples: [
      {
        title: 'Decode escaped script JSON before mounting',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "const data = safeJson(decodeEntities(document.querySelector('#meridian-data')?.textContent || '')) || { sampleStops: [], guides: [] };",
        notes: 'The server renderer escapes script content. The planner island decodes entities before JSON.parse so the static payload stays readable and safe.',
      },
      {
        title: 'Group route state from one stop list',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const exportText = useSignal('');",
        notes: 'The exported JSON, day cards and timezone preview follow the same source signals.',
      },
      {
        title: "Move activities without moving the schedule clock",
        path: "src/content.mjs",
        language: "js",
        code: "next[index] = { ...items[target], day: items[index].day, time: items[index].time };\n  next[target] = { ...items[index], day: items[target].day, time: items[target].time };",
        notes: "Slots own their clock labels. The guide query selects known records; saved plans win until the visitor explicitly applies a guide."
      },
      {
        "title": "Fit planner controls to their content",
        "path": "src/styles.css",
        "language": "css",
        "code": ".controls { display: grid; gap: 16px; align-self: start; align-content: start; }",
        "notes": "Start-aligned planner controls and larger mobile SVG text preserve the actual itinerary geometry."
      },
    ],
    issues: [
      {
        title: 'Grid children stretch unless controls opt out',
        problem: 'The trip controls lived beside tall itinerary cards, so the grid stretched the controls panel into a heavy block.',
        fix: 'The controls panel opts out with align-self and align-content start while the itinerary can keep its taller rhythm.',
        proof: 'The smoke captures the production page after timezone switching and route export from the generated static artifact.',
        takeaway: 'A small CSS alignment rule can make an island feel intentional instead of stretched by its sibling content.',
      },
      {
        title: 'SSG JSON is HTML-escaped by the renderer',
        problem: 'The static route embeds guide data in a script tag, and server rendering escapes that text before the client reads it.',
        before: "const data = JSON.parse(document.querySelector('#meridian-data').textContent);",
        after: "const data = safeJson(decodeEntities(document.querySelector('#meridian-data')?.textContent || ''));",
        fix: 'Decode HTML entities and tolerate missing or malformed JSON before mounting the planner island.',
        proof: 'The smoke test exports a route plan after a production build, proving the planner received sample stops.',
        takeaway: 'Static script JSON needs the same rendering-boundary care as visible HTML.',
      },
      {
        title: "Reordering activities could reverse the clock",
        problem: "Moving an activity retained its old timestamp while hard-coding day reassignment, allowing a later time to appear before an earlier one.",
        fix: "Swap activities into destination day/time slots. Resolve known guide context, preserve existing saved plans, and project current stops in the mounted SVG. Label timezone output as a fixed reference instant, not conversion of undated stops.",
        proof: "Pure tests cover guide plans and slot stability; browser tests cover contextual plans, exported guide ids, reorder and storage failure.",
        takeaway: "Distinguish activity identity, schedule slots and real timestamps before implementing itinerary movement."
      },
      {
        "title": "Measure SVG labels after responsive scaling",
        "problem": "An SVG can fit the viewport while its text becomes too small as the viewBox scales.",
        "fix": "Retain the 400-by-120 route coordinates and increase mobile route-map text to 18px.",
        "proof": "The local style-browser suite visits home, guide, planner and build at multiple widths and measures rendered map-label height.",
        "takeaway": "Verify rendered text dimensions as well as logical SVG geometry."
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
      {
        label: "Receipt render boundary",
        path: "src/pages/Receipt.jsx",
        note: "The component returns a reactive function that reads receipt() and selects the empty/full view after Reset."
      },
      { label: "Native quantity editing", path: "src/pages/Cart.jsx", note: "Canonical quantities and temporary DOM text coexist during keyboard replacement; valid commits keep totals live." },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Product and cart grids align at the start; gear illustrations keep their source geometry."},
    ],
    smooth: [
      'Product slugs drive cards, details, quote validation and static aliases from one dataset.',
      'The quote function imports shared product data but not browser cart state, which keeps the serverless boundary clean.',
      "Shared product data and bounded quote parsing stayed intact; basket ownership and reactive receipt reset fit the existing native quantity draft behavior.",
      "Content-fit equipment and cart panels avoid stretching short content while shared local typography and 44px targets retain native quantity editing.",
    ],
    examples: [
      {
        title: 'Validate quantity text before committing it',
        path: 'src/pages/Cart.jsx',
        language: 'js',
        code: "function parseQuantity(value) {\n  if (!/^\\d+$/.test(value)) return null;\n  const next = Number(value);\n  if (!Number.isSafeInteger(next) || next < 1 || next > 20) return null;\n  return next;\n}",
        notes: 'The parser is intentionally separate from the input so both live edits and blur commits share the same 1-20 rule.',
      },
      {
        title: 'Let the DOM hold a blank draft quantity',
        path: 'src/pages/Cart.jsx',
        language: 'jsx',
        code: "defaultValue={quantity()}",
        notes: 'Cart state stays canonical while the native input can temporarily be blank during select-all/backspace/type replacement.',
      },
      {
        title: 'Validate quote requests on the function boundary',
        path: 'src/api/quote.js',
        language: 'js',
        code: "const acceptedQuantity = Math.min(quantity, product.stock);",
        notes: 'The client cart is useful context, but stock and quantity checks run again in the serverless function.',
      },
      {
        title: "Read the receipt inside the reactive branch",
        path: "src/pages/Receipt.jsx",
        language: "jsx",
        code: "return () => {\n    const current = receipt();\n    if (!current) {",
        notes: "Reset clears both state and visible receipt immediately; a setup-time snapshot would keep the old receipt until navigation."
      },
    ],
    issues: [
      {
        title: 'Blank quantity drafts should not remove the row',
        problem: 'Selecting a quantity, backspacing, then typing a replacement briefly produced an empty string. Converting that to Number removed the cart line and dropped focus.',
        fix: 'parseQuantity accepts only 1-20. The native input owns temporary text with defaultValue, updateQuantity commits valid changes, and commitQuantity restores invalid blur to the canonical quantity. There is no separate quantityDrafts signal.',
        proof: 'Browser smoke select-all/backspace/types 12, asserts the same input remains focused, sees subtotal $2,976, and confirms localStorage persisted 12.',
        takeaway: 'For replacement editing, canonical app state and transient DOM text can intentionally be different for a few keystrokes.',
      },
      {
        title: 'Product route aliases should come from catalog data',
        problem: 'A static commerce demo with hand-written aliases can miss a product detail route.',
        fix: 'The Vura build imports products and emits one static alias per product slug, plus cart, receipt, build and 404 pages.',
        proof: 'The build script reports the generated page count and API bundle for /api/quote.',
        takeaway: 'Use the same content source for UI, API validation and static hosting shape.',
      },
      {
        title: "A quote belongs to its submitted basket",
        problem: "A late successful quote could be accepted after quantities changed; Reset receipt also cleared storage while leaving the sampled receipt on screen.",
        fix: "Capture sorted basketKey and submitted lines, block duplicate pending quotes, discard mismatched responses and require a current successful quote before writing. Render receipt() inside the returned reactive branch.",
        proof: "Delayed-response regressions reject stale baskets; receipt browser checks require immediate empty UI, null storage, and empty state after back/reload. Keyboard quantity replacement remains covered.",
        takeaway: "Async results need snapshot ownership, and resettable views must read current state reactively."
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
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Bounded headings and full-height brand and form controls retain the booking workflow."},
    ],
    smooth: [
      'Services and slot fixtures are deterministic October 2026 data, which keeps screenshots and API tests stable.',
      'Overlap math is pure shared code, so the API and unit tests can exercise booking logic without a browser.',
      "Pure overlap helpers and strict service lookup remained the API boundary; the browser added draft ownership without pretending to create cross-user locks.",
      "Shared local typography, subtle panels and 44px native controls unify service, booking, receipt and build routes without changing draft verification.",
    ],
    examples: [
      {
        title: 'Validate local reservations strictly at the API boundary',
        path: 'src/api/availability.js',
        language: 'js',
        code: "const activeLocal = [];",
        notes: 'Display fallbacks are fine in the UI. Posted reservation data needs strict lookup before it participates in conflict math.',
      },
      {
        title: 'Download ICS through a temporary Blob URL',
        path: 'src/pages/Reservations.jsx',
        language: 'jsx',
        code: "function downloadIcs(reservation) {\n  const url = URL.createObjectURL(new Blob([createIcs(reservation)], { type: 'text/calendar;charset=utf-8' }));\n  const anchor = document.createElement('a');\n  anchor.href = url;\n  anchor.download = `${reservation.id}.ics`;\n  anchor.click();\n  setTimeout(() => URL.revokeObjectURL(url), 1000);\n}",
        notes: 'The button creates the URL at click time instead of rendering an unsafe data: href into the document.',
      },
      {
        title: "Permit booking only from the verified draft",
        path: "src/state/booking.js",
        language: "js",
        code: "export const canBook = computed(() => !pending() && availability()?.ok === true && verifiedDraft() === draftKey());",
        notes: "The key includes service, date, start and local reservations. A successful response for a prior selection is not permission to book the current one."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": ".brand {\n  display: inline-flex;\n  align-items: center;\n  min-height: 44px;\n  color: var(--coral);\n  text-decoration: none;\n  text-transform: none;\n  font-size: 24px;\n  line-height: 1.4;\n  font-weight: 700;\n  letter-spacing: -.02em;\n}",
        "notes": "Bounded headings and full-height brand and form controls retain the booking workflow."
      },
    ],
    issues: [
      {
        title: 'Mobile booking heads need a measured clamp',
        problem: 'The Orbit brand scale worked on desktop, but the booking page head could dominate the first mobile viewport before the controls appeared.',
        fix: 'Add a page-head h1 clamp and a narrower mobile max-width so the service/date/slot controls stay in view.',
        proof: 'The responsive CSS now has route-specific page-head sizing and mobile smoke covers booking flow from the generated app.',
        takeaway: 'A dramatic display face still needs route-level clamps when the workflow starts below the headline.',
      },
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
      {
        title: "Availability is not permission for a different draft",
        problem: "Changing service, slot or local reservations after a check could reuse a success for the wrong selection.",
        fix: "Fingerprint the draft, invalidate verified state on changes, block concurrent checks, discard responses for changed drafts and verify the returned service/start before enabling booking.",
        proof: "Delayed fetch regressions change the selection during a check and require a fresh check; normal booking, local conflict and ICS export tests remain.",
        takeaway: "A validated response authorizes its submitted draft, not whichever controls happen to be visible later."
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
      {
        label: "Contextual case-study records",
        path: "src/content.mjs",
        note: "Project records include program, materials, rationale and tradeoffs; known study slugs can seed a local proposal."
      },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Case and brief grids align to the start; navigation and form controls retain 44px targets."},
    ],
    smooth: [
      'Original SVG studies avoid external media while still giving each case study a visual identity.',
      'The proposal output is a computed string, so preview and downloaded text stay in sync with field edits.',
      "The proposal remained a computed projection of four signals; richer case-study context changed inputs without adding submission or lead-capture behavior.",
      "Architectural SVG studies remain the main visual object while case-study and brief grids fit their own content and use the same local type scale as static pages.",
    ],
    examples: [
      {
        title: 'Keep a local proposal preview computed',
        path: 'src/client/main.jsx',
        language: 'jsx',
        code: "const output = useComputed(() => `FORM PROPOSAL BRIEF\\n\\nClient: ${client()}\\nSite: ${site()}\\nScope: ${scope()}\\nBudget: ${budget()}\\n\\nPrepared locally. Not submitted to a studio.`);",
        notes: 'No separate preview state is needed; edits write source fields and the proposal text derives from them.',
      },
      {
        title: 'Verify accessible activation when pointer layout is dense',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "const blob = new Blob([output()], { type: 'text/plain' });",
        notes: 'The regression uses keyboard activation so the primary action remains testable even when mobile composition is tight.',
      },
      {
        title: "Resolve study context without overwriting saved edits",
        path: "src/client/main.jsx",
        language: "js",
        code: "const study = data.projects.find(project => project.slug === new URLSearchParams(location.search).get('study'));",
        notes: "Known study context seeds an empty editor. A saved brief remains until an explicit Use study brief action replaces it."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": ".case { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 48px; margin-block: 48px; }",
        "notes": "Case and brief grids align to the start; navigation and form controls retain 44px targets."
      },
    ],
    issues: [
      {
        title: 'A compact form still needs breathing room below controls',
        problem: 'The proposal editor was functionally correct but cramped where the generated preview and status copy met the controls.',
        fix: 'Keep the computed preview, then use spacing and a keyboard-activated download proof instead of adding new state or abstractions.',
        proof: 'Smoke focuses Download brief, presses Enter, and verifies the live status names form-proposal-brief.txt.',
        takeaway: 'When the state model is already clean, a design repair can stay in layout and proof rather than code architecture.',
      },
      {
        title: 'Client mount replaces static fallback content',
        problem: 'The proposal route starts as static fallback HTML, then the island replaces that region when JavaScript loads.',
        fix: 'Keep fallback copy useful, keep browser JSX in the client entry and document that mount is enhancement, not SSR-preserving hydration.',
        proof: 'The smoke test exercises the mounted proposal editor and reload persistence from the generated static artifact.',
        takeaway: 'Do not describe these islands as hydrated server markup; they are client-mounted interactive regions.',
      },
      {
        title: "A case-study action lost its context",
        problem: "Draft a proposal opened a generic brief instead of carrying the selected project; longer previews also exposed grid overflow.",
        fix: "Resolve the study query against embedded records, preserve saved fields, and offer explicit context application. Add program/material/rationale content; reset figure margins and let preview children shrink and wrap.",
        proof: "Product-depth tests require complete study records; browser checks verify contextual seed, preserved edits, text download, useful no-JS fallback and 390px layout.",
        takeaway: "Contextual entry should seed empty work, not silently replace an existing draft."
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
      {
        label: "Pure calendar serialization",
        path: "src/calendar.mjs",
        note: "UTC event stamps, escaped text, CRLF separators and UTF-8-aware 75-octet folding are independent of UI timezone labels."
      },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Session panels align to their own content and retain the shared control and focus scale."},
    ],
    smooth: [
      'The local agenda can export calendar text without any ticketing or account service.',
      'Direct session and speaker pages make the starter useful even without the agenda island.',
      "The same saved-session ids feed the preview and file; static schedule/session/speaker relationships stay readable without JavaScript.",
      "Content-fit session details and compact schedule labels keep agenda actions close to event facts; the wordmark remains a 44px home target.",
    ],
    examples: [
      {
        title: 'Escape VCALENDAR fields before export',
        path: 'src/calendar.mjs',
        language: 'js',
        code: "function escapeIcs(value) { return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/,/g, '\\\\,').replace(/;/g, '\\\\;').replace(/\\n/g, '\\\\n'); }",
        notes: 'Calendar files have their own escaping rules; saved session data should not be inserted raw.',
      },
      {
        title: 'Compute the calendar from saved sessions',
        path: 'src/client/main.jsx',
        language: 'js',
        code: "const calendar=useComputed(()=>makeIcs(data.sessions.filter((session)=>saved().includes(session.slug))));",
        notes: 'Filtering and timezone controls change the visible agenda, not the UTC event instants. Saved ids drive export, including saved sessions hidden by a topic filter.',
      },
      {
        title: "Fold calendar lines by UTF-8 bytes",
        path: "src/calendar.mjs",
        language: "js",
        code: "const bytes = encoder.encode(char).length;\n    if (width + bytes > 75) { result += '\\r\\n '; width = 1; }",
        notes: "Continuation whitespace counts toward the next line. Date stamps come from UTC event instants and the actual generation clock."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": ".session-detail { align-items: start; }",
        "notes": "Session panels align to their own content and retain the shared control and focus scale."
      },
    ],
    issues: [
      {
        title: 'Static fallback cards and mounted controls needed different link shapes',
        problem: 'The static agenda row can be a whole-card link, but the mounted agenda row also contains a Save button. Nesting that control in a big link would be invalid and confusing.',
        fix: 'Keep static fallback rows as whole-card links; after mounting, render title/details as its own anchor beside a separate Save button.',
        proof: 'The browser smoke saves a session, switches timezone, exports ICS, and still opens direct session routes.',
        takeaway: 'Interactive islands may need a different accessible link structure than their no-JS fallback.',
      },
      {
        title: 'The first page composition read like a poster, not an event tool',
        problem: 'A graphic-led homepage hid the next useful object for someone evaluating the starter.',
        fix: 'The current server render leads with next-session context and schedule density before ornamental content.',
        proof: 'The smoke loads the generated home page and records a desktop screenshot from the static artifact.',
        takeaway: 'Starter pages should foreground the workflow object, not only the aesthetic.',
      },
      {
        title: "Calendar preview is not a downloaded calendar file",
        problem: "The agenda only showed textarea text while its export copy promised a file; long Unicode fields also needed byte-aware calendar serialization.",
        fix: "Move serialization into pure makeIcs, use UTC starts/ends and generation DTSTAMP, escape fields and fold by UTF-8 octets. Download a text/calendar Blob and revoke its temporary URL; save changes clear stale preview.",
        proof: "Product-depth checks cover Unicode folding and timestamps; browser tests await a real .ics download and assert saved-only sessions at desktop/mobile widths.",
        takeaway: "Export proof should inspect the actual file and format, not just visible preview text."
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
      { label: "Recoverable line editor", path: "src/pages/InvoiceDetail.jsx", note: "Keyed For accessors preserve input identity, per-operand clamping matches calculations, and empty drafts can start again." },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Fixed line-total tracks and visible mobile field labels remain intact alongside bounded headings."},
    ],
    smooth: [
      'Computed invoice summaries allow draft list, client detail and receipt preview to agree on totals.',
      'The same seed invoices generate static aliases for both invoice editor and receipt paths.',
      "Line removal reused immutable invoice state and keyed For accessors; draft dates/status added context without changing local export or receipt boundaries.",
      "Ledger, line editor and receipt share bounded typography and 44px targets; Meta-or-Ctrl keyboard replacement still verifies keyed row identity.",
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
        title: 'Preserve line identity while editing',
        path: 'src/pages/InvoiceDetail.jsx',
        language: 'jsx',
        code: "<For each={() => invoice().lines} key={(line) => line.id} fallback={<p class=\"empty-state\">No invoice lines yet. Add a line to start this local draft.</p>}>",
        notes: 'The accessor row lets Tally replace line objects immutably while the current input keeps focus.',
      },
      {
        title: 'Generate every direct invoice URL',
        path: 'scripts/static-aliases.mjs',
        language: 'js',
        code: "const routes = [\n  ['/', 'Tally — Freelance invoice workspace', 'Edit invoice drafts, calculate finite totals, preview receipts, and export JSON locally.'],\n  ['/clients', 'Clients — Tally', 'Synthetic freelance client ledger with direct detail routes.'],\n  ...clients.map((client) => [`/clients/${client.id}`, `${client.name} — Tally`, client.notes]),",
        notes: 'Static hosting receives concrete pages for both editable drafts and read-only receipt previews.',
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": "h1 { margin: 0 0 16px; font-size: 32px; line-height: 1.2; letter-spacing: -.02em; font-weight: 600; }",
        "notes": "Fixed line-total tracks and visible mobile field labels remain intact alongside bounded headings."
      },
    ],
    issues: [
      {
        title: 'Immutable line edits need keyed row accessors',
        problem: 'Quantity, unit-price and description edits replace line objects. Raw keyed mapping may retain DOM while holding an older object; some render shapes can also replace focused inputs.',
        fix: 'InvoiceDetail renders invoice lines with keyed For and reads line().quantity, line().unitPrice and line().description inside the row.',
        proof: 'Playwright marks the focused node, clears and types in existing plus newly added line fields, and verifies focus and totals stay correct.',
        takeaway: 'Editable tables should use identity-preserving loops before reaching for imperative refocus code.',
      },
      {
        title: 'Invoice totals need a fixed track before responsive labels take over',
        problem: 'Currency widths made independent line-row grids drift on desktop, while mobile cards relied on a detached header that was no longer visible.',
        fix: 'Use a fixed 7.5rem total track on desktop and expose Description, Qty, Unit price and Line total labels inside each mobile row card.',
        proof: 'Browser tests measure row column alignment at 1440px and require mobile row labels after the header is hidden.',
        takeaway: 'Dense editor grids need both column math and responsive labeling, not one or the other.',
      },
      {
        title: 'Money inputs can briefly be invalid',
        problem: 'Editable number inputs can produce empty, negative or non-finite values while a user is typing.',
        fix: 'The calculation helper coerces invalid money to zero before subtotal, tax and total math.',
        proof: 'The unit test asserts finiteMoney returns zero for bad and negative inputs while accepting numeric strings.',
        takeaway: 'Derived financial UI should guard calculations even when persistence is local-only.',
      },
      {
        title: "Removing lines must preserve finite and recoverable drafts",
        problem: "An accidental row had no recovery path, and clamping a multiplied line amount let two negative operands become a positive displayed total.",
        fix: "Remove by line id, show a zero-total empty state and allow Add line to restart. Clamp quantity and price individually with finiteMoney before multiplying, matching the shared calculation.",
        proof: "Browser tests add/remove rows, remove every row, require zero totals, add again and enter two negatives. Existing focus and column-alignment regressions remain.",
        takeaway: "Editor recovery and displayed math should follow the same canonical operands as exported totals."
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
      {
        label: "Live board/list reads",
        path: "src/pages/Board.jsx",
        note: "List cards derive through an accessor; bounded move buttons expose named destinations and mobile lanes retain scroll cues."
      },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Balanced narrow navigation and readable detail/build typography retain board movement controls."},
    ],
    smooth: [
      'Route detail pages read from the same card signal as the board, so edits stay visible across views.',
      'Keyboard step movement reuses the same moveCard path as select/drop interactions.',
      "Board, list and detail still share one card store; bounded move controls reuse the existing movement and activity functions.",
      "Mobile planner navigation forms two deliberate rows of two links; a 44px home wordmark and visible focus stay part of the board workflow.",
    ],
    examples: [
      {
        title: 'One card source feeds board and list views',
        path: 'src/state/board.js',
        language: 'js',
        code: "export const visibleCards = computed(() => cards()\n  .filter((card) => assigneeFilter() === 'all' || card.assignee === assigneeFilter())\n  .sort(byDueDate));\n\nexport const boardGroups = computed(() => columns.map((column) => ({\n  ...column,\n  cards: visibleCards().filter((card) => card.status === column.id),\n})));",
        notes: 'The list and board do not duplicate filters. They read the same derived set in different layouts.',
      },
      {
        title: "Read the filtered list after setup",
        path: "src/pages/Board.jsx",
        language: "jsx",
        code: "const cards = () => boardGroups().flatMap((group) => group.cards.map((card) => ({ ...card, column: group.label })));",
        notes: "The component runs once, but cards() is evaluated in reactive bindings when assignee changes. Capturing the resulting array once would freeze the open list."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": ".brand { display: inline-flex; align-items: center; min-height: 44px; font-size: 24px; font-weight: 600; line-height: 1.2; text-decoration: none; }",
        "notes": "Balanced narrow navigation and readable detail/build typography retain board movement controls."
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
      {
        title: "An open list kept the old filter result",
        problem: "The list sampled boardGroups in run-once setup, so changing assignee updated the store without updating visible rows.",
        fix: "Keep the cards projection as an accessor; name move destinations and disable impossible edge moves. Give the mobile lane preview a focusable scroll region and visible cue.",
        proof: "Browser regressions change assignee while list view remains open, verify boundary move controls and inspect mobile lane scrolling.",
        takeaway: "Derived collections that change after mount belong in accessors, not setup snapshots."
      },
      {
        "title": "Allow subpixel tolerance in browser target measurements",
        "problem": "A 44px CSS target can report a fractional bounding rectangle just below 44px, making strict raw-float checks brittle across platforms.",
        "fix": "Retain the 44px CSS minimum and allow a half-pixel tolerance in the style regression.",
        "proof": "The modern-ui check requires control.height >= 43.5; CSS controls retain min-height: 44px, and the test verifies mobile navigation rows and home navigation.",
        "takeaway": "Normalize measurement tolerances without reducing the authored target size."
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
      {
        label: "Reactive practice deck",
        path: "src/pages/Practice.jsx",
        note: "Current card/index are accessors; reveal state is mount-local and resets before advancing."
      },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Lesson, quiz and build routes share local 16px body copy and 14px native controls."},
    ],
    smooth: [
      'The lesson content doubles as app data and as the learning path the starter demonstrates.',
      'Debounced persistence keeps rapid answer/card changes from writing localStorage on every micro-update.',
      "Existing progress persistence and timer cleanup supported the repaired deck; no account sync or spaced-repetition scheduler was introduced.",
      "Quiet lesson cards and 44px quiz actions keep the lesson object before secondary explanation without changing answers or progress state.",
    ],
    examples: [
      {
        title: 'Persist progress without duplicating derived counts',
        path: 'src/state/progress.js',
        language: 'js',
        code: "export const progress = signal(initial, 'finch.progress');",
        notes: 'Only source progress is stored. Counts and percentages are recomputed from that source.',
      },
      {
        title: "Read the current practice card through accessors",
        path: "src/pages/Practice.jsx",
        language: "jsx",
        code: "const index = () => progress().cardIndex % dueCards().length;\n  const lesson = () => dueCards()[index()];",
        notes: "Keep reveal state local to this mount. Advance resets reveal and reads the next card rather than a setup-time card snapshot."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": "nav a {\n  text-decoration: none;\n  display: inline-flex;\n  align-items: center;\n  min-height: 44px;\n  font-size: 14px;\n  line-height: 1.5;\n  padding: 8px 12px;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  background: transparent;\n}",
        "notes": "Lesson, quiz and build routes share local 16px body copy and 14px native controls."
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
      {
        title: "Next card changed storage but not the displayed card",
        problem: "Practice captured the card array, index and lesson in run-once setup; advance changed progress while the screen stayed on the first card.",
        fix: "Use current-card/index accessors, mount-local reveal and quiz state, and explicit continuation/course-complete branches. Construct Link inside a reactive child with a concrete href string rather than passing an accessor to href.",
        proof: "Browser tests advance, reveal and wrap the deck, complete a quiz and inspect the real continuation href before/after reset; timer cleanup and immediate answer persistence remain covered.",
        takeaway: "Run-once setup owns stable resources; changing reads and concrete navigation targets belong at reactive boundaries."
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
      { label: 'Private request-time snapshot', path: 'src/pages/snapshot.tsx', note: 'The snapshot reads fresh loader data without public revalidation, contrasting the cached overview.' },
      { label: 'Build guide', path: 'src/pages/build.tsx', note: 'The public guide documents useLoaderData, literal head strings and local CSS delivery checks.' },
      {
        label: "Second incident server route",
        path: "src/pages/incidents/webhook-retry-spike.tsx",
        note: "Literal server configuration and a typed loader make the second advertised incident directly addressable."
      },
      {"label":"Responsive application stylesheet","path":"src/site/styles.css","note":"The source stylesheet supplies readable status copy, 44px navigation and contained monospace readouts."},
    ],
    smooth: [
      'Literal page exports make rendering mode and cache tags visible to both Vura and readers.',
      'The render proof timestamp gives a simple way to observe cached versus uncached behavior.',
      'Local smoke now checks /styles.css returns 200 text/css so public pages do not silently ship as unstyled defaults.',
      "The new incident reused shared timeline rendering and literal page configuration; source changes do not themselves prove a new hosted release.",
      "Server-rendered overview and incident routes share the source stylesheet and synchronized public copy while loader and cache behavior remain unchanged.",
    ],
    examples: [
      {
        title: 'Declare a cached server-rendered page',
        path: 'src/pages/index.tsx',
        language: 'tsx',
        code: "const { renderedAt, summary } = useLoaderData<typeof loader>();",
        notes: 'The cache contract is near the page, not hidden in deployment notes.',
      },
      {
        title: 'Keep serverless route metadata literal',
        path: 'src/api/health.ts',
        language: 'ts',
        code: "compute: { class: 'function', memory: '1gb' },",
        notes: 'Vura can see the route shape statically while the handler stays a small typed function.',
      },
      {
        title: "Read the incident from its loader contract",
        path: "src/pages/incidents/webhook-retry-spike.tsx",
        language: "tsx",
        code: "const { incident, renderedAt } = useLoaderData<typeof loader>();",
        notes: "The component renders shared incident detail from real loader data rather than guessing page props."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/site/styles.css",
        "language": "css",
        "code": ".brand { display: inline-flex; align-items: center; min-height: 44px; gap: 8px; text-decoration: none; font-weight: 700; font-size: 1.25rem; letter-spacing: -.02em; }",
        "notes": "The source stylesheet supplies readable status copy, 44px navigation and contained monospace readouts."
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
        title: 'Loader data is not passed as ordinary page props',
        problem: 'Overview, incident and snapshot pages first expected loader return values as top-level props, so public UI could show fallback or unknown values instead of proving render timing.',
        fix: 'Import useLoaderData from @celsian/vura-core and read the typed loader result inside each page component.',
        proof: 'The cached overview renders its ISO timestamp through useLoaderData, while the snapshot route reads a fresh health payload per request.',
        takeaway: 'Server-rendered Vura pages should read request data through the framework loader hook, not guessed component props.',
      },
      {
        title: 'Escaped head newlines rendered as visible text',
        problem: 'A literal head string containing escaped newline text could leak visible \\n characters into the page.',
        fix: 'Keep head metadata as single-line literal strings and explain the constraint on /build.',
        proof: 'The current index, snapshot, build and 404 pages use single-line head strings; the public guide shows the before/after.',
        takeaway: 'When static scanners require literal strings, boring one-line metadata can be the safest output contract.',
      },
      {
        title: "Every advertised incident needs a real route",
        problem: "The second bundled active incident linked to 404 because no detail page existed.",
        fix: "Add a literal server-page definition for webhook-retry-spike, read its loader through useLoaderData and share facts/timeline rendering with the ingestion incident.",
        proof: "Browser tests visit both incident details while retaining CSS delivery, actual loader stamps and cached-versus-private snapshot assertions.",
        takeaway: "Direct-route completeness is part of the content contract, even when a dashboard already lists the record."
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
      {
        label: "Dated care and legacy migration",
        path: "src/utils/care.js",
        note: "Pure explicit-clock care math ignores invalid/future watering and observations; legacy notes keep unknown dates as null."
      },
      {"label":"Responsive application stylesheet","path":"src/styles.css","note":"Content-fit plant panels and local typography preserve dated watering and assignment state."},
    ],
    smooth: [
      'The care queue is derived from plant fixtures plus the watering journal, so logging water changes the queue without manual sync code.',
      'Named plot keys make the state easy to inspect in exported JSON and localStorage.',
      "Unique plot assignment, denied-storage fallback and static aliases supported the dated notebook; the clock refresh timer/focus listener are cleaned up on unmount.",
      "The dated notebook retains botanical SVG silhouettes and real plot assignments while quiet surfaces and 44px controls unify catalog and plant detail routes.",
    ],
    examples: [
      {
        title: 'Move one plant to one plot',
        path: 'src/state/garden.js',
        language: 'js',
        code: "export function assignPlant(plot, slug) {",
        notes: 'The function rebuilds known plot buckets and removes the selected plant from every previous bed before adding it to the target.',
      },
      {
        title: 'Derive a care queue from source state',
        path: 'src/state/garden.js',
        language: 'js',
        code: "export const careQueue = computed(() => filteredPlants()\n  .map((plant) => ({\n    ...plant,\n    ...careForPlant(plant, wateringJournal(), new Date(clock())),\n  }))\n  .sort((a, b) => ({ overdue: 0, today: 1, check: 2, soon: 3, rest: 4 }[a.urgency] - { overdue: 0, today: 1, check: 2, soon: 3, rest: 4 }[b.urgency])));",
        notes: 'The queue reacts to both the season filter and journal entries without becoming a separate mutable list.',
      },
      {
        title: "Use local calendar days for the next soil check",
        path: "src/utils/care.js",
        language: "js",
        code: "const nextCare = midnight(latest.observedAt);\n  nextCare.setDate(nextCare.getDate() + plant.waterEvery);",
        notes: "No valid dated watering means Check soil, not a fabricated overdue date. Observations remain notes, not watering events."
      },
      {
        "title": "Use the shared stylesheet on application routes",
        "path": "src/styles.css",
        "language": "css",
        "code": ".seed-packets {\n  grid-area: packets;\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: .65rem;\n  align-items: start;\n}",
        "notes": "Content-fit plant panels and local typography preserve dated watering and assignment state."
      },
    ],
    issues: [
      {
        title: 'Plot assignment is a single-location state bucket',
        problem: 'Moving a plant by only appending it to the target plot could leave the same plant visible in two beds.',
        fix: 'assignPlant rebuilds every known plot bucket, filters the plant out everywhere, then appends it to the selected plot.',
        proof: 'Unit and browser checks assert Sun Gold Tomato appears exactly once after moving to the kitchen bed.',
        takeaway: 'When the UI offers one select per item, the state mutation should enforce that same uniqueness invariant.',
      },
      {
        title: 'Stored garden plans need shape validation',
        problem: 'Old localStorage can contain plots with unknown plant slugs or malformed arrays.',
        fix: 'safeLoad checks validPlan before restoring, otherwise it falls back to seedPlan and initialJournal.',
        proof: 'Startup either restores a valid plan or reports that seed data loaded.',
        takeaway: 'Small starters should show recovery paths because agents will copy them into larger apps.',
      },
      {
        title: "Cadence alone could not react to watering",
        problem: "Logging water never changed the Today badge because care used only fixture cadence; older Today labels had no trustworthy timestamp.",
        fix: "Compute care from valid non-future dated watering with an explicit clock and local calendar days. Migrate undated legacy notes to observedAt:null, preserve text, label uncertainty and bind selects to current unique plot assignments.",
        proof: "Unit tests cover today/next day/overdue, future/invalid timestamps and unknown legacy dates; browser checks watering, observations, assignment continuity and session-only storage.",
        takeaway: "Preserve unknown dates as unknown; manual care reminders are not sensor measurements."
      },
      {
        title: "Expanded source guides exposed mobile overflow",
        problem: "Long source snippets widened the document after the notebook guide grew, especially with wider fallback monospace fonts.",
        fix: "Let guide grid children shrink with min-width:0, wrap inline tokens and constrain preformatted code to its own scrolling box without altering copied source text.",
        proof: "The 390px browser regression checks normal and Courier fallback fonts and asserts intact literal source while the document remains within the viewport.",
        takeaway: "Contain literal code within its own scroller instead of changing source text to fit the page."
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
