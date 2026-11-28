import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import babelPlugin from '../src/babel-plugin.js';
import whatVitePlugin from '../src/vite-plugin.js';

function compile(source, filename = '/workspace/src/actions/users.ts') {
  const result = transformSync(source, {
    filename,
    plugins: [[babelPlugin, { production: false, projectRoot: '/workspace' }]],
    parserOpts: { plugins: ['typescript'] },
    configFile: false,
    babelrc: false,
    compact: false,
  });
  return result?.code || '';
}

function generatedActionId(code) {
  const match = code.match(/id:\s*["'](wa1_[a-z0-9]+)["']/);
  assert.ok(match, `expected a compiler-generated action ID in:\n${code}`);
  return match[1];
}

describe('stable server action IDs', () => {
  it('matches across independently initialized client and server compilers', () => {
    const source = `
      import { action } from 'what-framework/server';
      export const saveUser = action(async (user) => user);
    `;

    const clientBundle = compile(source);
    const serverBundle = compile(source);

    assert.equal(generatedActionId(clientBundle), generatedActionId(serverBundle));
  });

  it('derives IDs from both the project-relative path and local binding', () => {
    const saveUser = generatedActionId(compile(`
      import { action } from 'what-framework/server';
      export const saveUser = action(async () => true);
    `));
    const deleteUser = generatedActionId(compile(`
      import { action } from 'what-framework/server';
      export const deleteUser = action(async () => true);
    `));
    const otherFile = generatedActionId(compile(`
      import { action } from 'what-framework/server';
      export const saveUser = action(async () => true);
    `, '/workspace/src/actions/admin.ts'));

    assert.notEqual(saveUser, deleteUser);
    assert.notEqual(saveUser, otherFile);
  });

  it('keeps an explicit action ID authoritative', () => {
    const code = compile(`
      import { action } from 'what-framework/server';
      export const saveUser = action(async () => true, { id: 'public-save-user' });
    `);

    assert.match(code, /id:\s*["']public-save-user["']/);
    assert.doesNotMatch(code, /wa1_/);
  });

  it('lets dynamic options override the generated default ID', () => {
    const code = compile(`
      import { action } from 'what-framework/server';
      const options = { id: 'runtime-explicit' };
      export const saveUser = action(async () => true, options);
      export const deleteUser = action(async () => true, { ...options });
    `);

    assert.match(code, /saveUser = action\([\s\S]*?\{\s*id:\s*["']wa1_[a-z0-9]+["'],\s*\.\.\.options\s*\}/);
    assert.match(code, /deleteUser = action\([\s\S]*?\{\s*id:\s*["']wa1_[a-z0-9]+["'],\s*\.\.\.options\s*\}/);
  });

  it('fails a build when two actions declare the same explicit ID', () => {
    assert.throws(() => compile(`
      import { action } from 'what-framework/server';
      export const one = action(async () => 1, { id: 'duplicate' });
      export const two = action(async () => 2, { id: 'duplicate' });
    `), /Duplicate server action ID "duplicate".*one.*two/s);
  });

  it('transforms non-JSX action modules and detects cross-file collisions in Vite', () => {
    const plugin = whatVitePlugin();
    plugin.configResolved({ root: '/workspace', command: 'build' });
    const first = plugin.transform(`
      import { action } from 'what-server/actions';
      export const one = action(async () => 1, { id: 'shared-explicit' });
    `, '/workspace/src/actions/one.ts');

    assert.ok(first?.code, 'a .ts action module should be transformed without JSX');
    assert.throws(() => plugin.transform(`
      import { action } from 'what-server/actions';
      export const two = action(async () => 2, { id: 'shared-explicit' });
    `, '/workspace/src/actions/two.ts'), /Duplicate server action ID "shared-explicit"/);
  });

  it('releases old per-file IDs when Vite hot-updates an action module', () => {
    const plugin = whatVitePlugin();
    plugin.configResolved({ root: '/workspace', command: 'serve' });
    plugin.transform(`
      import { action } from 'what-framework/server';
      export const one = action(async () => 1, { id: 'before-hmr' });
    `, '/workspace/src/actions/one.ts');
    plugin.transform(`
      import { action } from 'what-framework/server';
      export const one = action(async () => 1, { id: 'after-hmr' });
    `, '/workspace/src/actions/one.ts?t=123');

    assert.doesNotThrow(() => plugin.transform(`
      import { action } from 'what-framework/server';
      export const two = action(async () => 2, { id: 'before-hmr' });
    `, '/workspace/src/actions/two.ts'));
  });

  it('releases a file ID when its last server action import is removed', () => {
    const plugin = whatVitePlugin();
    plugin.configResolved({ root: '/workspace', command: 'serve' });
    plugin.transform(`
      import { action } from 'what-framework/server';
      export const one = action(async () => 1, { id: 'removed-action' });
    `, '/workspace/src/actions/one.ts');

    assert.equal(
      plugin.transform('export const one = async () => 1;', '/workspace/src/actions/one.ts?t=456'),
      null
    );
    assert.doesNotThrow(() => plugin.transform(`
      import { action } from 'what-framework/server';
      export const two = action(async () => 2, { id: 'removed-action' });
    `, '/workspace/src/actions/two.ts'));
  });

  it('releases a file ID when Vite reports that the module was unlinked', () => {
    const plugin = whatVitePlugin();
    let onUnlink;
    const devServer = {
      watcher: {
        on(event, callback) {
          if (event === 'unlink') onUnlink = callback;
        },
      },
      moduleGraph: {
        getModuleById() { return null; },
        invalidateModule() {},
      },
      ws: { send() {} },
    };
    plugin.configResolved({ root: '/workspace', command: 'serve' });
    plugin.configureServer(devServer);
    plugin.transform(`
      import { action } from 'what-framework/server';
      export const one = action(async () => 1, { id: 'unlinked-action' });
    `, '/workspace/src/actions/one.ts');

    assert.equal(typeof onUnlink, 'function');
    onUnlink('/workspace/src/actions/one.ts');
    assert.doesNotThrow(() => plugin.transform(`
      import { action } from 'what-framework/server';
      export const two = action(async () => 2, { id: 'unlinked-action' });
    `, '/workspace/src/actions/two.ts'));
  });
});

describe('the binding a server action ID is derived from', () => {
  const quiet = (fn) => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try { return { code: fn(), warnings }; } finally { console.warn = original; }
  };
  const ids = (code) => [...code.matchAll(/id:\s*["'](wa1_[a-z0-9]+)["']/g)].map((m) => m[1]);

  it('an assignment names it as a declaration does', () => {
    const assigned = generatedActionId(compile(`
      import { action } from 'what-framework/server';
      let saveUser;
      saveUser = action(async () => true);
    `));
    const declared = generatedActionId(compile(`
      import { action } from 'what-framework/server';
      export const saveUser = action(async () => true);
    `));
    assert.equal(assigned, declared);
  });

  it('an object property names it by its key, an identifier or a string', () => {
    const code = compile(`
      import { action } from 'what-framework/server';
      export const actions = { save: action(async () => 1), 'remove-user': action(async () => 2) };
    `);
    const [save, remove] = ids(code);
    assert.ok(save && remove && save !== remove);
    assert.equal(save, generatedActionId(compile(`
      import { action } from 'what-framework/server';
      export const save = action(async () => 1);
    `)));
  });

  it('an action with no binding gets no ID and a warning that says how to give it one', () => {
    const { code, warnings } = quiet(() => compile(`
      import { action } from 'what-framework/server';
      register(action(async () => true));
    `));
    assert.deepEqual(ids(code), []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Could not derive a stable server action ID at src\/actions\/users\.ts:3\. .*pass \{ id \} explicitly/);
  });

  it('an action with no binding and an explicit ID is registered, without the warning', () => {
    const { warnings } = quiet(() => compile(`
      import { action } from 'what-framework/server';
      register(action(async () => true, { id: 'registered' }));
    `));
    assert.deepEqual(warnings, []);
    assert.throws(() => quiet(() => compile(`
      import { action } from 'what-framework/server';
      register(action(async () => 1, { id: 'twice' }));
      register(action(async () => 2, { id: 'twice' }));
    `)), /Duplicate server action ID "twice"/);
  });

  it('a namespace import\'s action() is one too', () => {
    const code = compile(`
      import * as server from 'what-framework/server';
      export const saveUser = server.action(async () => true);
    `);
    assert.equal(generatedActionId(code), generatedActionId(compile(`
      import { action } from 'what-framework/server';
      export const saveUser = action(async () => true);
    `)));
  });
});
