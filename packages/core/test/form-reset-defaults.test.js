// reset(values) makes those values the form's defaults, as React Hook Form's
// reset does: dirtyFields is measured from them, a later reset() goes back
// to them, and a field registered afterwards starts from them. Before,
// dirtyFields kept measuring from the defaults useForm was created with, so
// a form filled from fetched data reported every field it filled as changed
// while isDirty() said nothing was (the wizard smoke app: "Start from my
// current policy" showed "6 changes from your current policy" at once).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { useForm } = await import('../src/form.js');
const { flushSync } = await import('../src/reactive.js');

const typed = (form, name, value) => form.register(name).onchange({ type: 'input', target: { type: 'text', value } });

describe('reset(values)', () => {
  it('measures dirtyFields from the values it was given', () => {
    const form = useForm({ defaultValues: { limit: '', deductible: '' } });
    form.register('limit');
    form.register('deductible');
    form.reset({ limit: '250/500', deductible: '1000' });
    flushSync();
    assert.equal(form.formState.isDirty(), false);
    assert.deepEqual(form.formState.dirtyFields(), {});
    typed(form, 'deductible', '500');
    assert.deepEqual(form.formState.dirtyFields(), { deductible: true });
    typed(form, 'deductible', '1000');
    assert.deepEqual(form.formState.dirtyFields(), {});
  });

  it('a field that already held the value it is reset to stops being dirty', () => {
    const form = useForm({ defaultValues: { limit: '' } });
    typed(form, 'limit', '250/500');
    const dirty = form.formState.dirtyFields;
    assert.deepEqual(dirty(), { limit: true });
    form.reset({ limit: '250/500' });
    assert.deepEqual(dirty(), {});
  });

  it('a later reset() goes back to them, and a field registered after starts from them', () => {
    const form = useForm({ defaultValues: { limit: '', glass: false } });
    form.register('limit');
    form.reset({ limit: '250/500', glass: true });
    typed(form, 'limit', '50/100');
    form.reset();
    assert.equal(form.getValue('limit'), '250/500');
    assert.equal(form.getValue('glass'), true);
    assert.deepEqual(form.formState.values, { limit: '250/500', glass: true });
  });

  it('reset() with no values goes back to the defaults useForm was given', () => {
    const form = useForm({ defaultValues: { limit: '100/300' } });
    typed(form, 'limit', '50/100');
    form.reset();
    assert.equal(form.getValue('limit'), '100/300');
    assert.deepEqual(form.formState.dirtyFields(), {});
  });
});
