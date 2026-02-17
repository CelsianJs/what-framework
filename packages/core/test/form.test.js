// Tests for What Framework - Form Utilities
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { useForm, useField, rules, simpleResolver, zodResolver, yupResolver, ErrorMessage } = await import('../src/form.js');

describe('form utilities', () => {
  describe('rules', () => {
    describe('required', () => {
      const validate = rules.required();

      it('should fail for empty string', () => {
        assert.equal(validate(''), 'This field is required');
      });

      it('should fail for null', () => {
        assert.equal(validate(null), 'This field is required');
      });

      it('should fail for undefined', () => {
        assert.equal(validate(undefined), 'This field is required');
      });

      it('should pass for non-empty string', () => {
        assert.equal(validate('hello'), undefined);
      });

      it('should support custom message', () => {
        const custom = rules.required('Please fill this');
        assert.equal(custom(''), 'Please fill this');
      });
    });

    describe('minLength', () => {
      const validate = rules.minLength(3);

      it('should fail for short string', () => {
        assert.equal(validate('ab'), 'Must be at least 3 characters');
      });

      it('should pass for valid length', () => {
        assert.equal(validate('abc'), undefined);
      });

      it('should support custom message', () => {
        const custom = rules.minLength(5, 'Too short!');
        assert.equal(custom('abc'), 'Too short!');
      });
    });

    describe('maxLength', () => {
      const validate = rules.maxLength(5);

      it('should fail for long string', () => {
        assert.equal(validate('abcdef'), 'Must be at most 5 characters');
      });

      it('should pass for valid length', () => {
        assert.equal(validate('abc'), undefined);
      });
    });

    describe('min', () => {
      const validate = rules.min(10);

      it('should fail for small number', () => {
        assert.equal(validate(5), 'Must be at least 10');
      });

      it('should pass for valid number', () => {
        assert.equal(validate(15), undefined);
      });
    });

    describe('max', () => {
      const validate = rules.max(100);

      it('should fail for large number', () => {
        assert.equal(validate(150), 'Must be at most 100');
      });

      it('should pass for valid number', () => {
        assert.equal(validate(50), undefined);
      });
    });

    describe('email', () => {
      const validate = rules.email();

      it('should fail for invalid email', () => {
        assert.equal(validate('notanemail'), 'Invalid email address');
        assert.equal(validate('missing@domain'), 'Invalid email address');
      });

      it('should pass for valid email', () => {
        assert.equal(validate('test@example.com'), undefined);
      });
    });

    describe('url', () => {
      const validate = rules.url();

      it('should fail for invalid URL', () => {
        assert.equal(validate('not a url'), 'Invalid URL');
      });

      it('should pass for valid URL', () => {
        assert.equal(validate('https://example.com'), undefined);
      });
    });

    describe('pattern', () => {
      const validate = rules.pattern(/^[A-Z]+$/);

      it('should fail for non-matching', () => {
        assert.equal(validate('abc'), 'Invalid format');
      });

      it('should pass for matching', () => {
        assert.equal(validate('ABC'), undefined);
      });
    });

    describe('match', () => {
      const validate = rules.match('password');

      it('should fail when fields do not match', () => {
        assert.equal(validate('secret', { password: 'different' }), 'Must match password');
      });

      it('should pass when fields match', () => {
        assert.equal(validate('secret', { password: 'secret' }), undefined);
      });
    });

    describe('custom', () => {
      it('should use custom validator function', () => {
        const validate = rules.custom((value) => {
          if (value !== 'magic') return 'Must be magic';
        });

        assert.equal(validate('wrong'), 'Must be magic');
        assert.equal(validate('magic'), undefined);
      });
    });
  });

  describe('simpleResolver', () => {
    it('should validate with rules', async () => {
      const resolver = simpleResolver({
        name: [rules.required()],
        email: [rules.required(), rules.email()],
      });

      const result = await resolver({ name: '', email: 'invalid' });

      assert.ok(result.errors.name);
      assert.ok(result.errors.email);
    });

    it('should return no errors for valid data', async () => {
      const resolver = simpleResolver({
        name: [rules.required()],
        email: [rules.email()],
      });

      const result = await resolver({ name: 'John', email: 'john@example.com' });

      assert.deepEqual(result.errors, {});
    });
  });

  describe('useForm', () => {
    it('should initialize with default values', () => {
      const form = useForm({
        defaultValues: { name: 'John', age: 30 },
      });

      assert.equal(form.getValue('name'), 'John');
      assert.equal(form.getValue('age'), 30);
    });

    it('should set and get values', () => {
      const form = useForm();

      form.setValue('email', 'test@example.com');
      assert.equal(form.getValue('email'), 'test@example.com');
    });

    it('should track dirty state', () => {
      const form = useForm({ defaultValues: { name: '' } });

      assert.equal(form.formState.isDirty(), false);
      form.setValue('name', 'Jane');
      assert.equal(form.formState.isDirty(), true);
    });

    it('should set and clear errors', () => {
      const form = useForm();

      form.setError('email', { type: 'required', message: 'Required' });
      assert.deepEqual(form.formState.errors.email, { type: 'required', message: 'Required' });

      form.clearError('email');
      assert.equal(form.formState.errors.email, undefined);
    });

    it('should clear all errors', () => {
      const form = useForm();

      form.setError('email', { message: 'Error 1' });
      form.setError('name', { message: 'Error 2' });
      form.clearErrors();

      assert.deepEqual(form.formState.errors, {});
    });

    it('should reset form', () => {
      const form = useForm({ defaultValues: { name: 'Original' } });

      form.setValue('name', 'Changed');
      form.setError('name', { message: 'Error' });
      form.reset();

      assert.equal(form.getValue('name'), 'Original');
      assert.deepEqual(form.formState.errors, {});
      assert.equal(form.formState.isDirty(), false);
    });

    it('should register field', () => {
      const form = useForm({ defaultValues: { username: 'user123' } });

      const props = form.register('username');

      assert.equal(props.name, 'username');
      assert.equal(props.value, 'user123');
      assert.ok(typeof props.onInput === 'function');
      assert.ok(typeof props.onBlur === 'function');
    });

    it('should watch field values', () => {
      const form = useForm({ defaultValues: { count: 0 } });

      const countSignal = form.watch('count');
      assert.equal(countSignal(), 0);

      form.setValue('count', 5);
      assert.equal(countSignal(), 5);
    });

    it('should render ErrorMessage from formState.errors getter', () => {
      const form = useForm();
      form.setError('email', { type: 'required', message: 'Email required' });

      const vnode = ErrorMessage({ name: 'email', formState: form.formState });
      assert.ok(vnode);
      assert.equal(vnode.tag, 'span');
      assert.equal(vnode.children[0], 'Email required');
    });

    it('should support ErrorMessage legacy errors function compatibility', () => {
      const vnode = ErrorMessage({
        name: 'email',
        errors: () => ({ email: { type: 'custom', message: 'Legacy source' } }),
      });

      assert.ok(vnode);
      assert.equal(vnode.tag, 'span');
      assert.equal(vnode.children[0], 'Legacy source');
    });

    it('should return null from ErrorMessage when no error exists', () => {
      const form = useForm();
      const vnode = ErrorMessage({ name: 'email', formState: form.formState });
      assert.equal(vnode, null);
    });
  });

  describe('useField', () => {
    it('should hold initial value', () => {
      const field = useField('email', { defaultValue: 'test@test.com' });

      assert.equal(field.value(), 'test@test.com');
      assert.equal(field.name, 'email');
    });

    it('should set and track value', () => {
      const field = useField('name');

      field.setValue('Alice');
      assert.equal(field.value(), 'Alice');
      assert.equal(field.isDirty(), true);
    });

    it('should validate', async () => {
      const field = useField('age', {
        validate: (v) => (v < 0 ? 'Must be positive' : null),
      });

      field.setValue(-5);
      const isValid = await field.validate();

      assert.equal(isValid, false);
      assert.equal(field.error(), 'Must be positive');
    });

    it('should reset', () => {
      const field = useField('title', { defaultValue: 'Original' });

      field.setValue('Changed');
      field.setError('Some error');
      field.reset();

      assert.equal(field.value(), 'Original');
      assert.equal(field.error(), null);
      assert.equal(field.isDirty(), false);
    });

    it('should provide input props', () => {
      const field = useField('search');
      const props = field.inputProps();

      assert.equal(props.name, 'search');
      assert.ok(typeof props.onInput === 'function');
      assert.ok(typeof props.onBlur === 'function');
    });
  });
});
