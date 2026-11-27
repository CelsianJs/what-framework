// A field may be named like a member of Object.prototype: `constructor`,
// `toString`, `valueOf`. Each registers, takes edits, validates, resets
// and submits like any other name; its default is its own entry in
// defaultValues, never the inherited member. A `__proto__` name still
// writes nothing into the values or Object.prototype.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { useForm, simpleResolver, zodResolver, yupResolver, rules } = await import('../src/form.js');

const typed = (form, name, value) => form.register(name).onchange({ type: 'input', target: { type: 'text', value } });
const tick = () => new Promise((r) => setTimeout(r, 0));

// The field's own value: values.constructor without one is Object.
const ownValue = (values, name) => (Object.hasOwn(values, name) ? values[name] : undefined);

// zod's shape: parseAsync throws an error carrying `issues`.
const requiredSchema = (name) => ({
  async parseAsync(values) {
    if (!ownValue(values, name)) throw Object.assign(new Error('invalid'), { issues: [{ code: 'too_small', path: [name], message: 'Enter it' }] });
    return values;
  },
});

// yup's shape: validate rejects with a ValidationError carrying `inner`.
const requiredYupSchema = (name) => ({
  async validate(values) {
    if (!ownValue(values, name)) throw Object.assign(new Error('invalid'), { name: 'ValidationError', inner: [{ path: name, type: 'required', message: 'Enter it' }] });
    return values;
  },
});

for (const name of ['constructor', 'toString', 'valueOf']) {
  describe(`a field named ${name}`, () => {
    it('starts from its own default, or empty without one', () => {
      const form = useForm({ defaultValues: { [name]: 'd' } });
      assert.equal(form.register(name).value, 'd');
      assert.equal(form.getValue(name), 'd');
      const bare = useForm();
      assert.equal(bare.getValue(name), '');
      assert.equal(bare.watch(name)(), '');
      assert.deepEqual(bare.formState.values, {});
      assert.equal(bare.register(name).value, '');
      assert.deepEqual(bare.formState.values, { [name]: '' });
    });

    it('takes edits, and the values, dirtyFields and touched show them', () => {
      const form = useForm();
      typed(form, name, 'x');
      typed(form, name, 'xy');
      form.register(name).onBlur();
      assert.equal(form.getValue(name), 'xy');
      assert.deepEqual(form.formState.values, { [name]: 'xy' });
      assert.deepEqual(form.formState.dirtyFields(), { [name]: true });
      assert.deepEqual(form.formState.touched, { [name]: true });
      form.setValue(name, 'z');
      assert.equal(form.watch(name)(), 'z');
    });

    it('validates with simpleResolver, on its own and with the whole form', async () => {
      const form = useForm({ mode: 'onChange', resolver: simpleResolver({ [name]: [rules.required('Required')] }) });
      typed(form, name, 'x');
      await tick();
      assert.equal(form.formState.error(name), null);
      assert.deepEqual(form.formState.errors, {});
      assert.equal(form.formState.isValid(), true);
      typed(form, name, '');
      await tick();
      assert.equal(form.formState.error(name)?.message, 'Required');
      assert.deepEqual(Object.keys(form.formState.errors), [name]);
      assert.equal(await form.validate(), false);
      form.setValue(name, 'ok');
      assert.equal(await form.validate(), true);
      assert.equal(form.formState.error(name), null);
    });

    it('validates with zodResolver and yupResolver', async () => {
      for (const resolver of [zodResolver(requiredSchema(name)), yupResolver(requiredYupSchema(name))]) {
        const form = useForm({ resolver });
        let invalid;
        await form.handleSubmit(() => assert.fail('submitted'), (errors) => { invalid = errors; })();
        assert.deepEqual(Object.keys(invalid), [name]);
        assert.equal(form.formState.error(name)?.message, 'Enter it');
        typed(form, name, 'x');
        let submitted;
        await form.handleSubmit((values) => { submitted = values; })();
        assert.deepEqual(submitted, { [name]: 'x' });
        assert.equal(form.formState.error(name), null);
      }
    });

    it('resets to its default, and to the values reset is given', () => {
      const form = useForm({ defaultValues: { [name]: 'd' } });
      typed(form, name, 'x');
      form.reset();
      assert.equal(form.getValue(name), 'd');
      assert.deepEqual(form.formState.dirtyFields(), {});
      form.reset({ [name]: 'n' });
      assert.equal(form.getValue(name), 'n');
      const bare = useForm();
      typed(bare, name, 'x');
      bare.reset();
      assert.equal(bare.getValue(name), '');
    });

    it('submits its value, and unregister removes it', async () => {
      const form = useForm({ defaultValues: { other: 1 } });
      typed(form, name, 'x');
      let submitted;
      await form.handleSubmit((values) => { submitted = values; })();
      assert.deepEqual(submitted, { other: 1, [name]: 'x' });
      form.unregister(name);
      assert.deepEqual(form.formState.values, { other: 1 });
      typed(form, `${name}.inner`, 'y');
      form.unregister(`${name}.inner`);
      assert.deepEqual(form.formState.values, { other: 1 });
    });
  });
}

describe('a field named __proto__', () => {
  it('writes nothing into the values or Object.prototype', async () => {
    const form = useForm({ defaultValues: { owner: 'Ann' } });
    typed(form, '__proto__', 'yes');
    form.setValue('__proto__', { polluted: 'yes' });
    typed(form, 'a.__proto__.polluted', 'yes');
    const values = form.formState.values;
    await form.handleSubmit(() => {})();
    const leaked = ({}).polluted;
    delete Object.prototype.polluted;
    assert.equal(leaked, undefined);
    assert.deepEqual(values, { owner: 'Ann' });
    assert.equal(Object.getPrototypeOf(values), Object.prototype);
  });
});
