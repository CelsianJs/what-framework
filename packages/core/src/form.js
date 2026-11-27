// What Framework - Form Utilities
// Controlled inputs, validation, and form state management

import { signal, computed, batch, effect, onCleanup, untrack, __DEV__ } from './reactive.js';
import { getCurrentComponent, _isEventProp, _markProps } from './dom.js';
import { h } from './h.js';
import { report } from './diagnostics.js';

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
  /** @this {any} */
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
    // A registration's `value` and `checked` are getters over the field; read
    // here they would be its value at render, so they cross as functions,
    // which the renderer binds live (a later setValue or reset shows).
    if (Object.getOwnPropertyDescriptor(registered, key)?.get) {
      merged[key] = () => registered[key];
      continue;
    }
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

// --- Paths ---
// A field's name is a path, as in React Hook Form: `vehicles.0.vin` is
// `values.vehicles[0].vin`. A name without a dot is a key of its own.

const isIndex = (segment) => /^\d+$/.test(segment);

function isContainer(value) {
  return Array.isArray(value) || (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
}

// Plain objects and arrays copied all the way down; anything else (a File,
// a Date, a FileList) kept as it is.
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isContainer(value)) return value;
  const out = {};
  for (const key in value) out[key] = clone(value[key]);
  return out;
}

function getIn(obj, path) {
  let cur = obj;
  for (const segment of path.split('.')) cur = cur == null ? undefined : cur[segment];
  return cur;
}

// Writes into an object getAllValues built, making an array where the next
// segment is an index and an object anywhere else. A path through
// `__proto__` writes nothing: it would write into Object.prototype, the
// prototype of every object (React Hook Form's set refuses it too).
function setIn(obj, path, value) {
  const segments = path.split('.');
  if (segments.includes('__proto__')) return;
  const last = segments.length - 1;
  let cur = obj;
  for (let i = 0; i < last; i++) {
    const segment = segments[i];
    if (cur[segment] === null || typeof cur[segment] !== 'object') cur[segment] = isIndex(segments[i + 1]) ? [] : {};
    cur = cur[segment];
  }
  cur[segments[last]] = value;
}

// A copy of `obj` without the path, copying only what is on the path; an
// object the removal leaves empty goes too, as React Hook Form's unset does.
function unsetIn(obj, segments) {
  const [segment, ...rest] = segments;
  if (!isContainer(obj) || !(segment in obj)) return obj;
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  const inner = rest.length ? unsetIn(out[segment], rest) : undefined;
  if (inner === undefined || (!Array.isArray(inner) && isContainer(inner) && Object.keys(inner).length === 0)) delete out[segment];
  else out[segment] = inner;
  return out;
}

// --- useForm Hook ---
// Complete form state management with validation

const KEEP_DEFAULT = { keepDefaultValue: true };

// One instance per call site of a component, made on its first run.
function hookStable(make) {
  const ctx = getCurrentComponent();
  if (!ctx) return make();
  if (ctx.hooks === null) ctx.hooks = [];
  const index = ctx.hookIndex++;
  return ctx.hooks[index] ||= make();
}

export function useForm(options = {}) {
  return hookStable(() => createFormController(options));
}

function createFormController(options = {}) {
  const {
    mode = 'onSubmit', // 'onSubmit' | 'onChange' | 'onBlur'
    reValidateMode = 'onChange',
    resolver,
    shouldUnregister = false,
  } = options;
  // The values a field starts from and dirtyFields measures from: useForm's
  // defaultValues, then the values a reset() was last given (React Hook
  // Form's reset makes them the defaults).
  let defaultValues = options.defaultValues || {};

  // State is kept by key. A key is the field's name, except under a field
  // array (useFieldArray), where an item's index is replaced by the item's
  // own segment (`vehicles.<item>.vin`): its value, error and touched state
  // stay with the item when it moves. `arrays` holds each field array's
  // items, `bases` each item's values as it was added. `ext` translates
  // names to keys and back once a field array exists; until then a key is
  // its name.
  /** @type {Record<string, any>} */
  const arrays = {};
  /** @type {Record<string, any>} */
  const bases = {};
  /** @type {null | ReturnType<typeof fieldArrays>} */
  let ext = null;
  const keyOf = (name) => (ext ? ext.k(name) : name);
  // The name a key has now, or null for a key of an item that was removed.
  const nameOf = (key) => (ext ? ext.p(key) : key);

  // Per-field signals for granular reactivity (avoids full-form re-renders on each keystroke)
  const fieldSignals = {};
  // The signals of fields read but not written: a reader of a field nothing
  // wrote yet (or that was unregistered) follows it, and the field joins the
  // values when something writes it.
  const pending = {};
  // Fields forgotten with their defaults kept: left out of the values until
  // something writes them again.
  const hidden = {};
  const errorSignals = {};
  const touchedSignals = {};
  const errorsState = signal({});
  // Counts the field and touched signals made and forgotten so far. A reader
  // of the whole form (values, watch(), dirtyFields, touched) reads it, so
  // one that ran before a field existed (a summary rendered above the
  // fields) runs again when the field comes into being and subscribes to it
  // then. Only what writes a field (register, setValue, a blur) makes one
  // known; a read of a field nothing wrote yet sees its default either way.
  const fieldCount = signal(0);
  const counted = () => fieldCount.set((n) => n + 1);

  // The default at a key: from defaultValues, or from the item's values for
  // a key under a field array item.
  const defaultOf = (key) => (ext ? ext.d(key, defaultValues) : getIn(defaultValues, key)) ?? '';

  function getFieldSignal(key) {
    let sig = fieldSignals[key];
    if (sig === undefined) {
      sig = fieldSignals[key] = pending[key] || signal(defaultOf(key));
      delete pending[key];
      delete hidden[key];
      counted();
    }
    return sig;
  }

  const readKey = (key) => (fieldSignals[key] || (pending[key] ||= signal(defaultOf(key))))();

  // A name that holds other fields (a field array, an object of fields) is
  // read from the whole values; a field's own name from its signal.
  function readName(key) {
    if (fieldSignals[key] === undefined && (arrays[key] || isContainer(defaultOf(key)) || Object.keys(fieldSignals).some((k) => k.startsWith(key + '.')))) {
      const name = nameOf(key);
      return name == null ? '' : getIn(getAllValues(true), name) ?? '';
    }
    return readKey(key);
  }

  function getErrorSignal(key) {
    return errorSignals[key] ||= signal(null);
  }

  function getTouchedSignal(key) {
    let sig = touchedSignals[key];
    if (sig === undefined) {
      sig = touchedSignals[key] = signal(false);
      counted();
    }
    return sig;
  }

  // Aggregate signals for bulk operations
  const isDirty = signal(false);
  const isSubmitting = signal(false);
  const isSubmitted = signal(false);
  const isValidating = signal(false);
  const submitCount = signal(0);

  // Helper: get all current values as an object, nested by the fields' paths.
  // tracked=true subscribes to all known fields; tracked=false is snapshot-only.
  function getAllValues(tracked) {
    if (tracked) fieldCount();
    let result = clone(defaultValues);
    if (ext) ext.v(result, tracked);
    for (const key in hidden) {
      const name = nameOf(key);
      if (name != null) result = unsetIn(result, name.split('.'));
    }
    for (const key in fieldSignals) {
      const name = nameOf(key);
      if (name != null) setIn(result, name, tracked ? fieldSignals[key]() : fieldSignals[key].peek());
    }
    return result;
  }

  // Helper: get all current errors as an object keyed by field name.
  // tracked=true subscribes to all known field errors; tracked=false is snapshot-only.
  function getAllErrors(tracked) {
    const errors = tracked ? errorsState() : errorsState.peek();
    return ext ? ext.e(errors) : errors;
  }

  function setFieldError(key, error) {
    const nextError = error ?? null;
    getErrorSignal(key).set(nextError);
    errorsState.set((prev) => {
      const prevError = prev[key];
      if (prevError === nextError) return prev;
      if (nextError == null) {
        if (!Object.hasOwn(prev, key)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: nextError };
    });
  }

  function replaceAllErrors(nextErrors) {
    const normalized = nextErrors || {};
    batch(() => {
      for (const key in errorSignals) {
        if (!Object.hasOwn(normalized, key)) {
          errorSignals[key].set(null);
        }
      }
      for (const key in normalized) {
        getErrorSignal(key).set(normalized[key] ?? null);
      }
      errorsState.set({ ...normalized });
    });
  }

  // Computed states
  const isValid = computed(() => Object.keys(getAllErrors(true)).length === 0);

  // Fields as an object keyed by name, for those `include` keeps.
  function byName(signals, include) {
    fieldCount();
    const out = {};
    for (const key in signals) {
      if (!include(signals[key](), key)) continue;
      const name = nameOf(key);
      if (name != null) out[name] = true;
    }
    return out;
  }

  const dirtyFields = computed(() => byName(fieldSignals, (value, key) => value !== defaultOf(key)));

  // Validation. The resolver is handed every value, and, for a field's own
  // validation, `{ names: [field] }` (React Hook Form's resolver options), so
  // one that can (simpleResolver) checks only that field: a keystroke in a
  // 300-field form runs one field's rules.
  // Runs are numbered as they start, because an async resolver (a lookup on
  // a server) answers them in any order: a field's answer is shown only when
  // no later run of that field or of the whole form started before it
  // landed, and a whole-form answer leaves alone a field validated since it
  // started. A field unregistered or removed counts as validated when it
  // goes, so no answer started before lands on it. isValidating holds until
  // the last run in flight lands; the runs are forgotten then.
  let runCount = 0;
  let formRun = 0;
  const fieldRuns = Object.create(null);
  let inFlight = 0;

  async function validate(fieldName) {
    if (!resolver) return true;

    const run = ++runCount;
    const key = fieldName && keyOf(fieldName);
    // The keys of the names as they are now: the answer is about the items
    // in the places they had when the run started.
    const keyAtStart = ext ? ext.s() : keyOf;
    if (fieldName) fieldRuns[key] = run;
    else formRun = run;
    if (inFlight++ === 0) isValidating.set(true);
    try {
      const result = await resolver(getAllValues(), undefined, fieldName ? { names: [fieldName] } : {});
      const nextErrors = result?.errors || {};

      if (fieldName) {
        const nextError = nextErrors[fieldName] ?? null;
        if (fieldRuns[key] === run && formRun < run) setFieldError(key, nextError);
        return !nextError;
      }
      if (formRun === run) {
        const shown = {};
        for (const name in nextErrors) {
          const at = keyAtStart(name);
          if (at != null) shown[at] = nextErrors[name];
        }
        for (const at in fieldRuns) {
          if (fieldRuns[at] < run) continue;
          const own = errorSignals[at] ? errorSignals[at].peek() : null;
          if (own == null) delete shown[at];
          else shown[at] = own;
        }
        replaceAllErrors(shown);
      }
      return Object.keys(nextErrors).length === 0;
    } finally {
      if (--inFlight === 0) {
        isValidating.set(false);
        for (const at in fieldRuns) delete fieldRuns[at];
      }
    }
  }

  // Forget the field at `key` and every field under it: its value (and its
  // default, unless options.keepDefaultValue or the form's shouldUnregister
  // keeps it, so a field shown again starts from it), its error and its
  // touched state, each unless options keeps it (React Hook Form's
  // unregister options). A reader of the field (a mounted input, watch())
  // keeps its signal, which shows the field's default now, and an edit in
  // the input brings the field back. `gone` is for the keys of a removed
  // item, which nothing can name again: their signals are dropped.
  function forget(key, options = {}, gone) {
    const under = (k) => k === key || k.startsWith(key + '.');
    if (inFlight) {
      for (const k in fieldRuns) if (under(k)) fieldRuns[k] = ++runCount;
      fieldRuns[key] = ++runCount;
    }
    const reset = [];
    if (!options.keepValue) {
      // A field array's name: its items go, each with its state.
      if (ext && arrays[key]) ext.a(key, []);
      for (const k in pending) {
        if (!under(k)) continue;
        reset.push([k, pending[k]]);
        if (gone) delete pending[k];
      }
      for (const k in fieldSignals) {
        if (!under(k)) continue;
        reset.push([k, fieldSignals[k]]);
        if (!gone) pending[k] = fieldSignals[k];
        delete fieldSignals[k];
      }
      for (const k in hidden) if (gone && under(k)) delete hidden[k];
      if (!gone && (options.keepDefaultValue || shouldUnregister)) {
        if (!arrays[key]) hidden[key] = true;
      } else if (!(ext && ext.u(key))) defaultValues = unsetIn(defaultValues, key.split('.'));
    }
    batch(() => {
      for (const [k, sig] of reset) sig.set(defaultOf(k));
      if (!options.keepError) {
        for (const k in errorSignals) {
          if (!under(k)) continue;
          setFieldError(k, null);
          if (gone) delete errorSignals[k];
        }
      }
      if (!options.keepTouched) {
        for (const k in touchedSignals) {
          if (!under(k)) continue;
          touchedSignals[k].set(false);
          if (gone) delete touchedSignals[k];
        }
      }
      counted();
    });
  }

  // Forget fields by name (React Hook Form's unregister), or every field.
  function unregister(names, options) {
    const keys = names == null ? Object.keys(fieldSignals) : [].concat(names).map(keyOf);
    batch(() => { for (const key of keys) forget(key, options); });
  }

  // Register a field — only subscribes to THIS field's signal
  function register(name, options = {}) {
    // Read untracked: compiled JSX reads `{...form.register(name)}` again
    // when what the call read changes, and a move of the items must not
    // hand the row the field of the item now at its first index.
    const key = untrack(() => keyOf(name));
    getFieldSignal(key);
    const read = () => readKey(key);
    if (options.shouldUnregister ?? shouldUnregister) onCleanup(() => forget(key, KEEP_DEFAULT));
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
      // NOT `|| {}`: a missing target would read as `{}`, whose `.value` is
      // undefined, so calling the handler without an event would quietly
      // overwrite the field with undefined. Refuse instead — there is no value
      // to apply.
      if (!target) {
        if (__DEV__) report('ERR_FORM_HANDLER_WITHOUT_EVENT', { data: { name } });
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
            report('ERR_FORM_RADIO_WITHOUT_VALUE', { data: { name } });
          }
          return;
        }
      } else if (type === 'checkbox') {
        value = target.checked;
      } else if (type === 'file') {
        // A file input's value is a fake path ("C:\fakepath\photo.png") that
        // carries no file: the field holds its FileList, as React Hook Form
        // registers one. Each choice is a new list, so it is always news.
        value = target.files;
      } else {
        // A multiple select holds the values of its selected options.
        value = type === 'select-multiple' ? Array.from(target.selectedOptions, (option) => option.value) : target.value;
      }
      // A `change` that brings what the form already holds is no news: a
      // field registered as a value (below) takes its edit from `input`, and
      // from `change` only what that did not bring (a listbox, a multiple
      // select or one with a size, fires only `change` for a key typed).
      if (e.type === 'change' && type !== 'file' && JSON.stringify(value) === JSON.stringify(getFieldSignal(key).peek())) return;
      setKey(key, value);

      if (mode === 'onChange' || (isSubmitted.peek() && reValidateMode === 'onChange')) {
        validateKey(key);
      }
    };

    const result = {
      name,
      onBlur: () => {
        getTouchedSignal(key).set(true);

        if (mode === 'onBlur' || (isSubmitted.peek() && reValidateMode === 'onBlur')) {
          validateKey(key);
        }
      },
      onFocus: () => {},
      ref: options.ref,
    };
    // The name of a field of a field array item follows the item's place (a
    // radio's is written by its ref, below).
    const moves = key !== name;
    if (moves && !isRadio) Object.defineProperty(result, 'name', { get: () => nameOf(key) ?? name, enumerable: true });

    if (isRadio) {
      // Without a declared value this thunk must report UNDEFINED, never
      // `!!field`: the contribution can only come from the element, which a
      // prop thunk does not have, and `!!field` is true for every radio in the
      // group at once, so picking any option rendered ALL of them checked. Not
      // false either: a false `checked` controls the radio unchecked, and the
      // ref below is what checks it once it has the element. A server, which
      // has no element, writes it unchecked.
      const isChecked = hasRadioValue
        ? () => read() === options.value
        : () => undefined;

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
        // The effect belongs to the owner the ref runs under, like every
        // binding of the element. radioValueOf(el) is re-read on every run
        // rather than captured, so a registration without a declared value
        // still binds correctly once the element's own value attribute is in
        // place, and an unidentifiable radio is simply never checked instead of
        // being checked alongside its siblings.
        // A radio of a field array item takes its item's new place as its
        // name here, then its checkedness: taking a name joins that radio
        // group, which unchecks the group's checked radio (the radio of the
        // item that held the place), and that radio's own run checks it
        // again once it has its new name.
        effect(() => {
          if (moves) el.name = nameOf(key) ?? name;
          const own = radioValueOf(el);
          el.checked = own !== undefined && read() === own;
        });
      };
    } else if (isCheckbox) {
      // Checkbox: use checked prop + onchange event
      Object.defineProperty(result, 'checked', {
        get() { return !!read(); },
        enumerable: true,
      });
      result.onchange = handler;
    } else {
      // Text/select/textarea: use value prop + onchange, React's change event,
      // which a text field fires as the user types and a select when its
      // choice changes (render.js listen).
      Object.defineProperty(result, 'value', {
        get: read,
        enumerable: true,
      });
      result.onchange = handler;
      // 0.14 code wires `oninput: register('x').oninput` by hand: it keeps the
      // handler, not enumerable, so a spread attaches only `onchange` and
      // the field is not handled twice per keystroke.
      Object.defineProperty(result, 'oninput', { value: handler });
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
          report('ERR_FORM_RADIO_UNTYPED', { data: { name } });
        }
      };
    }

    // Marked as a props object of What's (dom.js PROPS): a spread binds its
    // `value` and `checked` getters live, so `<input {...register('x')} />`
    // shows setValue and reset however the call is written.
    return _markProps(result);
  }

  // A field's own validation, by the name its key has now.
  function validateKey(key) {
    const name = nameOf(key);
    if (name != null) validate(name);
  }

  // A field array's name takes new items, as its replace() gives them.
  function setKey(key, value, shouldDirty = true) {
    if (ext && arrays[key]) ext.a(key, value);
    else getFieldSignal(key).set(value);
    if (shouldDirty) isDirty.set(true);
  }

  // Set single field value — only triggers re-render for components reading this field
  function setValue(name, value, options = {}) {
    setKey(keyOf(name), value, options.shouldDirty ?? true);
    if (options.shouldValidate) validate(name);
  }

  // Get single field value
  function getValue(name) {
    return readName(keyOf(name));
  }

  // Clear error for a field
  function clearError(name) {
    setFieldError(keyOf(name), null);
  }

  // Clear all errors
  function clearErrors() {
    replaceAllErrors({});
  }

  // Reset form: to the values given, which become the defaults, or to the
  // defaults. The count moves so a whole-form reader (dirtyFields) measures
  // again, a field that held its new default already included. A field
  // array takes its items from the defaults again, each a new item.
  function reset(newValues) {
    if (newValues !== undefined) defaultValues = newValues;
    batch(() => {
      if (ext) ext.r(defaultValues);
      for (const map of [fieldSignals, pending]) {
        for (const key in map) {
          if (ext && nameOf(key) == null) delete map[key];
          else map[key].set(defaultOf(key));
        }
      }
      for (const key in hidden) delete hidden[key];
      counted();
      replaceAllErrors({});
      for (const key in touchedSignals) touchedSignals[key].set(false);
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
          onInvalid(getAllErrors());
        }
      } finally {
        isSubmitting.set(false);
      }
    };
  }

  // Watch a field — returns a computed that subscribes only to this field.
  // The name is taken now: a field of a field array item stays that item's.
  function watch(name) {
    if (name) {
      const key = keyOf(name);
      return computed(() => readName(key));
    }
    // Watch all: return a computed that reads all field signals
    return computed(() => getAllValues(true));
  }

  return {
    register,
    unregister,
    handleSubmit,
    setValue,
    getValue,
    // Set error for a field
    setError: (name, error) => setFieldError(keyOf(name), error),
    clearError,
    clearErrors,
    reset,
    watch,
    validate,
    // What useFieldArray works with: `x(make)` installs the field array
    // support make() builds over this form's state, once.
    control: {
      x: (make) => ext ||= make(arrays, bases, keyOf, forget, getAllValues, isDirty),
    },
    // Form state
    formState: {
      get values() { return getAllValues(true); },
      get errors() { return getAllErrors(true); },
      error: (name) => getErrorSignal(keyOf(name))(),
      get touched() { return byName(touchedSignals, Boolean); },
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

// --- useFieldArray Hook ---
// The items of an array field, as React Hook Form's useFieldArray has them:
// `fields()` lists them with an id each for the row's key, and append,
// prepend, insert, remove, move, swap, update and replace change the list.
// An item's values, errors and touched state are kept under the item, not
// its index, so they move with it; a removed item's state goes with it, and
// a validation of it still in flight never lands.

let itemCount = 0;

// Field array support for one form, installed by its first useFieldArray.
// An item's segment is '\0' and its id: no name a person writes has it.
function fieldArrays(arrays, bases, keyOf, forget, getAllValues, isDirty) {
  const add = (value) => {
    const segment = '\0' + (++itemCount).toString(36);
    bases[segment] = value ?? {};
    return segment;
  };
  // The key of a name, taking an array's items from `items` (an array's key
  // to its items), the arrays' current items by default.
  const key = (name, items) => {
    if (!name.includes('.')) return name;
    let out = '';
    for (const segment of name.split('.')) {
      const list = out && (items ? items[out] : arrays[out]?.());
      out += (out ? '.' : '') + (list && isIndex(segment) && list[segment] !== undefined ? list[segment] : segment);
    }
    return out;
  };
  // Each array's items by their place, so a key's name is found without
  // searching the items.
  const places = {};
  const nameAt = (k) => {
    if (!k.includes('\0')) return k;
    let at = '';
    let out = '';
    for (const segment of k.split('.')) {
      let part = segment;
      if (segment[0] === '\0') {
        part = places[at]?.().get(segment);
        if (part === undefined) return null;
      }
      at += (at ? '.' : '') + segment;
      out += (out ? '.' : '') + part;
    }
    return out;
  };
  // Forget an item and the field arrays inside it.
  const drop = (k) => {
    forget(k, {}, true);
    for (const inner in arrays) {
      if (!inner.startsWith(k + '.')) continue;
      for (const segment of arrays[inner].peek()) delete bases[segment];
      delete arrays[inner];
      delete places[inner];
    }
  };
  const seed = (k, items) => {
    if (arrays[k]) return arrays[k].set(items.map(add));
    const list = arrays[k] = signal(items.map(add));
    places[k] = computed(() => new Map(list().map((segment, i) => [segment, i])));
  };
  // The last item segment of a key, and where it is.
  const lastItem = (segments) => {
    let at = segments.length;
    while (at-- > 0 && segments[at][0] !== '\0');
    return at;
  };
  return {
    k: key,
    p: nameAt,
    // A key's default: under an item, from the item's values.
    d(k, defaults) {
      const segments = k.split('.');
      const at = lastItem(segments);
      let cur = at < 0 ? defaults : bases[segments[at]];
      for (const segment of segments.slice(at + 1)) cur = cur == null ? undefined : cur[segment];
      return cur;
    },
    // Forget the default of a key under an item, in the item's values.
    u(k) {
      const segments = k.split('.');
      const at = lastItem(segments);
      if (at < 0) return false;
      if (!(segments[at] in bases)) return true;
      if (at === segments.length - 1) delete bases[segments[at]];
      else bases[segments[at]] = unsetIn(bases[segments[at]], segments.slice(at + 1));
      return true;
    },
    // Each array's items, outer arrays first, replace what the defaults hold.
    v(result, tracked) {
      for (const k of Object.keys(arrays).sort((a, b) => a.length - b.length)) {
        const name = nameAt(k);
        if (name != null) setIn(result, name, (tracked ? arrays[k]() : arrays[k].peek()).map((segment) => clone(bases[segment])));
      }
    },
    s() {
      const items = {};
      for (const k in arrays) items[k] = arrays[k].peek();
      return (name) => {
        const k = key(name, items);
        return nameAt(k) == null ? null : k;
      };
    },
    e(errors) {
      const out = {};
      for (const k in errors) {
        const name = nameAt(k);
        if (name != null) out[name] = errors[k];
      }
      return out;
    },
    // An array's items replaced by new ones with these values.
    a(k, values) {
      const old = arrays[k].peek();
      batch(() => {
        seed(k, values || []);
        for (const segment of old) drop(k + '.' + segment);
      });
    },
    // A reset gives each array its items from the defaults, as new items;
    // an array inside an item goes with the item.
    r(defaults) {
      for (const k in arrays) {
        for (const segment of arrays[k].peek()) delete bases[segment];
        if (!k.includes('\0')) seed(k, getIn(defaults, k) || []);
        else {
          delete arrays[k];
          delete places[k];
        }
      }
    },
    // One field array's controls.
    array(name) {
      const k = keyOf(name);
      if (!arrays[k]) seed(k, getIn(getAllValues(), name) || []);
      const items = arrays[k];
      // One object per item for as long as it is in the list: a keyed row
      // that took its item as a value is built again for a new one.
      let shown = {};
      const change = (next, removed = []) => batch(() => {
        items.set(next);
        for (const segment of removed) drop(k + '.' + segment);
        isDirty.set(true);
      });
      const many = (value) => (Array.isArray(value) ? value : [value]).map(add);
      const insert = (index, value) => {
        const next = [...items.peek()];
        next.splice(index, 0, ...many(value));
        change(next);
      };
      return {
        fields: computed(() => {
          const now = {};
          const list = items().map((segment) => (now[segment] = shown[segment] || { ...bases[segment], id: segment.slice(1) }));
          shown = now;
          return list;
        }),
        append: (value) => insert(items.peek().length, value),
        prepend: (value) => insert(0, value),
        insert,
        remove(index) {
          const list = items.peek();
          const gone = index === undefined ? list : [].concat(index).map((i) => list[i]);
          change(list.filter((segment) => !gone.includes(segment)), gone);
        },
        move(from, to) {
          const next = [...items.peek()];
          next.splice(to, 0, next.splice(from, 1)[0]);
          change(next);
        },
        swap(a, b) {
          const next = [...items.peek()];
          [next[a], next[b]] = [next[b], next[a]];
          change(next);
        },
        // The item at `index` becomes a new one with these values, as React
        // Hook Form's update remounts it.
        update(index, value) {
          const next = [...items.peek()];
          const old = next[index];
          next[index] = add(value);
          change(next, [old]);
        },
        replace: (values) => change(many(values), items.peek()),
      };
    },
  };
}

export function useFieldArray({ control, form, name }) {
  return hookStable(() => untrack(() => (control || form.control).x(fieldArrays).array(name)));
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

// Simple validation resolver. Given `{ names }` (a field's own validation),
// it runs the rules of those fields only; every rule still reads all values.
// A rule's field is a name, so `'address.city'` reads `values.address.city`.
export function simpleResolver(rules) {
  return async (values, _context, options) => {
    const errors = {};
    const names = options?.names;

    for (const [field, fieldRules] of Object.entries(rules)) {
      if (names && !names.includes(field)) continue;
      const value = getIn(values, field);

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

// The number a value stands for, for min and max: a number as it is, and a
// numeric string as the number it spells, because a registered
// <input type="number"> gives the form its value as a string. A blank or
// non-numeric string stands for none; required and pattern judge those.
function numberOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
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
    const n = numberOf(value);
    if (n !== undefined && n < min) {
      return message || `Must be at least ${min}`;
    }
  },

  max: (max, message) => (value) => {
    const n = numberOf(value);
    if (n !== undefined && n > max) {
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
    if (value !== getIn(values, field)) {
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

// The registration is merged into the caller's props (_mergeRegistration), so
// a handler of the caller's for an event the registration listens for runs
// too: an `onChange` of <Select> with the registration's `onchange`.
export function Input(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('input', {
    ..._mergeRegistration(rest, registered),
    'aria-invalid': error ? 'true' : undefined,
  });
}

export function Textarea(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('textarea', {
    ..._mergeRegistration(rest, registered),
    'aria-invalid': error ? 'true' : undefined,
  });
}

// Compiled options arrive unbuilt (`_deferChildren`, dom.js
// _installLazyChildren) and are built inside the <select>: while hydrating,
// options built while Select runs would claim the server's nodes before the
// select does.
export const Select = /* @__PURE__ */ Object.assign(function Select(props) {
  const { register, error, children, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('select', {
    ..._mergeRegistration(rest, registered),
    'aria-invalid': error ? 'true' : undefined,
  }, children);
}, { _deferChildren: true });

// Registered as a checkbox, so the field holds its checkedness: `checked`
// follows the field (_mergeRegistration) and no `value` attribute is written,
// so the form submits "on". An unregistered Checkbox takes `checked` from its
// props.
export function Checkbox(props) {
  const { register, ...rest } = props;
  if (!register) return h('input', { type: 'checkbox', ...rest });
  return h('input', { type: 'checkbox', ..._mergeRegistration(rest, register(props.name, { type: 'checkbox' })) });
}

export function Radio(props) {
  const { register, value: radioValue, ...rest } = props;

  // A radio with no `value` is a programming error, not a default. The group's
  // field holds the SELECTED option's value, and the DOM reports the default
  // "on" for every valueless radio, so registering one would write "on" into
  // form state and then check every radio in the group that reads it back.
  // Render a plain unregistered input instead: inert, but honest.
  if (radioValue === undefined) {
    if (__DEV__) report('ERR_FORM_RADIO_WITHOUT_VALUE', { data: { name: props.name } });
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

// The component runs once, so what it renders is a reactive function: the
// field's error is read inside it, and the message appears, changes and goes
// away with the error.
export function ErrorMessage({ name, formState, errors, render }) {
  return () => {
    const fieldError = formState && typeof formState.error === 'function'
      ? formState.error(name)
      : (
        (
          formState?.errors != null
            ? formState.errors
            : (typeof errors === 'function' ? errors() : errors)
        )?.[name] || null
      );
    if (!fieldError) return null;

    if (render) {
      return render({ message: fieldError.message, type: fieldError.type });
    }

    return h('span', { class: 'what-error', role: 'alert' }, fieldError.message);
  };
}
