// `const { register } = useForm()` then `<input {...register('email')} />`,
// the idiom every form guide shows: the spread follows the field, so
// setValue and reset show in the input (docs/API.md, register in compiled
// JSX). register()'s props hold `value` (or `checked`) as a getter, and a
// spread binds a getter live only on a props object What marks as its own;
// register() did not mark its object, so a spread of a destructured
// `register(...)` call, which the compiler reads once, wrote the value it
// had at mount and never again (`form.register(...)` happened to be read
// again). In the wizard smoke app, "Start from my current policy" called
// reset() with the fetched policy: the form held a $1,000 deductible while
// its select still showed $500.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { mount, flushSync } = await import('what-framework');

const mod = await loadCompiled(`
  import { useForm } from 'what-framework/form';
  export function make() {
    return useForm({ defaultValues: { limit: '500', title: 'start', glass: false, notes: 'n' } });
  }
  export function Destructured({ form }) {
    const { register } = form;
    return <div>
      <select class="limit" {...register('limit')}><option value="250">250</option><option value="500">500</option><option value="1000">1000</option></select>
      <input class="title" {...register('title')} />
      <input class="glass" type="checkbox" {...register('glass', { type: 'checkbox' })} />
      <textarea class="notes" {...register('notes')} />
    </div>;
  }
  export function Member({ form }) {
    return <input class="title" {...form.register('title')} />;
  }
`);

function render(View) {
  const form = mod.make();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stop = mount(View({ form }), host);
  flushSync();
  const read = () => ({
    limit: host.querySelector('.limit')?.value,
    title: host.querySelector('.title').value,
    glass: host.querySelector('.glass')?.checked,
    notes: host.querySelector('.notes')?.value,
  });
  return { form, host, read, stop: () => { stop(); host.remove(); } };
}

describe('a spread of register() in compiled JSX', () => {
  it('a destructured register follows setValue', () => {
    const { form, read, stop } = render(mod.Destructured);
    form.setValue('limit', '1000');
    form.setValue('title', 'set');
    form.setValue('glass', true);
    form.setValue('notes', 'more');
    flushSync();
    assert.deepEqual(read(), { limit: '1000', title: 'set', glass: true, notes: 'more' });
    stop();
  });

  it('a destructured register follows reset with values', () => {
    const { form, read, stop } = render(mod.Destructured);
    form.reset({ limit: '250', title: 'loaded', glass: true, notes: 'from the server' });
    flushSync();
    assert.deepEqual(read(), { limit: '250', title: 'loaded', glass: true, notes: 'from the server' });
    form.setValue('title', 'edited');
    form.reset();
    flushSync();
    assert.equal(read().title, 'loaded', 'reset() goes back to the values the last reset was given');
    stop();
  });

  it('typing still reaches the form, and form.register(...) follows too', () => {
    const { form, host, read, stop } = render(mod.Member);
    const input = host.querySelector('.title');
    input.value = 'typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    assert.equal(form.getValue('title'), 'typed');
    form.setValue('title', 'set');
    flushSync();
    assert.equal(read().title, 'set');
    stop();
  });
});
