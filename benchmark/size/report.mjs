// Render the measured totals, attribution, and checked-in source-level explanations.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const code = value => '\x60' + value + '\x60';
const cell = value => value ?? '—';
const findResult = (app, framework, results) => results.find(row => row.app === app && row.framework === framework);
const section = (title, content) => ['## ' + title, '', ...content, ''];

function table(columns, rows) {
  return [
    '| ' + columns.join(' | ') + ' |',
    '| ' + columns.map(() => '---').join(' | ') + ' |',
    ...rows.map(row => '| ' + row.map(cell).join(' | ') + ' |'),
    '',
  ];
}

function sourceLink(source, line) {
  return '[' + code(source + ':' + line) + '](../../' + source + '#L' + line + ')';
}

function composition(results) {
  const lines = [];
  for (const row of results.filter(r => ['what', 'solid2'].includes(r.framework) && r.modules.length)) {
    lines.push(
      '### ' + row.app + ' / ' + row.framework, '',
      ...table(['Module', 'Minified bytes by map', 'Rollup rendered length'], [
        ...row.modules.map(m => [code(m.source), m.minifiedBytes, m.renderedLength]),
        ['Unmapped (including generated bundler code)', row.unmappedBytes, null],
      ]),
    );
  }
  return lines;
}

function whatComposition(hello, todo, results) {
  const todoRegions = new Map(todo.regions.map(region => [region.name, region.minifiedBytes]));
  const regions = [...hello.regions].sort((a, b) =>
    Math.max(b.minifiedBytes, todoRegions.get(b.name)) - Math.max(a.minifiedBytes, todoRegions.get(a.name)));
  const solidListBytes = findResult('todo', 'solid2', results).modules
    .find(row => row.source.endsWith('/dist/prod/map.js'))?.minifiedBytes;
  return [
    'The largest retained What costs are listed below. The source ranges are disjoint within each module. They measure how much code ships in those regions, independently of how much a refactor would save.',
    '',
    ...table(['What runtime region', 'Source', 'Hello bytes', 'Todo bytes'], regions.map(region => [
      region.name,
      sourceLink(region.source, region.first) + '–' + region.last,
      region.minifiedBytes,
      todoRegions.get(region.name),
    ])),
    '- **General renderer.** Compiled JSX invokes ' + sourceLink('packages/core/src/render.js', 82)
      + ' and public mount invokes ' + sourceLink('packages/core/src/dom.js', 265)
      + '. Both call the generic VNode dispatcher. Dispatch branches retain uncompiled elements, the class bridge, boundary and portal fallback, and generic props even for a component that returns compiled DOM. Separating a compiler-specific entry could keep those branches out of apps that never use them. The generic entry still needs those behaviors.',
    '- **Insertion and lists.** The counter uses the text fast path inside a generic compiled insert helper. Its type-changing fallback keeps conversion, reconciliation, and disposal reachable. The todo adds the keyed and unkeyed branches of What’s shared mapper. ' + (solidListBytes === undefined ? '' : 'Solid 2’s ' + code('map.js') + ' contributes ' + solidListBytes + ' bytes in this run. ') + 'A keyed-only entry or a compiler-proven text binding could narrow these call graphs. These are candidates for testing with conditional children, ownership and disposal cases.',
    '- **Templates.** Generic template parsing retains SVG and table wrapping because it dispatches on an HTML string. Compiler specialization could move those branches to call sites that need them.',
    '- **Hydration.** The hydration walker contributes zero mapped bytes in these two builds. ' + sourceLink('packages/core/src/render.js', 1934),
    '',
  ];
}

function productionOutput(hello, todo) {
  const markerPresence = (label, ...rows) => rows.map(row => row.markers[label].present ? 'yes' : '—');
  return [
    'Vite builds in production mode, where ' + code('what-compiler/vite') + ' defines ' + code('__WHAT_DEV__') + ' as ' + code('false') + ' and the development tier folds away. Each marker is searched for in the emitted JS.',
    '',
    ...table(['Output marker', 'Hello', 'Todo'], Object.entries(hello.markers).map(
      ([label, marker]) => [label + ' (' + code(marker.source) + ')', ...markerPresence(label, hello, todo)],
    )),
  ];
}

export async function writeReport(here, report) {
  const { results, machine, toolchain, whatRevision, whatSourceChanges } = report;
  const hello = findResult('hello', 'what', results);
  const todo = findResult('todo', 'what', results);
  const krausest = results.filter(row => row.app === 'krausest');
  function difference(app, key) {
    const gap = findResult(app, 'solid2', results)[key] - findResult(app, 'what', results)[key];
    return gap === 0 ? 'the same number of' : Math.abs(gap) + (gap > 0 ? ' fewer' : ' more');
  }
  const helloExports = hello.runtimeExports.filter(row => row.reason);
  const absentExports = [...new Set(hello.runtimeExports.filter(row => !row.reason).map(row => code(row.name)))].join(', ');
  const packages = krausest.flatMap(row => (row.runtimePackages ?? []).map(pkg => [
    row.framework, code(pkg.name + '@' + pkg.version), pkg.renderedBytes,
  ]));
  const lines = [
    '# Framework bundle size baseline',
    '',
    'What ships ' + difference('hello', 'raw') + ' raw JS bytes than Solid 2 for hello and '
      + difference('todo', 'raw') + ' for todo. With Brotli it ships '
      + difference('hello', 'brotli') + ' bytes for hello and ' + difference('todo', 'brotli') + ' for todo.',
    '',
    ...section('Size in bytes', table(['App', 'Framework', 'Raw', 'Gzip 9', 'Brotli 11', 'Mapped framework JS'], results.map(row => [
      row.app, row.framework, row.raw, row.gzip, row.brotli, row.frameworkBytes,
    ]))),
    krausest.length
      ? 'Krausest rows use the existing sibling builds as-is, including their own toolchain and compiler options. A dash means no module attribution was available. The files were measured and exercised in Chromium.'
      : 'Krausest was skipped because the sibling dist directory had no built app.',
    '',
    ...krausest.filter(row => row.attribution).map(row => '- ' + row.framework + ' attribution — ' + row.attribution + '.'),
    '',
    ...section('Method and provenance', [
      '- Each matched app is a separate Vite production build targeting ES2022 with esbuild minification and default module preload support. What uses the workspace compiler and aliases from the krausest harness. Solid 1 uses the 1.x Babel preset and Solid 2 uses the stable ' + code('@solidjs/babel-plugin') + ' 2.x compiler. React uses Vite’s automatic JSX transform. The compiler-specific defaults are part of each measured stack.',
      '- Plain JS asset byte counts exclude HTML, CSS and hidden maps. Gzip level 9 and Brotli quality 11 run independently on each complete JS asset. Framework overhead is the sum of attributed minified spans owned by runtime source packages, including dependencies. Compression is measured for whole assets.',
      '- Rollup ' + code('renderedLength') + ' counts characters after tree-shaking and before minification. Minified bytes attribute UTF-8 spans between source map segments to their mapped source. Synthetic code, uncovered parts and line terminators appear in the unmapped count. Per-module and per-symbol values are estimates based on generated mappings. The raw JS and compressed asset sizes are exact.',
      '- Every listed app passed a production smoke test with the root Playwright dependency. Todo checks add, toggle, count, filter, keyed row identity and removal. Krausest checks create, update, remove and clear.',
      '- When the existing Krausest What and Solid 2 assets have no maps, the runner attempts to rebuild them with hidden maps and the sibling toolchain. The original artifacts supply all headline sizes. The reports use the rebuilt attribution only when all JS asset hashes match.',
      '- Both Solid majors emitted mapped bytes from their expected production browser modules. The script asserts the package versions and rejects the other major’s modules. ' + code('results.json') + ' includes the verified module paths and per-asset SHA-256 digests.',
      '- Machine ' + code([machine.platform, machine.release, machine.arch, machine.cpu].join(' / ')) + '.',
      '- Toolchain ' + Object.entries(toolchain).map(([name, version]) => code(name + ' ' + version)).join(', ') + '.',
      '- What working-tree build at ' + code(whatRevision) + '. ' + (whatSourceChanges
        ? 'Local core or compiler changes were present. See ' + code('results.json') + '.'
        : 'Git reported no local core or compiler changes.'),
    ]),
    ...(packages.length ? section('Krausest package provenance', [
      'These are the sibling harness’s own package-level, pre-minifier Rollup totals. The module tables below give mapped minified bytes where available.',
      '',
      ...table(['Framework', 'Package', 'Rendered length'], packages),
    ]) : []),
    ...section('What and Solid 2 module composition', composition(results)),
    ...section('What’s largest retained runtime regions', whatComposition(hello, todo, results)),
    ...section('What hello runtime exports', [
      'The table covers surviving definitions from What source modules. Re-exports are counted at their defining module. An export can remain because internal code calls it, even when the app imports a different symbol.',
      '',
      ...table(['Definition', 'Source', 'Minified bytes', 'Why retained'], helloExports.map(row => [
        code(row.name), sourceLink(row.source, row.line), row.minifiedBytes, row.reason,
      ])),
      'Other exports from the same included modules were removed, including ' + absentExports + '.',
    ]),
    ...section('What production output', productionOutput(hello, todo)),
  ];
  await writeFile(path.join(here, 'RESULTS.md'), lines.join('\n'));
}
