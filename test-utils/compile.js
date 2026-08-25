// Shared JSX compilation for compiler tests.
//
// 18 test files were calling transformSync with the Babel plugin directly and
// 14 of them defined a local `compile(source)` to do it. Four spellings of the
// same function were in circulation, differing only in `filename` ('test.jsx'
// vs 'fixture.jsx') and in whether they returned `.code` or `?.code || ''` —
// differences that mean nothing to the test but that quietly force every new
// test file to pick one.
//
//   import { compileJSX } from '../../../test-utils/compile.js';
//   const out = compileJSX('<div>{count()}</div>');

import { transformSync } from '@babel/core';

import babelPlugin from '../packages/compiler/src/babel-plugin.js';

/**
 * Compile JSX with the What plugin and return the emitted code.
 *
 * @param {string} source
 * @param {object} [options]
 * @param {boolean} [options.production] compile as a production build
 * @param {string} [options.filename] shown in error messages and used for
 *   the server-action id derivation, so it matters for those tests
 * @param {object} [options.pluginOptions] merged over `{ production }`
 * @returns {string} the emitted code, or '' when Babel returns no result
 */
export function compileJSX(source, options = {}) {
  const { production = false, filename = 'fixture.jsx', pluginOptions = {} } = options;
  const result = transformSync(source, {
    filename,
    plugins: [[babelPlugin, { production, ...pluginOptions }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  });
  return result?.code || '';
}
