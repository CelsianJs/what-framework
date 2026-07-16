import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const CLIENT_ACTION_ENTRY = `
  import {
    action,
    formAction,
    useAction,
    useFormAction,
    useOptimistic,
    useMutation,
  } from 'what-framework/server';

  globalThis.__whatClientActionSurface = [
    action,
    formAction,
    useAction,
    useFormAction,
    useOptimistic,
    useMutation,
  ];
`;

describe('what-framework/server browser bundle', () => {
  const cases = [
    { label: 'source', conditions: undefined, requiresBuild: false },
    { label: 'production', conditions: ['browser', 'production'], requiresBuild: true },
  ];

  for (const bundleCase of cases) it(`keeps the ${bundleCase.label} client server-action surface free of Node builtins`, async (t) => {
    if (bundleCase.requiresBuild && !existsSync(new URL('../dist/server.min.js', import.meta.url))) {
      t.skip('dist/ not built; production bundle is checked after npm run build');
      return;
    }
    const result = await build({
      stdin: {
        contents: CLIENT_ACTION_ENTRY,
        resolveDir: process.cwd(),
        sourcefile: 'client-server-actions.js',
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      ...(bundleCase.conditions ? { conditions: bundleCase.conditions } : {}),
      metafile: true,
      treeShaking: true,
      write: false,
      logLevel: 'silent',
    });

    const output = result.outputFiles.map((file) => file.text).join('\n');
    const bundledInputs = Object.keys(result.metafile.inputs);

    assert.doesNotMatch(output, /\bnode:[a-z_/-]+|AsyncLocalStorage/);
    assert.equal(
      bundledInputs.some((input) =>
        /packages[/\\]server[/\\](?:src[/\\](?:node\.js|adapter[/\\](?:node|static|vercel)\.js)|dist[/\\]node(?:\.min)?\.js)$/.test(input)
      ),
      false,
      `browser bundle retained a Node-only server entry:\n${bundledInputs.join('\n')}`
    );
  });
});
