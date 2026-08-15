// Regression tests for extractPageConfig's object-literal parser (backlog #47).
//
// extractPageConfig used to munge the matched text with three blind regexes
// (quote swap, bare-key quoting, trailing-comma collapse) and then JSON.parse
// the result. Every one of those regexes is blind to string boundaries, so a
// perfectly valid config could be corrupted into invalid JSON and thrown away
// silently: the catch returned { mode: 'client' }. That is the value the
// generated routes module records in `pageModes`, so a page that declared
// `mode: 'static'` alongside e.g. a `vary` list was quietly demoted to a
// client-rendered route with no error anywhere.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPageConfig } from '../src/file-router.js';

/**
 * Run fn with console.warn captured. Returns the collected warning strings so a
 * test can assert on loudness (the difference between "no config" and "your
 * config was thrown away" has to be observable somewhere).
 */
function captureWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

describe('extractPageConfig — values containing parser-significant characters', () => {
  it('keeps a colon that lives inside a string value (vary: [\'cookie:theme\'])', () => {
    // The bare-key regex /(\w+)\s*:/g was applied to the WHOLE object, so the
    // colon in the cache vary declaration was treated as a key separator and
    // produced ["cookie":theme"].
    const config = extractPageConfig(`
      export const page = {
        mode: 'static',
        vary: ['cookie:theme'],
      };
      export default function Page() {}
    `);

    assert.equal(config.mode, 'static');
    assert.deepEqual(config.vary, ['cookie:theme']);
  });

  it('keeps a colon inside a plain string value', () => {
    const config = extractPageConfig(`
      export const page = { mode: 'server', vary: 'cookie:session' };
    `);

    assert.equal(config.mode, 'server');
    assert.equal(config.vary, 'cookie:session');
  });

  it('keeps // inside a string value (an absolute URL)', () => {
    // Comments were stripped with /\/\/[^\n]*/g, which happily ate the rest of
    // the line starting at the "//" in "https://".
    const config = extractPageConfig(`
      export const page = {
        mode: 'static',
        canonical: 'https://whatfw.com/docs/routing',
      };
    `);

    assert.equal(config.mode, 'static');
    assert.equal(config.canonical, 'https://whatfw.com/docs/routing');
  });

  it('keeps an apostrophe inside a double-quoted string', () => {
    // .replace(/'/g, '"') turned "What's new" into "What"s new".
    const config = extractPageConfig(`
      export const page = { mode: "static", title: "What's new" };
    `);

    assert.equal(config.mode, 'static');
    assert.equal(config.title, "What's new");
  });

  it('keeps a brace inside a string value', () => {
    // The extraction regex was /\{[^}]*\}/, so the first "}" in a string value
    // truncated the literal.
    const config = extractPageConfig(`
      export const page = { mode: 'server', template: 'a } b' };
    `);

    assert.equal(config.mode, 'server');
    assert.equal(config.template, 'a } b');
  });
});

describe('extractPageConfig — comments and trailing commas', () => {
  it('handles a trailing comma followed by a line comment on the last property', () => {
    // Comments were stripped AFTER the trailing-comma collapse, so ",\s*}" never
    // matched and JSON.parse choked on the dangling comma.
    const config = extractPageConfig(`
      export const page = {
        mode: 'static',
        revalidate: 60, // seconds
      };
    `);

    assert.equal(config.mode, 'static');
    assert.equal(config.revalidate, 60);
  });

  it('handles a line comment between properties', () => {
    const config = extractPageConfig(`
      export const page = {
        // rendered at build time
        mode: 'static',
        // revalidate every minute
        revalidate: 60
      };
    `);

    assert.equal(config.mode, 'static');
    assert.equal(config.revalidate, 60);
  });

  it('handles block comments inside the literal', () => {
    const config = extractPageConfig(`
      export const page = {
        mode: /* build time */ 'static',
        revalidate: 60, /* seconds */
      };
    `);

    assert.equal(config.mode, 'static');
    assert.equal(config.revalidate, 60);
  });

  it('handles a trailing comma inside an array', () => {
    const config = extractPageConfig(`
      export const page = {
        mode: 'static',
        vary: [
          'cookie:theme',
          'accept-language',
        ],
      };
    `);

    assert.deepEqual(config.vary, ['cookie:theme', 'accept-language']);
  });
});

describe('extractPageConfig — nested structures', () => {
  it('parses a nested object', () => {
    const config = extractPageConfig(`
      export const page = {
        mode: 'static',
        meta: { title: 'Docs', description: 'How routing works' },
      };
    `);

    assert.equal(config.mode, 'static');
    assert.deepEqual(config.meta, { title: 'Docs', description: 'How routing works' });
  });

  it('parses nested objects inside arrays', () => {
    const config = extractPageConfig(`
      export const page = {
        mode: 'hybrid',
        islands: [
          { name: 'Cart', hydrate: 'visible' },
          { name: 'Search', hydrate: 'idle' },
        ],
      };
    `);

    assert.equal(config.mode, 'hybrid');
    assert.deepEqual(config.islands, [
      { name: 'Cart', hydrate: 'visible' },
      { name: 'Search', hydrate: 'idle' },
    ]);
  });

  it('parses booleans, numbers and null', () => {
    const config = extractPageConfig(`
      export const page = {
        mode: 'server',
        prerender: false,
        revalidate: 0,
        maxAge: 3.5,
        fallback: null,
        streaming: true,
      };
    `);

    assert.equal(config.prerender, false);
    assert.equal(config.revalidate, 0);
    assert.equal(config.maxAge, 3.5);
    assert.equal(config.fallback, null);
    assert.equal(config.streaming, true);
  });
});

describe('extractPageConfig — failure is loud, absence is silent', () => {
  it('warns when a config is present but cannot be parsed', () => {
    let config;
    const warnings = captureWarnings(() => {
      config = extractPageConfig(`
        export const page = { mode: computeMode() };
      `);
    });

    assert.equal(config.mode, 'client', 'still falls back so the build keeps going');
    assert.equal(warnings.length, 1, 'a thrown-away config must not be silent');
    assert.match(warnings[0], /page/i);
  });

  it('names the file in the warning when one is supplied', () => {
    const warnings = captureWarnings(() => {
      extractPageConfig(
        `export const page = { mode: 'static', tags: [oops] };`,
        { filePath: '/app/src/pages/blog/[slug].jsx' },
      );
    });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\/app\/src\/pages\/blog\/\[slug\]\.jsx/);
  });

  it('stays silent when the page has no config at all', () => {
    let config;
    const warnings = captureWarnings(() => {
      config = extractPageConfig('export default function Home() {}');
    });

    assert.deepEqual(config, { mode: 'client' });
    assert.deepEqual(warnings, [], 'no config is the common case, not an error');
  });

  it('stays silent for a valid config', () => {
    const warnings = captureWarnings(() => {
      extractPageConfig(`export const page = { mode: 'static', vary: ['cookie:theme'] };`);
    });

    assert.deepEqual(warnings, []);
  });
});

describe('extractPageConfig — previously working shapes still work', () => {
  it('single quotes, double quotes and empty objects', () => {
    assert.equal(extractPageConfig(`export const page = { mode: 'server' };`).mode, 'server');
    assert.equal(extractPageConfig(`export const page = { mode: "hybrid" };`).mode, 'hybrid');
    assert.equal(extractPageConfig(`export const page = {};`).mode, 'client');
  });

  it('ignores an unrelated export whose name starts with "page"', () => {
    const config = extractPageConfig(`
      export const pageTitle = { mode: 'static' };
      export default function Home() {}
    `);

    assert.equal(config.mode, 'client');
  });
});
