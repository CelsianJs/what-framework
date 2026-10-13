import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const positive = `
  import { signal, h, mount, lazy, memo, type Component } from 'what-framework';
  import { Router, type RouteConfig, type RouteMiddleware } from 'what-framework/router';
  import type { RouteMiddleware as CoreRouteMiddleware } from 'what-router';
  const visible = signal(true);
  const title = signal<string | undefined>('Ready');
  const nullable = signal<string | null>('Ready');
  const Gate: Component<{ label: string }> = ({ label }) =>
    () => visible() ? <div title={title}>{label}</div> : null;
  const Text = () => 'text';
  const Count = () => 42;
  const Empty = () => undefined;
  const Flag = () => false;
  const List = () => [<span />, 'text', null];
  const Nested = () => () => () => <Gate label="nested" />;
  const Children: Component = ({ children }) => children;
  const Deferred = lazy(async () => ({ default: Gate }));
  const MemoGate = memo(Gate);
  const guard: RouteMiddleware = ({ path, params }) => path === '/private' ? '/login' : true;
  const audit: RouteMiddleware = () => {};
  const coreGuard: CoreRouteMiddleware = guard;
  const routes: RouteConfig[] = [{ path: '/', component: GatePage, middleware: [coreGuard, audit] }];
  function GatePage() { return () => <Gate label="page" />; }
  export const app = <Children><Text /><Count /><Empty /><Flag /><List /><Nested />
    <Deferred label="deferred" /><MemoGate label="memo" /><Router routes={routes} />
    <button title={nullable} disabled={() => undefined} />
    <input value={() => undefined} placeholder={null} />
    <a href={() => undefined}>link</a><svg fill={() => null} />
  </Children>;
  mount(h(Gate, { label: 'mounted' }), document.body);
`;

const negative = {
  'object.tsx': `const Bad = () => ({ invalid: true }); export const app = <Bad />;`,
  'promise.tsx': `const Bad = async () => <div />; export const app = <Bad />;`,
  'thunk-object.tsx': `const Bad = () => () => ({ invalid: true }); export const app = <Bad />;`,
  'thunk-promise.tsx': `const Bad = () => async () => <div />; export const app = <Bad />;`,
  'missing-props.tsx': `const Gate = (props: { label: string }) => () => <div>{props.label}</div>; export const app = <Gate />;`,
  'wrong-props.tsx': `const Gate = (props: { label: string }) => () => <div>{props.label}</div>; export const app = <Gate label={123} />;`,
  'unknown-props.tsx': `const Gate = (props: { label: string }) => () => <div>{props.label}</div>; export const app = <Gate label="ok" typo />;`,
  'typed-object.tsx': `import type { Component } from 'what-framework'; export const Bad: Component = () => ({ invalid: true });`,
  'attribute.tsx': `export const app = <button title={() => 123} />;`,
  'attribute-object.tsx': `export const app = <button title={() => ({ invalid: true })} />;`,
  'event.tsx': `export const app = <button onClick="invalid" />;`,
  'async-middleware.tsx': `import type { RouteMiddleware } from 'what-framework/router'; export const guard: RouteMiddleware = async () => false;`,
  'async-core-middleware.tsx': `import type { RouteMiddleware } from 'what-router'; export const guard: RouteMiddleware = async () => false;`,
  'invalid-middleware.tsx': `import type { RouteMiddleware } from 'what-framework/router'; export const guard: RouteMiddleware = () => ({ redirect: '/login' });`,
};

for (const [source, jsx] of [
  ['what-framework', 'react-jsx'],
  ['what-core', 'react-jsx'],
  ['what-framework', 'react-jsxdev'],
  ['what-framework', 'preserve'],
]) {
  test(`reactive component contracts remain precise: ${source}, ${jsx}`, () => {
    const diagnostics = tscDiagnose({
      files: { 'positive.tsx': positive, ...negative },
      writeRoot: HERE,
      compilerOptions: { jsx, jsxImportSource: source, skipLibCheck: false },
    });
    const failures = diagnostics.filter(d => !Object.hasOwn(negative, basename(d.file)));
    assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
    for (const name of Object.keys(negative)) {
      assert.ok(diagnostics.some(d => basename(d.file) === name), `${name} must be rejected`);
    }
  });
}
