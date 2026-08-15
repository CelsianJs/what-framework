// What Framework - Form Utilities
// Controlled inputs, validation, and form state management

import { signal, computed, batch, effect, __DEV__ } from './reactive.js';
import { getCurrentComponent, _isEventProp } from './dom.js';
import { h } from './h.js';

// --- Registration plumbing ---

// A ref can be a callback or a { current } box; both spellings are public API,
// so anything that wants to install its OWN ref has to forward the caller's.
function _applyRef(ref, el) {
  if (typeof ref === 'function') ref(el);
  else if (ref && typeof ref === 'object') ref.current = el;
}

// Run BOTH handlers when a registration and its caller want the same DOM event.
// Registration first, caller second, so the caller's handler observes form state
// that is already up to date (React Hook Form orders its `register(name, {
// onChange })` option the same way).
function _composeHandlers(registered, callerHandler) {
  if (typeof registered !== 'function') return callerHandler;
  if (typeof callerHandler !== 'function') return registered;
  return function composedHandler(...args) {
    registered.apply(this, args);
    return callerHandler.apply(this, args);
  };
}

// Merge a register() result into caller props WITHOUT dropping the caller's
// event handlers. The obvious `{ ...props, ...registered }` silently loses every
// handler the two objects share, and it does not even need matching keys to do
// it: `onChange` and `onchange` are different object keys that resolve to the
// SAME DOM event, and setProp keys its listener bookkeeping by event name, so
// the second one applied replaces the first. That is how <Radio onBlur> stopped
// firing — the registration's onBlur always exists, so it always won.
// Non-event props keep plain spread semantics (the registration wins: it is what
// makes the input controlled).
function _mergeRegistration(props, registered) {
  const merged = { ...props };
  // Event identity, not key identity: strip the `on` prefix and lowercase, so
  // onChange/onchange collapse together while onBlurCapture (capture phase — a
  // genuinely different listener) stays separate. When the caller wrote two keys
  // for one event, the LAST one wins in the DOM, and it is also the one left in
  // this map, so that is the one the registration composes with.
  const callerKeyByEvent = new Map();
  for (const key in merged) {
    if (_isEventProp(key)) callerKeyByEvent.set(key.slice(2).toLowerCase(), key);
  }

  for (const key in registered) {
    const value = registered[key];
    if (!_isEventProp(key)) {
      merged[key] = value;
      continue;
    }
    const callerKey = callerKeyByEvent.get(key.slice(2).toLowerCase());
    if (callerKey === undefined) {
      merged[key] = value;
      callerKeyByEvent.set(key.slice(2).toLowerCase(), key);
      continue;
    }
    // Keep the caller's key so their props still read back the way they wrote
    // them; the composed function underneath carries both handlers.
    merged[callerKey] = _composeHandlers(value, merged[callerKey]);
  }
  return merged;
}

// --- useForm Hook ---
// Complete form state management with validation

export function useForm(options = {}) {
  // Hook-stable behavior inside components
  const ctx = getCurrentComponent?.();
  if (ctx) {
    const index = ctx.hookIndex++;
    if (!ctx.hooks[index]) {
      ctx.hooks[index] = createFormController(options);
    }
    return ctx.hooks[index];
  }

  // Standalone usage outside component scope
  return createFormController(options);
}

function createFormController(options = {}) {
  const {
    defaultValues = {},
    mode = 'onSubmit', // 'onSubmit' | 'onChange' | 'onBlur'
    reValidateMode = 'onChange',
    resolver,
  } = options;

  // Per-field signals for granular reactivity (avoids full-form re-renders on each keystroke)
  const fieldSignals = {};
  const errorSignals = {};
  const touchedSignals = {};
  const errorsState = signal({});

  function getFieldSignal(name) {
    if (!fieldSignals[name]) {
      fieldSignals[name] = signal(defaultValues[name] ?? '');
    }
    return fieldSignals[name];
  }

  function getErrorSignal(name) {
    if (!errorSignals[name]) {
      errorSignals[name] = signal(null);
    }
    return errorSignals[name];
  }

  function getTouchedSignal(name) {
    if (!touchedSignals[name]) {
      touchedSignals[name] = signal(false);
    }
    return touchedSignals[name];
  }

  // Aggregate signals for bulk operations
  const isDirty = signal(false);
  const isSubmitting = signal(false);
  const isSubmitted = signal(false);
  const isValidating = signal(false);
  const submitCount = signal(0);

  // Helper: get all current values as a plain object.
  // tracked=true subscribes to all known fields; tracked=false is snapshot-only.
  function getAllValues(tracked = false) {
    const result = { ...defaultValues };
    for (const [name, sig] of Object.entries(fieldSignals)) {
      result[name] = tracked ? sig() : sig.peek();
    }
    return result;
  }

  // Helper: get all current errors as a plain object.
  // tracked=true subscribes to all known field errors; tracked=false is snapshot-only.
  function getAllErrors(tracked = false) {
    return tracked ? errorsState() : errorsState.peek();
  }

  function setFieldError(name, error) {
    const nextError = error ?? null;
    getErrorSignal(name).set(nextError);
    errorsState.set((prev) => {
      const prevError = prev[name];
      if (prevError === nextError) return prev;
      if (nextError == null) {
        if (!Object.prototype.hasOwnProperty.call(prev, name)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: nextError };
    });
  }

  function replaceAllErrors(nextErrors = {}) {
    const normalized = nextErrors || {};
    batch(() => {
      for (const [name, sig] of Object.entries(errorSignals)) {
        if (!Object.prototype.hasOwnProperty.call(normalized, name)) {
          sig.set(null);
        }
      }
      for (const [name, err] of Object.entries(normalized)) {
        getErrorSignal(name).set(err ?? null);
      }
      errorsState.set({ ...normalized });
    });
  }

  // Computed states
  const isValid = computed(() => Object.keys(getAllErrors(true)).length === 0);

  const dirtyFields = computed(() => {
    const dirty = {};
    for (const [name, sig] of Object.entries(fieldSignals)) {
      if (sig() !== (defaultValues[name] ?? '')) {
        dirty[name] = true;
      }
    }
    return dirty;
  });

  // Validation
  async function validate(fieldName) {
    if (!resolver) return true;

    isValidating.set(true);
    try {
      const result = await resolver(getAllValues(false));
      const nextErrors = result?.errors || {};

      if (fieldName) {
        const nextError = nextErrors[fieldName] ?? null;
        setFieldError(fieldName, nextError);
        return !nextError;
      } else {
        replaceAllErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
      }
    } finally {
      isValidating.set(false);
    }
  }

  // Register a field — only subscribes to THIS field's signal
  function register(name, options = {}) {
    const fieldSig = getFieldSignal(name);
    const isRadio = options.type === 'radio';
    const isCheckbox = options.type === 'checkbox';
    // A radio does NOT store its own checkedness: every radio in a group shares
    // one field, and that field holds the SELECTED option's value. A declared
    // options.value is what this particular radio contributes, so it is both
    // what the change handler writes and what `checked` compares the field
    // against. radioValueOf() below covers the case where it was not declared.
    const hasRadioValue = isRadio && options.value !== undefined;

    // The value THIS radio contributes to the shared field. A declared
    // options.value wins; otherwise the element's own `value` ATTRIBUTE is the
    // contribution, which is exactly how a plain HTML radio group works.
    // undefined means "this radio has nothing to contribute": the DOM reports
    // the default "on" for EVERY valueless radio, so a group of them could not
    // represent a choice, and a `checked` binding derived from it would light up
    // every radio in the group at once.
    function radioValueOf(el) {
      if (hasRadioValue) return options.value;
      if (!el) return undefined;
      // Only a real element can tell `value=""` apart from "no value attribute";
      // the `value` IDL property reports "on" for the second case and cannot.
      if (typeof el.hasAttribute === 'function') {
        return el.hasAttribute('value') ? el.value : undefined;
      }
      return el.value; // synthetic target (tests, custom widgets)
    }

    // Warn-once latches: register() runs once per input, so these fire once per
    // offending input rather than once per keystroke or click.
    let warnedValuelessRadio = false;
    let warnedUntypedRadio = false;

    const handler = (e) => {
      const target = e && e.target;
      // NOT `|| {}`: a missing target used to read as `{}`, whose `.value` is
      // undefined, so calling the handler without an event quietly OVERWROTE the
      // field with undefined. Refuse instead — there is no value to apply.
      if (!target) {
        if (__DEV__) {
          console.warn(
            `[what] register("${name}") change handler was called without an event. ` +
            'Pass the DOM event through (or call form.setValue() directly). Ignoring.'
          );
        }
        return;
      }
      // options.type is the declared intent; target.type covers a bare
      // register('x') spread straight onto a checkbox or radio input.
      const type = options.type || target.type;
      let value;
      if (type === 'radio') {
        // NOT target.checked: a radio's change event only ever fires when it
        // becomes checked, so `true` carries no information. The field wants the
        // value of whichever radio in the group was picked.
        value = radioValueOf(target);
        if (value === undefined) {
          // Nothing identifies this radio, so any write would be a guess.
          if (__DEV__ && !warnedValuelessRadio) {
            warnedValuelessRadio = true;
            console.warn(
              `[what] register("${name}", { type: 'radio' }) cannot tell which value this radio ` +
              'contributes: pass { value } or give the <input> a value attribute. Field left unchanged.'
            );
          }
          return;
        }
      } else if (type === 'checkbox') {
        value = target.checked;
      } else {
        value = target.value;
      }
      setValue(name, value);

      if (mode === 'onChange' || (isSubmitted.peek() && reValidateMode === 'onChange')) {
        validate(name);
      }
    };

    const result = {
      name,
      onBlur: () => {
        getTouchedSignal(name).set(true);

        if (mode === 'onBlur' || (isSubmitted.peek() && reValidateMode === 'onBlur')) {
          validate(name);
        }
      },
      onFocus: () => {},
      ref: options.ref,
    };

    if (isRadio) {
      // Without a declared value this thunk must report FALSE, never `!!field`:
      // the contribution can only come from the element, which a prop thunk does
      // not have, and `!!field` is true for every radio in the group at once, so
      // picking any option rendered ALL of them checked. The ref below fixes up
      // the real DOM once it does have the element.
      const isChecked = hasRadioValue
        ? () => fieldSig() === options.value
        : () => false;

      if (hasRadioValue) result.value = options.value;
      // A FUNCTION, not the getter the checkbox branch uses: every consumer
      // spreads this object (`<Radio>` does, and so does hand-written
      // `{...register(...)}`), and a spread RESOLVES a getter into a one-shot
      // value that never updates again. A function prop is the framework's
      // reactive-binding protocol — setProp() wraps it in an effect, and the SSR
      // serializer calls it — so one thunk covers both renderers.
      result.checked = isChecked;
      result.onchange = handler;
      result.ref = (el) => {
        _applyRef(options.ref, el);
        if (!el || typeof el !== 'object') return;

        // The reactive `checked` prop above only stamps the checked CONTENT
        // ATTRIBUTE, and the attribute stops controlling checkedness the moment
        // the DOM sets an input's "dirty checkedness" flag, which the user's
        // first click does permanently. From then on, re-selecting that radio
        // through form state would set the attribute and change nothing on
        // screen. Writing the checked PROPERTY is what a controlled radio needs
        // (React and Solid do the same) and it also runs the DOM's radio-group
        // invariant that unchecks the siblings.
        // Disposal rides on the el._propEffects convention that dom.js and
        // render.js both walk on unmount; the ':property' suffix keeps it from
        // colliding with setProp's own effect for the `checked` attribute.
        if (!el._propEffects) el._propEffects = {};
        const key = 'checked:property';
        if (el._propEffects[key]) {
          try { el._propEffects[key](); } catch (err) { /* already disposed */ }
        }
        // radioValueOf(el) is re-read on every run rather than captured, so a
        // registration without a declared value still binds correctly once the
        // element's own value attribute is in place, and an unidentifiable radio
        // is simply never checked instead of being checked alongside its
        // siblings.
        el._propEffects[key] = effect(() => {
          const own = radioValueOf(el);
          el.checked = own !== undefined && fieldSig() === own;
        });
      };
    } else if (isCheckbox) {
      // Checkbox: use checked prop + onchange event
      Object.defineProperty(result, 'checked', {
        get() { return !!fieldSig(); },
        enumerable: true,
      });
      result.onchange = handler;
    } else {
      // Text/select/textarea: use value prop + oninput event
      Object.defineProperty(result, 'value', {
        get() { return fieldSig(); },
        enumerable: true,
      });
      result.oninput = handler;
      result.ref = (el) => {
        _applyRef(options.ref, el);
        // An UNTYPED registration spread onto a radio cannot be rescued, and it
        // fails silently, so say so at mount. The `value` binding above resolves
        // during the spread and overwrites the input's own value with the FIELD's
        // value — and for a radio that own value IS this option's contribution to
        // the group. It is gone for good: `value` on a radio is in the DOM's
        // "default/on" mode, so writing the property also rewrites the value
        // CONTENT ATTRIBUTE, which takes defaultValue and getAttribute('value')
        // down with it. Nothing is left to recover the real value from, so the
        // registration has to be told it is a radio up front.
        // Checking el.type HERE, from the ref, is also what keeps the warning
        // honest: props apply in key order, so with the spread written FIRST
        // (`{...register('u'), type: 'radio', value: 'two'}`) this ref runs
        // before `type` and `value` land, the literal value survives, the write
        // is correct, and el.type is not yet 'radio' — so nothing is warned
        // about. The warning fires exactly when our binding really did overwrite
        // a radio's value.
        if (__DEV__ && !warnedUntypedRadio && el && el.type === 'radio') {
          warnedUntypedRadio = true;
          console.warn(
            `[what] register("${name}") was spread onto <input type="radio"> without a type. ` +
            'Radios in a group share one field holding the SELECTED option, so the registration ' +
            `must be told this radio's value: register("${name}", { type: 'radio', value: ... }), ` +
            'or use <Radio name value register />. As written, the registration overwrote the ' +
            "input's own value and the group cannot record a choice."
          );
        }
      };
    }

    return result;
  }

  // Set single field value — only triggers re-render for components reading this field
  function setValue(name, value, options = {}) {
    const { shouldValidate = false, shouldDirty = true } = options;

    getFieldSignal(name).set(value);
    if (shouldDirty) isDirty.set(true);

    if (shouldValidate) {
      validate(name);
    }
  }

  // Get single field value
  function getValue(name) {
    return getFieldSignal(name)();
  }

  // Set error for a field
  function setError(name, error) {
    setFieldError(name, error);
  }

  // Clear error for a field
  function clearError(name) {
    setFieldError(name, null);
  }

  // Clear all errors
  function clearErrors() {
    replaceAllErrors({});
  }

  // Reset form
  function reset(newValues = defaultValues) {
    batch(() => {
      for (const [name, sig] of Object.entries(fieldSignals)) {
        sig.set(newValues[name] ?? '');
      }
      for (const sig of Object.values(errorSignals)) {
        sig.set(null);
      }
      errorsState.set({});
      for (const sig of Object.values(touchedSignals)) {
        sig.set(false);
      }
      isDirty.set(false);
      isSubmitted.set(false);
    });
  }

  // Handle submit
  function handleSubmit(onValid, onInvalid) {
    return async (e) => {
      if (e) e.preventDefault();

      isSubmitting.set(true);
      isSubmitted.set(true);
      submitCount.set(submitCount.peek() + 1);

      // try/finally, because anything that throws between here and the release
      // leaves isSubmitting stuck true forever, which in practice means a submit
      // button disabled for the rest of the page's life. Throwers include a
      // rejected onValid handler and a resolver that rethrows a non-validation
      // failure (see zodResolver/yupResolver: they fail CLOSED by design).
      try {
        const isFormValid = await validate();

        if (isFormValid) {
          await onValid(getAllValues());
        } else if (onInvalid) {
          onInvalid(getAllErrors(false));
        }
      } finally {
        isSubmitting.set(false);
      }
    };
  }

  // Watch a field — returns a computed that subscribes only to this field
  function watch(name) {
    if (name) {
      return computed(() => getFieldSignal(name)());
    }
    // Watch all: return a computed that reads all field signals
    return computed(() => getAllValues(true));
  }

  return {
    register,
    handleSubmit,
    setValue,
    getValue,
    setError,
    clearError,
    clearErrors,
    reset,
    watch,
    validate,
    // Form state
    formState: {
      get values() { return getAllValues(true); },
      get errors() { return getAllErrors(true); },
      error: (name) => getErrorSignal(name)(),
      get touched() {
        const result = {};
        for (const [name, sig] of Object.entries(touchedSignals)) {
          if (sig()) result[name] = true;
        }
        return result;
      },
      isDirty: () => isDirty(),
      isValid,
      isValidating: () => isValidating(),
      isSubmitting: () => isSubmitting(),
      isSubmitted: () => isSubmitted(),
      submitCount: () => submitCount(),
      dirtyFields,
    },
  };
}

// --- Validation Resolvers ---

// A resolver that cannot read its library's error shape must never answer "no
// errors": handleSubmit() reads an empty error map as VALID and submits the
// form, so a shape mismatch turns validation off silently. Every resolver below
// therefore fails CLOSED — it reports errors, or it rethrows.

// Zod moved the issue list between majors: v3 exposes it as BOTH `.issues` and
// the legacy `.errors` alias, v4 dropped `.errors` and keeps only `.issues`.
// Reading `.errors` alone collected NOTHING under Zod 4, so every invalid form
// submitted. `.issues` is canonical in both majors, so try it first.
function _zodIssues(err) {
  if (!err || typeof err !== 'object') return null;
  if (Array.isArray(err.issues)) return err.issues;
  if (Array.isArray(err.errors)) return err.errors;
  return null;
}

// Zod types issue paths as PropertyKey[], so a record keyed by a symbol yields a
// symbol segment — and Array#join would throw on it (ToString of a symbol is a
// TypeError), losing every issue in the list including the ones we could report.
// Numbers (array indices) stringify the same in both majors.
function _issuePath(issue) {
  const path = issue?.path;
  if (path == null) return '';
  if (!Array.isArray(path)) return String(path);
  let out = '';
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    out += (i ? '.' : '') + (typeof segment === 'symbol' ? segment.toString() : String(segment));
  }
  return out;
}

export function zodResolver(schema) {
  return async (values) => {
    try {
      const result = await schema.parseAsync(values);
      return { values: result, errors: {} };
    } catch (e) {
      const issues = _zodIssues(e);
      // Not a ZodError at all: a TypeError from a mis-built schema, a fetch that
      // failed inside an async .refine(), a bug in zod itself. Swallowing it here
      // reported the form as valid; rethrowing surfaces it, which is what
      // @hookform/resolvers does for the same case.
      if (!issues) throw e;

      const errors = {};
      for (const issue of issues) {
        const path = _issuePath(issue);
        if (!errors[path]) {
          errors[path] = { type: issue.code ?? 'validation', message: issue.message };
        }
      }
      // parseAsync threw, so the input is NOT valid. An empty map here (an issue
      // list we could not interpret) would read as valid, so keep the form
      // blocked with a root-level error instead.
      if (Object.keys(errors).length === 0) {
        errors[''] = { type: 'validation', message: e?.message || 'Validation failed' };
      }
      return { values: {}, errors };
    }
  };
}

// yup reports the per-field failures on `inner` when abortEarly is false, but a
// failure raised at the ROOT (a non-object schema, or a test that reported a
// bare message) arrives with `inner` empty and the path/message on the error
// itself. Anything without a yup error shape is not a validation failure.
function _isYupValidationError(err) {
  if (!err || typeof err !== 'object') return false;
  return err.name === 'ValidationError' || Array.isArray(err.inner);
}

export function yupResolver(schema) {
  return async (values) => {
    try {
      const result = await schema.validate(values, { abortEarly: false });
      return { values: result, errors: {} };
    } catch (e) {
      // Same fail-closed rule as zodResolver: a crash inside a yup test must not
      // be reported to handleSubmit() as "this form is fine".
      if (!_isYupValidationError(e)) throw e;

      const errors = {};
      const inner = Array.isArray(e.inner) && e.inner.length > 0 ? e.inner : [e];
      for (const err of inner) {
        const path = err.path ?? '';
        if (!errors[path]) {
          errors[path] = { type: err.type ?? 'validation', message: err.message };
        }
      }
      return { values: {}, errors };
    }
  };
}

// Simple validation resolver
export function simpleResolver(rules) {
  return async (values) => {
    const errors = {};

    for (const [field, fieldRules] of Object.entries(rules)) {
      const value = values[field];

      for (const rule of fieldRules) {
        const error = rule(value, values);
        if (error) {
          errors[field] = { type: 'validation', message: error };
          break;
        }
      }
    }

    return { values, errors };
  };
}

// Built-in validation rules
export const rules = {
  required: (message = 'This field is required') => (value) => {
    if (value === undefined || value === null || value === '') {
      return message;
    }
  },

  minLength: (min, message) => (value) => {
    if (typeof value === 'string' && value.length < min) {
      return message || `Must be at least ${min} characters`;
    }
  },

  maxLength: (max, message) => (value) => {
    if (typeof value === 'string' && value.length > max) {
      return message || `Must be at most ${max} characters`;
    }
  },

  min: (min, message) => (value) => {
    if (typeof value === 'number' && value < min) {
      return message || `Must be at least ${min}`;
    }
  },

  max: (max, message) => (value) => {
    if (typeof value === 'number' && value > max) {
      return message || `Must be at most ${max}`;
    }
  },

  pattern: (regex, message = 'Invalid format') => (value) => {
    if (typeof value === 'string' && !regex.test(value)) {
      return message;
    }
  },

  email: (message = 'Invalid email address') => (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof value === 'string' && !emailRegex.test(value)) {
      return message;
    }
  },

  url: (message = 'Invalid URL') => (value) => {
    try {
      if (typeof value === 'string' && value) {
        new URL(value);
      }
    } catch {
      return message;
    }
  },

  match: (field, message) => (value, values) => {
    if (value !== values[field]) {
      return message || `Must match ${field}`;
    }
  },

  custom: (validator) => validator,
};

// --- useField Hook ---
// Individual field control

export function useField(name, options = {}) {
  const { validate: validateFn, defaultValue = '' } = options;

  const value = signal(defaultValue);
  const error = signal(null);
  const isTouched = signal(false);
  const isDirty = signal(false);

  async function validate() {
    if (!validateFn) return true;
    const result = await validateFn(value.peek());
    error.set(result || null);
    return !result;
  }

  return {
    name,
    value: () => value(),
    error: () => error(),
    isTouched: () => isTouched(),
    isDirty: () => isDirty(),
    setValue: (v) => {
      value.set(v);
      isDirty.set(true);
    },
    setError: (e) => error.set(e),
    validate,
    reset: () => {
      value.set(defaultValue);
      error.set(null);
      isTouched.set(false);
      isDirty.set(false);
    },
    inputProps: () => ({
      name,
      value: value(),
      onInput: (e) => {
        value.set(e.target.value);
        isDirty.set(true);
      },
      onBlur: () => {
        isTouched.set(true);
        validate();
      },
    }),
  };
}

// --- Controlled Input Components ---

export function Input(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('input', {
    ...rest,
    ...registered,
    'aria-invalid': error ? 'true' : undefined,
  });
}

export function Textarea(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('textarea', {
    ...rest,
    ...registered,
    'aria-invalid': error ? 'true' : undefined,
  });
}

export function Select(props) {
  const { register, error, children, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('select', {
    ...rest,
    ...registered,
    'aria-invalid': error ? 'true' : undefined,
  }, children);
}

export function Checkbox(props) {
  const { register, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('input', {
    type: 'checkbox',
    ...rest,
    ...registered,
    checked: registered.value,
  });
}

export function Radio(props) {
  const { register, value: radioValue, ...rest } = props;

  // A radio with no `value` is a programming error, not a default. The group's
  // field holds the SELECTED option's value, and the DOM reports the default
  // "on" for every valueless radio, so registering one would write "on" into
  // form state and then check every radio in the group that reads it back.
  // Render a plain unregistered input instead: inert, but honest.
  if (radioValue === undefined) {
    if (__DEV__) {
      console.warn(
        `[what] <Radio name="${props.name}"> is missing a \`value\` prop. Radios in a group share ` +
        "one field holding the selected option's value, so a valueless radio has nothing to " +
        'contribute and cannot be checked. Rendering it unregistered.'
      );
    }
    return h('input', { type: 'radio', ...rest });
  }

  // The registration has to carry THIS radio's value: radios in a group share
  // one field, so the value is what the change handler writes into form state
  // and what `checked` compares the field against. register() returns the
  // handler under its real key (`onchange`) and `checked` as a reactive thunk —
  // the previous version hand rolled an onChange that called
  // `registered.onInput`, a key register() has never defined, and compared a
  // one-shot read of the field for `checked`.
  // rest.ref is forwarded so register() can compose it with its own ref.
  const registered = register
    ? register(props.name, { type: 'radio', value: radioValue, ref: rest.ref })
    : {};

  // Merged, NOT spread: `{ ...rest, ...registered }` silently dropped whatever
  // handler the caller passed for an event the registration also handles, and
  // the registration always carries onBlur/onFocus/onchange. onBlur is the one
  // that hurts — it is what marks the field touched and drives mode:'onBlur'
  // validation — and it disappeared without a trace.
  return h('input', _mergeRegistration({
    type: 'radio',
    value: radioValue,
    ...rest,
  }, registered));
}

// --- Form Error Display ---

export function ErrorMessage({ name, formState, errors, render }) {
  const error = formState && typeof formState.error === 'function'
    ? formState.error(name)
    : (
      (
        formState?.errors != null
          ? formState.errors
          : (typeof errors === 'function' ? errors() : errors)
      )?.[name] || null
    );
  if (!error) return null;

  if (render) {
    return render({ message: error.message, type: error.type });
  }

  return h('span', { class: 'what-error', role: 'alert' }, error.message);
}
