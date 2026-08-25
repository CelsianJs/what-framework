import { installDOM } from '../../../test-utils/dom.js';
// Regression tests for two form.js defects found auditing whatfw.com against 0.12.3:
//
//   #21 zodResolver failed OPEN under Zod 4. Zod 4 dropped the legacy
//       ZodError#errors alias and only carries #issues, so a resolver that reads
//       `.errors` collected nothing, reported an EMPTY error map, and
//       handleSubmit() took the valid branch with invalid data.
//   #22 <Radio> was exported but inert: its change handler called a key
//       (`onInput`) that register() never defines, it set the field from the
//       shared checkbox branch instead of its own value, and `checked` was read
//       once at creation instead of being a reactive binding.
//
// The last four suites cover regressions the FIX for #22 introduced, all found
// by running it rather than reading it:
//
//   #22a spreading the registration last clobbered the caller's onBlur/onFocus
//        (and onChange), because the registration always carries them.
//   #22b a <Radio> with no `value` wrote the DOM default "on" into form state
//        and, since `checked` degraded to `!!field`, then checked EVERY radio
//        in the group.
//   #22c the change handler defaulted a missing event target to `{}`, so
//        calling it with no event wrote `undefined` over the field.
//   #22d an UNTYPED register() spread onto a raw radio overwrites the input's
//        own value with the field's value, so the click writes the field back
//        to itself. Unrecoverable once it has happened, so it must be loud.
//
// The zod cases build error objects with the Zod 3 / Zod 4 SHAPES by hand rather
// than importing zod: the repo only ever resolves zod 3.25.76 (transitively via
// devtools-mcp), so an installed-zod test could never exercise the v4 shape and
// would couple the core suite to a dependency it does not declare.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const { dom } = installDOM();

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { __DEV__ } = await import('../src/reactive.js');
const { useForm, zodResolver, yupResolver, Radio } = await import('../src/form.js');

// Capture console.warn for the dev-warning assertions. The warnings themselves
// are gated on __DEV__ (they compile away in production builds), so the suites
// below assert the BEHAVIOUR unconditionally and the warning text only when the
// dev branch is live — otherwise a NODE_ENV=production test run would fail on
// output that is supposed to be absent.
function spyOnWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  return {
    warnings,
    restore() { console.warn = original; },
    // Asserts nothing when the dev branch is compiled out; see above.
    assertWarned(pattern, message) {
      if (!__DEV__) return;
      assert.ok(
        warnings.some((w) => pattern.test(w)),
        `${message}\nGot: ${JSON.stringify(warnings, null, 2)}`,
      );
    },
  };
}

async function flush() {
  await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 0));
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// --- Zod error shapes -------------------------------------------------------

// Zod 4: `issues` only. `errors` was dropped in the v4 changelog.
function zod4Error(issues) {
  const e = new Error('Validation failed');
  e.name = 'ZodError';
  e.issues = issues;
  return e;
}

// Zod 3: `issues` is canonical and `errors` is an alias onto the SAME array.
function zod3Error(issues) {
  const e = new Error('Validation failed');
  e.name = 'ZodError';
  e.issues = issues;
  e.errors = issues;
  return e;
}

function throwingSchema(err) {
  return {
    async parseAsync() { throw err; },
  };
}

const V4_ISSUES = [
  // v4 renamed invalid_string -> invalid_format, and paths are PropertyKey[].
  { code: 'invalid_format', format: 'email', path: ['email'], message: 'Invalid email address' },
  { code: 'too_small', minimum: 8, origin: 'string', path: ['password'], message: 'Too small: expected string to have >=8 characters' },
];

const V3_ISSUES = [
  { code: 'invalid_string', validation: 'email', path: ['email'], message: 'Invalid email' },
];

describe('zodResolver across zod majors (#21)', () => {
  it('collects Zod 4 issues (error carries .issues and no .errors)', async () => {
    const resolve = zodResolver(throwingSchema(zod4Error(V4_ISSUES)));
    const result = await resolve({ email: 'nope', password: 'x' });

    assert.deepEqual(
      Object.keys(result.errors).sort(),
      ['email', 'password'],
      'a Zod 4 ZodError must produce one entry per issue',
    );
    assert.equal(result.errors.email.message, 'Invalid email address');
    assert.equal(result.errors.email.type, 'invalid_format');
    assert.equal(result.errors.password.message, 'Too small: expected string to have >=8 characters');
  });

  it('still collects Zod 3 issues (error carries both .issues and .errors)', async () => {
    const resolve = zodResolver(throwingSchema(zod3Error(V3_ISSUES)));
    const result = await resolve({ email: 'nope' });

    assert.deepEqual(Object.keys(result.errors), ['email']);
    assert.equal(result.errors.email.message, 'Invalid email');
    assert.equal(result.errors.email.type, 'invalid_string');
  });

  it('joins nested and symbol-keyed issue paths without throwing', async () => {
    const sym = Symbol('secret');
    const resolve = zodResolver(throwingSchema(zod4Error([
      { code: 'invalid_type', path: ['user', 'address', 0, 'zip'], message: 'Required' },
      { code: 'custom', path: [sym], message: 'Symbol key' },
    ])));
    const result = await resolve({});

    assert.equal(result.errors['user.address.0.zip'].message, 'Required');
    assert.equal(Object.keys(result.errors).length, 2, 'a symbol path segment must not lose the issue');
  });

  it('SECURITY: an invalid form does not submit under Zod 4', async () => {
    const form = useForm({
      defaultValues: { email: 'nope', password: 'x' },
      resolver: zodResolver(throwingSchema(zod4Error(V4_ISSUES))),
    });

    let submittedWith = null;
    let invalidWith = null;
    await form.handleSubmit(
      (values) => { submittedWith = values; },
      (errors) => { invalidWith = errors; },
    )();

    assert.equal(submittedWith, null, 'handleSubmit must NOT take the valid branch for an invalid form');
    assert.ok(invalidWith, 'onInvalid must receive the errors');
    assert.equal(invalidWith.email.message, 'Invalid email address');
    assert.equal(form.formState.isSubmitting(), false, 'isSubmitting must be released after submit');
  });

  it('fails CLOSED when the schema throws something that is not a ZodError', async () => {
    const boom = new TypeError('schema.parseAsync is not a function');
    const resolve = zodResolver({ async parseAsync() { throw boom; } });

    await assert.rejects(
      () => resolve({ email: 'nope' }),
      /schema.parseAsync is not a function/,
      'a non-validation failure must surface, never be reported as "no errors"',
    );
  });

  it('fails CLOSED when a ZodError carries no issues', async () => {
    const resolve = zodResolver(throwingSchema(zod4Error([])));
    const result = await resolve({ email: 'nope' });

    assert.ok(
      Object.keys(result.errors).length > 0,
      'a thrown validation error must never resolve to an empty (valid) error map',
    );
  });
});

describe('yupResolver fail-closed (#21, same defect class)', () => {
  it('fails CLOSED when validate() throws a non-ValidationError', async () => {
    const resolve = yupResolver({
      async validate() { throw new TypeError('cannot read properties of undefined'); },
    });

    await assert.rejects(
      () => resolve({ email: 'nope' }),
      /cannot read properties of undefined/,
      'a crash inside a yup test must not report the form as valid',
    );
  });

  it('reports a root-level ValidationError whose inner list is empty', async () => {
    const err = new Error('this must be a valid email');
    err.name = 'ValidationError';
    err.path = 'email';
    err.type = 'email';
    err.errors = ['this must be a valid email'];
    err.inner = [];

    const resolve = yupResolver({ async validate() { throw err; } });
    const result = await resolve({ email: 'nope' });

    assert.equal(result.errors.email?.message, 'this must be a valid email');
  });

  it('still collects the inner list when yup populates it', async () => {
    const inner = (path, message) => ({ path, type: 'required', message });
    const err = new Error('2 errors occurred');
    err.name = 'ValidationError';
    err.inner = [inner('email', 'Email required'), inner('password', 'Password required')];

    const resolve = yupResolver({ async validate() { throw err; } });
    const result = await resolve({});

    assert.deepEqual(Object.keys(result.errors).sort(), ['email', 'password']);
    assert.equal(result.errors.email.message, 'Email required');
  });
});

describe('<Radio> group round-trip (#22)', () => {
  let form;
  let radios;

  before(async () => {
    const container = getContainer();

    function App() {
      form = useForm({ defaultValues: { plan: 'free' } });
      const { register } = form;
      return h(
        'form',
        null,
        h(Radio, { name: 'plan', value: 'free', register, id: 'r-free' }),
        h(Radio, { name: 'plan', value: 'pro', register, id: 'r-pro' }),
        h(Radio, { name: 'plan', value: 'team', register, id: 'r-team' }),
      );
    }

    mount(h(App), container);
    await flush();
    radios = {
      free: document.getElementById('r-free'),
      pro: document.getElementById('r-pro'),
      team: document.getElementById('r-team'),
    };
  });

  it('renders one radio per option with the shared name and its own value', () => {
    assert.equal(radios.free.type, 'radio');
    assert.equal(radios.pro.getAttribute('name'), 'plan');
    assert.equal(radios.pro.value, 'pro');
  });

  it('checks the radio matching the default value', () => {
    assert.equal(radios.free.checked, true, 'defaultValues should preselect the matching radio');
    assert.equal(radios.pro.checked, false);
  });

  it('writes ITS OWN value into form state when clicked', async () => {
    radios.pro.click();
    await flush();

    assert.equal(form.getValue('plan'), 'pro', 'clicking a radio must set the field to that radio value, not true/false');
    assert.equal(form.formState.values.plan, 'pro');
  });

  it('updates the DOM when the value is set programmatically (reactive checked)', async () => {
    form.setValue('plan', 'team');
    await flush();

    assert.equal(radios.team.checked, true, 'checked must be a reactive binding');
    assert.equal(radios.pro.checked, false);
  });

  it('re-checks a radio the user had already clicked', async () => {
    // Once a user clicks a radio the DOM sets its "dirty checkedness" flag and
    // the `checked` CONTENT ATTRIBUTE stops controlling checkedness. A binding
    // that only stamps the attribute silently stops working from here on.
    form.setValue('plan', 'pro');
    await flush();

    assert.equal(radios.pro.checked, true, 'a previously clicked radio must still be re-checkable');
    assert.equal(radios.team.checked, false);
  });

  it('round-trips the last user selection back through form state', async () => {
    radios.free.click();
    await flush();

    assert.equal(form.getValue('plan'), 'free');
    assert.equal(radios.free.checked, true);
    assert.equal(radios.pro.checked, false);
  });
});

describe('<Radio> keeps the caller\'s handlers (#22a)', () => {
  it('runs the caller AND the registration for the same event', async () => {
    let blurs = 0;
    let focuses = 0;
    let changes = 0;
    let fieldSeenByCaller = null;
    let form;

    function App() {
      form = useForm({ defaultValues: { plan: 'pro' } });
      const { register } = form;
      return h(
        'form',
        null,
        h(Radio, {
          name: 'plan', value: 'free', register, id: 'h-free',
          onBlur: () => { blurs++; },
          onFocus: () => { focuses++; },
          // Reads form state to pin the ORDER too: the registration's handler
          // runs first, so the caller sees state that is already updated.
          onChange: () => { changes++; fieldSeenByCaller = form.getValue('plan'); },
        }),
        h(Radio, { name: 'plan', value: 'pro', register, id: 'h-pro' }),
      );
    }

    mount(h(App), getContainer());
    await flush();
    const free = document.getElementById('h-free');

    free.dispatchEvent(new dom.window.Event('focus'));
    free.dispatchEvent(new dom.window.Event('blur'));
    free.click();
    await flush();

    assert.equal(focuses, 1, 'the caller onFocus must survive the registration spread');
    assert.equal(blurs, 1, 'the caller onBlur must survive the registration spread');
    assert.equal(changes, 1, 'the caller onChange must survive the registration spread');

    // ...and the registration's own handlers must still do their work, which is
    // the half the ORIGINAL fix added: onBlur marks the field touched (and drives
    // mode:'onBlur' validation), onchange writes the picked value.
    assert.equal(form.formState.touched.plan, true, 'the registration onBlur must still mark the field touched');
    assert.equal(form.getValue('plan'), 'free', 'the registration onchange must still write the picked value');
    assert.equal(fieldSeenByCaller, 'free', 'the registration handler must run BEFORE the caller\'s');
  });
});

describe('<Radio> with no value prop (#22b)', () => {
  let form;
  let radios;
  let warn;

  before(async () => {
    warn = spyOnWarnings();
    function App() {
      form = useForm({ defaultValues: { pick: '' } });
      const { register } = form;
      return h(
        'form',
        null,
        h(Radio, { name: 'pick', register, id: 'v-a' }),
        h(Radio, { name: 'pick', register, id: 'v-b' }),
        h(Radio, { name: 'pick', register, id: 'v-c' }),
      );
    }
    mount(h(App), getContainer());
    await flush();
    radios = ['v-a', 'v-b', 'v-c'].map((id) => document.getElementById(id));
    warn.restore();
  });

  it('warns that the radio has nothing to contribute', () => {
    warn.assertWarned(/<Radio name="pick">.*missing a `value` prop/s, 'a valueless radio must be called out');
  });

  it('does not write the DOM default "on" into form state', async () => {
    radios[0].click();
    await flush();

    assert.equal(form.getValue('pick'), '', 'a radio that cannot identify itself must not write "on"');
    assert.equal(form.formState.values.pick, '');
  });

  it('never renders the whole group checked', async () => {
    // The regression: `checked` degraded to `!!field`, so the moment ANY value
    // landed in the field every valueless radio in the group reported checked.
    form.setValue('pick', 'anything-truthy');
    await flush();

    const checkedCount = radios.filter((r) => r.checked).length;
    assert.ok(checkedCount <= 1, `at most one radio in a group may be checked, saw ${checkedCount}`);
    assert.deepEqual(
      radios.map((r) => r.hasAttribute('checked')),
      [false, false, false],
      'an unregistered radio must carry no checked binding at all',
    );
  });
});

describe('register() change handler called without an event (#22c)', () => {
  it('leaves the field untouched instead of writing undefined', () => {
    const form = useForm({ defaultValues: { nickname: 'kirby' } });
    const registered = form.register('nickname');

    const warn = spyOnWarnings();
    try {
      // Both shapes a caller can get wrong: no event at all, and an event object
      // with no target. Neither may reach setValue().
      registered.oninput();
      registered.oninput({});
    } finally {
      warn.restore();
    }

    assert.equal(form.getValue('nickname'), 'kirby', 'a handler with no event must not overwrite the field');
    assert.notEqual(form.getValue('nickname'), undefined);
    warn.assertWarned(/called without an event/, 'the mistake must be loud in dev');
  });
});

describe('register() spread onto a raw radio input (#22d)', () => {
  it('warns loudly when the registration is UNTYPED', async () => {
    // The untyped branch binds `value` to the field, and on a radio the value
    // property writes the value CONTENT ATTRIBUTE (radio `value` is in the DOM's
    // "default/on" mode), so the input's own value — this option's contribution
    // to the group — is destroyed before any ref can read it. Nothing can
    // recover it, so the only honest behaviour is to say so.
    let form;
    function App() {
      form = useForm({ defaultValues: { u: '' } });
      const { register } = form;
      return h(
        'form',
        null,
        h('input', { type: 'radio', value: 'one', id: 'r-one', ...register('u') }),
        h('input', { type: 'radio', value: 'two', id: 'r-two', ...register('u') }),
      );
    }

    const warn = spyOnWarnings();
    try {
      mount(h(App), getContainer());
      await flush();
    } finally {
      warn.restore();
    }

    warn.assertWarned(
      /register\("u"\) was spread onto <input type="radio"> without a type/,
      'an untyped registration on a radio must not fail silently',
    );
  });

  it('lets the input\'s own value win when the registration is typed but has no value', async () => {
    let form;
    function App() {
      form = useForm({ defaultValues: { tier: 'b' } });
      const { register } = form;
      return h(
        'form',
        null,
        h('input', { type: 'radio', value: 'a', id: 't-a', ...register('tier', { type: 'radio' }) }),
        h('input', { type: 'radio', value: 'b', id: 't-b', ...register('tier', { type: 'radio' }) }),
      );
    }

    mount(h(App), getContainer());
    await flush();
    const a = document.getElementById('t-a');
    const b = document.getElementById('t-b');

    // A typed registration emits no `value` binding, so each input keeps its own.
    assert.equal(a.value, 'a');
    assert.equal(b.value, 'b');
    assert.equal(b.checked, true, 'defaultValues must preselect the matching radio by its own value');
    assert.equal(a.checked, false, '`checked` must compare values, not truthiness of the field');

    a.click();
    await flush();

    assert.equal(form.getValue('tier'), 'a', 'the clicked input\'s own value is what the field records');
    assert.equal(a.checked, true);
    assert.equal(b.checked, false);
  });

  it('reports checked=false, never !!field, when the registration has no value', () => {
    // The prop-level thunk is what SSR serializes, and it has no element to read
    // a value from. `!!field` made every radio in the group serialize as checked.
    const form = useForm({ defaultValues: { size: '' } });
    const registered = form.register('size', { type: 'radio' });

    form.setValue('size', 'large');
    assert.equal(typeof registered.checked, 'function', 'checked must stay a reactive thunk');
    assert.equal(registered.checked(), false);
  });
});
