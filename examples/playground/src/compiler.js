/**
 * In-browser compilation pipeline.
 *
 * Uses @babel/standalone with the What Framework babel plugin to transform
 * user JSX into compiled JS that uses the framework's fine-grained rendering
 * primitives (template, insert, effect, etc.).
 */
import * as Babel from '@babel/standalone';
import whatBabelPlugin from 'virtual:what-babel-plugin';

// Register the What Framework plugin with @babel/standalone
Babel.registerPlugin('what-framework', whatBabelPlugin);

/**
 * Compile user JSX code to executable JS.
 *
 * @param {string} code - User-authored JSX source
 * @returns {{ ok: true, code: string } | { ok: false, error: string, line?: number, column?: number }}
 */
export function compile(code) {
  try {
    const result = Babel.transform(code, {
      filename: 'playground.jsx',
      presets: [],
      plugins: ['syntax-jsx', 'what-framework'],
      // We don't want module-level transforms; the compiled code will run
      // as a plain script inside the iframe with globals provided.
      sourceType: 'module',
    });

    if (!result || !result.code) {
      return { ok: false, error: 'Compilation produced no output.' };
    }

    return { ok: true, code: result.code };
  } catch (err) {
    const loc = err.loc || {};
    return {
      ok: false,
      error: err.message,
      line: loc.line,
      column: loc.column,
    };
  }
}
