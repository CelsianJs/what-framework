// The form-control conformance oracle: a generated space of form fields, the
// state each one must be in at every phase of its life, and a runner that
// compares a real DOM with it. form-control-oracle.test.js runs it in JSDOM
// over the whole space; form-control-oracle-chromium.test.js runs a part of
// it in Chromium, where live checkedness, option selectedness and FormData
// are the browser's own. Free of Node APIs, so the browser test bundles it.
//
// The space is the cross product of
//   - controls: a text input, a textarea, a checkbox, a radio group, a single
//     select and a multiple select, the selects over six option sets
//     (explicit values; implicit values; duplicate values; implicit values
//     that need HTML whitespace stripping, one of them starting with a
//     no-break space, which is not HTML whitespace; values, text and a title
//     attribute holding `selected`, `value=`, quotes, `>`, `&` and entity
//     text, which no renderer may rewrite; explicit values in an <optgroup>);
//   - props: value, defaultValue, checked, defaultChecked, an option's
//     selected and defaultSelected, a select's defaultValue, each default
//     before or after the value;
//   - binding: none, a static value (null and undefined included), a signal,
//     an accessor;
//   - authoring: h(), compiled JSX, compiled JSX whose field props come
//     through a spread;
//   - server renderers: renderToString, renderToHydratableString and
//     renderToStream of each authoring;
//   - client paths: mount and hydrate for each authoring, a hydration from
//     each hydratable server output;
//   - phases: before hydration, after mount or hydration, after a signal
//     write, after a user edit, after a form reset, after a release to null
//     or undefined, after control is taken again;
//   - a user edit made before hydration, on the server's markup, on every
//     hydration path;
//   - a select's options added after mount, at a later tick, by a <For> and
//     by a <Show> (the select's own defaultValue aside: it names the default
//     options there are when it is written, as React's does);
//   - a select whose options' labels change after the first edit, their
//     values staying: what it shows stays, the user's early choice included;
//   - a range input, whose untouched value (the midpoint, with no value
//     attribute) is not its default attribute: hydration leaves an untouched
//     one clean, so a later default still moves it;
//   - fields named after, or given the id of, a member of their form
//     (`reset`, `elements`, `append`, ...): HTMLFormElement's named
//     properties stand in for its members ([LegacyOverrideBuiltIns]), in a
//     browser (JSDOM does not shadow them).
//
// Ground truth before hydration is the browser's own parsing of the
// equivalent static HTML (staticHtml): the markup a page would carry if it
// showed the field's first state by hand, `<textarea>Draft</textarea>` for a
// textarea that starts with "Draft". A server render must submit and show
// exactly what that markup does.
//
// After mount or hydration, ground truth is the reference model below, which
// follows React 19's documented semantics for controlled and uncontrolled
// fields:
//   - react.dev/reference/react-dom/components/input: `value` makes an input
//     controlled and is what it shows; `defaultValue` is "the initial value"
//     of an uncontrolled one; `checked` and `defaultChecked` likewise for a
//     checkbox or a radio button.
//   - react.dev/reference/react-dom/components/textarea: the same `value` and
//     `defaultValue`.
//   - react.dev/reference/react-dom/components/select: `value` (an array for
//     `multiple`) controls the selected options, `defaultValue` gives the
//     initially selected ones.
//   - react.dev/reference/react-dom/components/form: once the action
//     succeeds, the form is reset: its uncontrolled fields go back to their
//     defaults; a controlled field shows what its prop holds. what-server's
//     <Form> does that with _resetForm when the action's transition commits,
//     which is what the runner calls.
//   - A field the user changed before hydration keeps what they left in it,
//     controlled or not, and hydration dispatches no input or change event,
//     for it or any other field: released react-dom (19.3) leaves the live
//     value and selection alone while hydrating and dispatches nothing, for
//     every field but a textarea, which it puts back to the server's text
//     (What keeps the textarea's draft too). The prop of a controlled field still counts as
//     written, so the model's state after hydration is its state after mount
//     and the same edit.
// Where React documents no behaviour, the model states What's own rules, as
// docs-site/docs/learn/forms.html and the code document them:
//   - null or undefined as `value` or `checked` releases the field: it is
//     uncontrolled again, so a reset restores its default. A field it
//     controlled shows nothing (an empty value, unchecked, no option
//     selected); a field it never controlled is left as it is.
//   - A user edit stays until the binding writes a value other than the one
//     it last wrote (React would put the controlled value back after the
//     event: What never re-renders, so an edit stands until the next write).
//   - An option's `selected` prop is its default selectedness, like
//     `defaultSelected` (the HTML attribute). React does not support it.
//   - A select's value names the options it selects as the client's
//     `select.value =` and `option.selected =` do: a single value selects the
//     first option with that value (in a multiple select too), an array every
//     option whose value it holds; a value no option has selects none. It
//     does so whenever its option set changes (options a list or a <Show>
//     adds later), as a controlled React select does on every render.
// The model also fixes the field's defaults: after mount and hydration alike
// they are what the props declare, never what a server wrote to show a
// controlled value.

export const NAME = 'f';
const RADIOS = ['a', 'b', 'c'];

// The members of a form a field's name or id stands in for.
export const MEMBERS = ['reset', 'elements', 'append', 'submit', 'requestSubmit', 'action', 'method', 'length', 'name'];

/** The name `shape`'s field submits under. */
export const nameOf = (shape) => shape.name ?? NAME;

// The form's own querySelector, which a field named "querySelector" would
// stand in for.
const find = (form, selector) => Element.prototype.querySelector.call(form, selector);
const findAll = (form, selector) => Element.prototype.querySelectorAll.call(form, selector);

export const OPTION_SETS = {
  explicit: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }, { value: 'c', text: 'C' }],
  implicit: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
  duplicate: [{ text: 'a' }, { text: 'b' }, { text: 'b' }],
  whitespace: [{ text: ' a\n ' }, { text: ' b' }, { text: 'b' }],
  markup: [
    { value: 'Only selected items', text: 'a selected b', title: 'x selected y' },
    { value: 'value="b" selected', text: 'B > "b" & <c>', title: "it's value='b' > &amp;" },
    { text: ' selected &lt; "c" > ', title: 'selected' },
  ],
  grouped: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }, { value: 'c', text: 'C' }],
};

// The option sets whose options sit in an <optgroup>.
const GROUPED = new Set(['grouped']);

// An option's value: its value attribute, else its text with ASCII
// whitespace stripped and collapsed (HTML's rule; U+00A0 is not ASCII
// whitespace).
export function optionValue(option) {
  return option.value !== undefined ? option.value : option.text.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').replace(/[\t\n\f\r ]+/g, ' ');
}

// --- The space ---

/** Every shape the oracle checks, numbered. */
export function shapes() {
  const list = [];
  const add = (shape) => list.push({ id: list.length, ...shape });
  // Each default before and after its value, and the default absent.
  const each = (defaults, fn) => {
    for (const dflt of defaults) {
      for (const valueFirst of dflt === undefined || dflt === 'none' ? [false] : [false, true]) fn(dflt, valueFirst);
    }
  };
  for (const control of ['text', 'textarea', 'range']) {
    const [d, c, w] = control === 'range' ? ['20', '70', ['30', '90', null, '10', undefined]] : ['D', 'C', ['W1', 'W2', null, 'W4', undefined]];
    each([undefined, d], (dflt, valueFirst) => {
      const base = { control, dflt, valueFirst };
      add({ ...base, binding: 'none' });
      for (const initial of [c, '', 0, null, undefined]) add({ ...base, binding: 'static', initial });
      for (const binding of ['signal', 'accessor']) {
        for (const initial of [c, null, undefined]) add({ ...base, binding, initial, writes: w });
      }
    });
  }
  each([undefined, true, false], (dflt, valueFirst) => {
    const base = { control: 'checkbox', dflt, valueFirst };
    add({ ...base, binding: 'none' });
    for (const initial of [true, false, null, undefined]) add({ ...base, binding: 'static', initial });
    for (const binding of ['signal', 'accessor']) {
      for (const initial of [true, false, null]) {
        const first = initial !== true;
        add({ ...base, binding, initial, writes: [first, !first, null, !first, undefined] });
      }
    }
  });
  each([undefined, 'c'], (dflt, valueFirst) => {
    const base = { control: 'radio', dflt, valueFirst };
    add({ ...base, binding: 'none' });
    for (const initial of ['a', 'zz', null]) add({ ...base, binding: 'static', initial });
    for (const binding of ['signal', 'accessor']) {
      for (const initial of ['a', null, undefined]) add({ ...base, binding, initial, writes: ['b', 'zz', 'c', null, 'a', undefined] });
    }
  });
  for (const set of Object.keys(OPTION_SETS)) {
    const vals = OPTION_SETS[set].map(optionValue);
    each(['none', 'selected0', 'defaultSelected2', 'selectDefault'], (dflt, valueFirst) => {
      const base = { control: 'select', set, dflt, valueFirst };
      add({ ...base, binding: 'none' });
      for (const initial of [vals[1], 'zzz', null]) add({ ...base, binding: 'static', initial });
      for (const binding of ['signal', 'accessor']) {
        for (const initial of binding === 'signal' ? [vals[1], null] : [vals[1]]) {
          add({ ...base, binding, initial, writes: [vals[2], 'zzz', null, vals[0], undefined] });
        }
      }
    });
    each(['none', 'selected0', 'selectDefault'], (dflt, valueFirst) => {
      const base = { control: 'multiple', set, dflt, valueFirst };
      add({ ...base, binding: 'none' });
      for (const initial of [[vals[1]], vals[1], [vals[0], vals[2]], [], null]) add({ ...base, binding: 'static', initial });
      for (const binding of ['signal', 'accessor']) {
        for (const initial of binding === 'signal' ? [[vals[1]], null] : [[vals[1]]]) {
          add({ ...base, binding, initial, writes: [[vals[2]], [vals[0], vals[1]], null, vals[1], undefined] });
        }
      }
    });
  }
  // Selects whose options a list or a <Show> adds after mount.
  const vals = OPTION_SETS.explicit.map(optionValue);
  for (const late of ['for', 'show']) {
    for (const dflt of ['none', 'selected0', 'defaultSelected2']) {
      const base = { control: 'select', set: 'explicit', dflt, valueFirst: false, late };
      add({ ...base, binding: 'none' });
      add({ ...base, binding: 'static', initial: vals[1] });
      for (const binding of ['signal', 'accessor']) add({ ...base, binding, initial: vals[1], writes: [vals[2], 'zzz', null, vals[0], undefined] });
    }
    for (const dflt of ['none', 'selected0']) {
      const base = { control: 'multiple', set: 'explicit', dflt, valueFirst: false, late };
      add({ ...base, binding: 'static', initial: [vals[1]] });
      for (const binding of ['signal', 'accessor']) add({ ...base, binding, initial: [vals[1]], writes: [[vals[2]], [vals[0], vals[1]], null, vals[1], undefined] });
    }
  }
  // Selects whose options' labels change, their values staying.
  for (const set of ['explicit', 'grouped']) {
    for (const control of ['select', 'multiple']) {
      for (const dflt of ['none', 'selected0']) {
        const base = { control, set, dflt, valueFirst: false, relabel: true };
        const one = control === 'multiple' ? [vals[1]] : vals[1];
        add({ ...base, binding: 'none' });
        add({ ...base, binding: 'static', initial: one });
        add({ ...base, binding: 'signal', initial: one, writes: control === 'multiple' ? [[vals[2]], [vals[0], vals[1]], null, vals[1], undefined] : [vals[2], 'zzz', null, vals[0], undefined] });
      }
    }
  }
  // Fields named after a member of their form, or given its id.
  for (const name of MEMBERS) {
    add({ control: 'text', dflt: 'D', valueFirst: false, binding: 'signal', initial: 'C', writes: ['W1', 'W2', null, 'W4', undefined], name });
    add({ control: 'checkbox', dflt: true, valueFirst: false, binding: 'signal', initial: false, writes: [true, false, null, false, undefined], name });
    add({ control: 'radio', dflt: 'c', valueFirst: false, binding: 'signal', initial: 'a', writes: ['b', 'zz', 'c', null, 'a', undefined], name });
    add({ control: 'select', set: 'explicit', dflt: 'selected0', valueFirst: false, binding: 'signal', initial: vals[1], writes: [vals[2], 'zzz', null, vals[0], undefined], name });
    add({ control: 'text', dflt: 'D', valueFirst: false, binding: 'none', fieldId: name });
  }
  return list;
}

export const isDynamic = (shape) => shape.binding === 'signal' || shape.binding === 'accessor';
const options = (shape) => OPTION_SETS[shape.set];

// --- The reference model ---
//
// A field's state is `live` (what it shows: a value, checkedness per input,
// selectedness per option) and `dflt` (what a reset restores: defaultValue,
// defaultChecked, defaultSelected), each a list, and the FormData values the
// live state submits under NAME.

// What a range input (0 to 100, step 1) shows for `value`: the value
// rounded to its step and clamped, the midpoint for anything else.
function rangeValue(value) {
  const n = Number(value);
  return String(value).trim() === '' || !Number.isFinite(n) ? '50' : String(Math.min(100, Math.max(0, Math.round(n))));
}

const textual = (shape) => shape.control === 'text' || shape.control === 'textarea' || shape.control === 'range';

function declaredDefault(shape) {
  switch (shape.control) {
    case 'text': case 'textarea': case 'range': return [shape.dflt ?? ''];
    case 'checkbox': return [!!shape.dflt];
    case 'radio': return RADIOS.map((r) => r === shape.dflt);
    default: {
      const vals = options(shape).map(optionValue);
      if (shape.dflt === 'selected0') return vals.map((_, i) => i === 0);
      if (shape.dflt === 'defaultSelected2') return vals.map((_, i) => i === 2);
      if (shape.dflt === 'selectDefault') return selection(shape, selectDefault(shape));
      return vals.map(() => false);
    }
  }
}

/** The select's defaultValue prop for a 'selectDefault' shape. */
export function selectDefault(shape) {
  const vals = options(shape).map(optionValue);
  return shape.control === 'multiple' ? [vals[0], vals[2]] : vals[2];
}

// The options a select value selects (see the header).
function selection(shape, value) {
  const vals = options(shape).map(optionValue);
  if (Array.isArray(value)) {
    const wanted = value.map(String);
    return vals.map((v) => wanted.includes(v));
  }
  const at = vals.indexOf(String(value));
  return vals.map((_, i) => i === at);
}

// What a reset (or the first paint) shows from the defaults: a single select
// shows its first option when no option is selected by default, and its last
// when several are.
function fromDefaults(shape, dflt) {
  if (shape.control === 'range') return [rangeValue(dflt[0])];
  if (shape.control !== 'select') return dflt.slice();
  const last = dflt.lastIndexOf(true);
  return dflt.map((_, i) => i === (last === -1 ? 0 : last));
}

function shown(shape, value) {
  switch (shape.control) {
    case 'text': case 'textarea': return [String(value)];
    case 'range': return [rangeValue(value)];
    case 'checkbox': return [!!value];
    default: return selection(shape, value);
  }
}

function nothing(shape) {
  if (shape.control === 'range') return [rangeValue('')];
  if (shape.control === 'text' || shape.control === 'textarea') return [''];
  return declaredDefault(shape).map(() => false);
}

// The radio a user edit clicks, and the option a single-select edit picks:
// one that is not on now. A multiple-select edit toggles the second option.
export function editTarget(shape, live) {
  if (shape.control === 'radio') return live[1] ? 0 : 1;
  if (shape.control === 'select') return live[live.length - 1] ? 0 : live.length - 1;
  return 1;
}

function edited(shape, live) {
  switch (shape.control) {
    case 'text': case 'textarea': return ['typed'];
    case 'range': return ['80'];
    case 'checkbox': return [!live[0]];
    case 'radio': case 'select': {
      const at = editTarget(shape, live);
      return live.map((_, i) => i === at);
    }
    default: return live.map((on, i) => (i === 1 ? !on : on));
  }
}

/** The FormData values `live` submits under NAME. */
export function submitted(shape, live) {
  switch (shape.control) {
    case 'text': case 'textarea': case 'range': return [live[0]];
    case 'checkbox': return live[0] ? ['on'] : [];
    case 'radio': return RADIOS.filter((_, i) => live[i]);
    default: {
      const vals = options(shape).map(optionValue);
      return vals.filter((_, i) => live[i]);
    }
  }
}

// The value each binding gives its input: one per field, one per radio
// (checked when the group's value is the radio's own).
function bound(shape, value) {
  if (shape.control !== 'radio') return [value];
  return RADIOS.map((r) => (value == null ? value : value === r));
}

// The value prop of `shape` while its binding holds `value`, as one value per
// binding: what the dedupe compares (text as its string, a checkbox as a
// boolean, a select's value as it is).
function sameWrite(shape, a, b) {
  if (a === undefined || b === undefined) return false;
  if (textual(shape)) return String(a) === String(b);
  if (shape.control === 'checkbox' || shape.control === 'radio') return !!a === !!b;
  return false;
}

// Apply binding `i`'s write of `value` to `state` (one binding per field,
// one per radio).
function write(shape, state, i, value) {
  if (value == null) {
    if (state.held[i] === undefined) return;
    state.held[i] = undefined;
    state.last[i] = undefined;
    if (shape.control === 'radio') state.live[i] = false;
    else state.live = nothing(shape);
    return;
  }
  if (sameWrite(shape, state.last[i], value)) {
    state.held[i] = value;
    return;
  }
  state.held[i] = value;
  state.last[i] = value;
  if (shape.control === 'radio') {
    if (value) state.live = state.live.map((_, j) => j === i);
    else state.live[i] = false;
  } else {
    state.live = shown(shape, value);
  }
}

function writeAll(shape, state, value) {
  bound(shape, value).forEach((v, i) => write(shape, state, i, v));
}

function reset(shape, state) {
  state.live = fromDefaults(shape, state.dflt);
  state.held.forEach((value, i) => {
    if (value === undefined) return;
    if (shape.control === 'radio') {
      if (value) state.live = state.live.map((_, j) => j === i);
      else state.live[i] = false;
    } else {
      state.live = shown(shape, value);
    }
  });
}

/** The value the binding starts with: the static value, or the signal's. */
const startValue = (shape) => (shape.binding === 'none' ? undefined : shape.initial);

/**
 * The steps of `shape`'s script and the state the model expects after each:
 * [{ step, live, dflt, data }]. The first step is the mount or the hydration.
 */
export function expectations(shape) {
  const dflt = declaredDefault(shape);
  const width = shape.control === 'radio' ? RADIOS.length : 1;
  const state = { live: fromDefaults(shape, dflt), dflt, held: Array(width).fill(undefined), last: Array(width).fill(undefined) };
  writeAll(shape, state, startValue(shape));
  const out = [];
  const record = (step) => out.push({ step, live: state.live.slice(), dflt: state.dflt.slice(), data: submitted(shape, state.live) });
  record('first');
  const steps = isDynamic(shape)
    ? ['edit', ['write', 0], ['write', 1], 'edit', 'reset', ['write', 2], 'edit', 'reset', ['write', 3], ['write', 4], 'reset']
    : ['edit', 'reset'];
  if (shape.control === 'radio' && isDynamic(shape)) steps.splice(4, 0, ['write', 5]);
  // New labels change nothing the select shows.
  if (shape.relabel) steps.splice(1, 0, 'relabel');
  // A signal write of the value it holds notifies no one.
  let current = startValue(shape);
  for (const step of steps) {
    if (step === 'edit') state.live = edited(shape, state.live);
    else if (step === 'reset') reset(shape, state);
    else if (step === 'relabel') { /* the state stays */ }
    else if (!Object.is(current, shape.writes[step[1]])) {
      current = shape.writes[step[1]];
      writeAll(shape, state, current);
    }
    record(Array.isArray(step) ? `write ${JSON.stringify(shape.writes[step[1]]) ?? 'undefined'}` : step);
  }
  return out;
}

/** The state a server render of `shape` must show before any script runs. */
export function firstState(shape) {
  return expectations(shape)[0];
}

// --- Ground truth before hydration: the equivalent static HTML ---

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The markup of a form that shows `shape`'s first state by hand. */
export function staticHtml(shape) {
  const { live } = firstState(shape);
  const name = nameOf(shape);
  const id = shape.fieldId !== undefined ? ` id="${shape.fieldId}"` : '';
  let field;
  switch (shape.control) {
    case 'text': field = `<input${id} name="${name}" value="${escape(live[0])}">`; break;
    case 'range': field = `<input type="range" name="${name}" value="${escape(live[0])}">`; break;
    case 'textarea': field = `<textarea name="${name}">${escape(live[0])}</textarea>`; break;
    case 'checkbox': field = `<input type="checkbox" name="${name}"${live[0] ? ' checked' : ''}>`; break;
    case 'radio': field = RADIOS.map((r, i) => `<input type="radio" name="${name}" value="${r}"${live[i] ? ' checked' : ''}>`).join(''); break;
    default: {
      const opts = options(shape).map((o, i) =>
        `<option${o.value !== undefined ? ` value="${escape(o.value)}"` : ''}${o.title !== undefined ? ` title="${escape(o.title)}"` : ''}${live[i] ? ' selected' : ''}>${escape(o.text)}</option>`).join('');
      field = `<select name="${name}"${shape.control === 'multiple' ? ' multiple' : ''}>${GROUPED.has(shape.set) ? `<optgroup label="g">${opts}</optgroup>` : opts}</select>`;
    }
  }
  return `<form>${field}</form>`;
}

// --- Reading a DOM ---

/** The state of the field in `form`: { live, dflt, data }. */
export function readState(shape, form) {
  const data = new FormData(form).getAll(nameOf(shape));
  switch (shape.control) {
    case 'text': case 'textarea': case 'range': {
      const el = find(form, shape.control === 'textarea' ? 'textarea' : 'input');
      return { live: [el.value], dflt: [el.defaultValue], data };
    }
    case 'checkbox': case 'radio': {
      const inputs = [...findAll(form, 'input')];
      return { live: inputs.map((el) => el.checked), dflt: inputs.map((el) => el.defaultChecked), data };
    }
    default: {
      const opts = [...find(form, 'select').options];
      return { live: opts.map((o) => o.selected), dflt: opts.map((o) => o.defaultSelected), data };
    }
  }
}

function differs(expected, actual, keys = ['live', 'dflt', 'data']) {
  return JSON.stringify(keys.map((k) => expected[k])) !== JSON.stringify(keys.map((k) => actual[k]));
}

// --- Authoring: h() and compiled JSX ---

const lit = (value) => (value === undefined ? 'undefined' : JSON.stringify(value));

// The field props of `shape` in prop order: [name, kind, value], kind 'static'
// (a value), 'signal' or 'accessor' (bound to the signal `v`), for the field
// element (radio: per radio, `r`).
function fieldProps(shape, r) {
  const props = [];
  const valueKey = shape.control === 'checkbox' || shape.control === 'radio' ? 'checked' : 'value';
  if (shape.binding !== 'none') {
    const initial = shape.control === 'radio' ? bound(shape, shape.initial)[RADIOS.indexOf(r)] : shape.initial;
    props.push([valueKey, shape.binding, shape.binding === 'static' ? initial : r]);
  }
  let dflt = null;
  if (textual(shape)) dflt = shape.dflt === undefined ? null : ['defaultValue', 'static', shape.dflt];
  else if (shape.control === 'checkbox') dflt = shape.dflt === undefined ? null : ['defaultChecked', 'static', shape.dflt];
  else if (shape.control === 'radio') dflt = shape.dflt === r ? ['defaultChecked', 'static', true] : null;
  else if (shape.dflt === 'selectDefault') dflt = ['defaultValue', 'static', selectDefault(shape)];
  if (dflt !== null) {
    if (shape.valueFirst) props.push(dflt);
    else props.unshift(dflt);
  }
  return props;
}

// An option's own props: its value attribute and its default.
function optionProps(shape, i) {
  const o = options(shape)[i];
  const props = {};
  if (o.value !== undefined) props.value = o.value;
  if (o.title !== undefined) props.title = o.title;
  if (shape.dflt === 'selected0' && i === 0) props.selected = true;
  if (shape.dflt === 'defaultSelected2' && i === 2) props.defaultSelected = true;
  return props;
}

const is = (value, r) => (value == null ? value : value === r);

// An option's label once the labels have changed (`on`): its value stays.
function relabelled(text, on) {
  return on ? `${text} (new)` : text;
}

/**
 * The h() component for `shape`: ({ v, o }) => <form>field</form>, `o` the
 * signal that adds a late shape's options. `env` gives For and Show.
 */
export function hComponent(h, shape, env) {
  const propsOf = (r) => {
    const props = { name: nameOf(shape) };
    if (shape.fieldId !== undefined) props.id = shape.fieldId;
    if (shape.control === 'range') props.type = 'range';
    if (shape.control === 'checkbox') props.type = 'checkbox';
    if (shape.control === 'radio') Object.assign(props, { type: 'radio', value: r });
    if (shape.control === 'multiple') props.multiple = true;
    return props;
  };
  return function Field({ v, o, l }) {
    const field = (r) => {
      const props = propsOf(r);
      for (const [key, kind, value] of fieldProps(shape, r)) {
        if (kind === 'static') props[key] = value;
        else if (shape.control === 'radio') props[key] = () => is(v(), value);
        else props[key] = kind === 'signal' ? v : () => v();
      }
      return props;
    };
    let fields;
    if (shape.control === 'text' || shape.control === 'range') fields = [h('input', field())];
    else if (shape.control === 'textarea') fields = [h('textarea', field())];
    else if (shape.control === 'checkbox') fields = [h('input', field())];
    else if (shape.control === 'radio') fields = RADIOS.map((r) => h('input', field(r)));
    else {
      const option = (i) => h('option', optionProps(shape, i), shape.relabel ? () => relabelled(options(shape)[i].text, l()) : options(shape)[i].text);
      let opts = options(shape).map((_, i) => option(i));
      if (shape.late === 'for') opts = [h(env.For, { each: () => (o() ? [0, 1, 2] : []) }, option)];
      if (shape.late === 'show') opts = [h(env.Show, { when: o }, ...opts)];
      if (GROUPED.has(shape.set)) opts = [h('optgroup', { label: 'g' }, ...opts)];
      fields = [h('select', field(), ...opts)];
    }
    return h('form', null, ...fields);
  };
}

// The JSX of one prop: `key={...}`, or inside a spread `key: ...`.
function jsxProp(shape, [key, kind, value], spread) {
  let expr;
  if (kind === 'static') expr = lit(value);
  else if (shape.control === 'radio') expr = kind === 'signal' && !spread ? `is(v(), ${lit(value)})` : `() => is(v(), ${lit(value)})`;
  else expr = kind === 'signal' ? (spread ? 'v' : 'v()') : '() => v()';
  if (spread) return `${key}: ${expr}`;
  if (kind === 'static' && typeof value === 'string' && /^[\w ]*$/.test(value)) return `${key}="${value}"`;
  if (kind === 'static' && value === true) return key;
  return `${key}={${expr}}`;
}

/**
 * The compiled JSX source of `shape`'s component named `name`: its field
 * props as attributes, or (spread) inside one spread object.
 */
export function jsxComponent(shape, component, spread) {
  const attrs = (r, fixed) => {
    const props = fieldProps(shape, r);
    const own = props.map((p) => jsxProp(shape, p, spread));
    return `${fixed}${spread ? (own.length ? ` {...{ ${own.join(', ')} }}` : '') : own.map((p) => ' ' + p).join('')}`;
  };
  const name = nameOf(shape);
  const id = shape.fieldId !== undefined ? ` id="${shape.fieldId}"` : '';
  let field;
  if (shape.control === 'text') field = `<input${attrs(null, `${id} name="${name}"`)} />`;
  else if (shape.control === 'range') field = `<input${attrs(null, ` type="range" name="${name}"`)} />`;
  else if (shape.control === 'textarea') field = `<textarea${attrs(null, ` name="${name}"`)} />`;
  else if (shape.control === 'checkbox') field = `<input${attrs(null, ` type="checkbox" name="${name}"`)} />`;
  else if (shape.control === 'radio') field = RADIOS.map((r) => `<input${attrs(r, ` type="radio" name="${name}" value="${r}"`)} />`).join('');
  else {
    const option = (o, i) => {
      const p = optionProps(shape, i);
      const own = Object.entries(p).map(([k, x]) => (x === true ? ` ${k}` : ` ${k}={${JSON.stringify(x)}}`)).join('');
      return shape.relabel ? `<option${own}>{relabelled(${JSON.stringify(o.text)}, l())}</option>` : `<option${own}>{${JSON.stringify(o.text)}}</option>`;
    };
    let opts = options(shape).map(option).join('');
    if (shape.late === 'for') opts = `<For each={() => (o() ? [0, 1, 2] : [])}>{(i) => [${options(shape).map(option).join(', ')}][i]}</For>`;
    if (shape.late === 'show') opts = `<Show when={o()}>${opts}</Show>`;
    if (GROUPED.has(shape.set)) opts = `<optgroup label="g">${opts}</optgroup>`;
    field = `<select${attrs(null, ` name="${name}"${shape.control === 'multiple' ? ' multiple' : ''}`)}>${opts}</select>`;
  }
  return `export function ${component}({ v, o, l }) { return <form>${field}</form>; }`;
}

/** One module of every shape's components: C<id> plain, S<id> through a spread. */
export function jsxModule(list) {
  return `import { For, Show } from 'what-framework';\nconst is = (value, r) => (value == null ? value : value === r);\nconst relabelled = ${relabelled.toString()};\n` +
    list.map((shape) => jsxComponent(shape, `C${shape.id}`, false) + '\n' + jsxComponent(shape, `S${shape.id}`, true)).join('\n');
}

// --- Running a client path ---

const flushMicrotasks = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

// Apply a user edit to the field in `form`, as a user's input does.
function applyEdit(shape, form, live) {
  switch (shape.control) {
    case 'text': case 'textarea': case 'range': {
      const el = find(form, shape.control === 'textarea' ? 'textarea' : 'input');
      el.value = shape.control === 'range' ? '80' : 'typed';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    case 'checkbox': find(form, 'input').click(); return;
    case 'radio': findAll(form, 'input')[editTarget(shape, live)].click(); return;
    default: {
      const select = find(form, 'select');
      const option = select.options[editTarget(shape, live)];
      option.selected = shape.control === 'select' ? true : !option.selected;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

/** Whether a hydration path of `shape` can take a user edit before it runs: one whose options are there. */
export const editsEarly = (shape) => shape.late === undefined;

/**
 * Run `shape`'s script on a client path and return its first finding, or
 * null. `env` is { h, mount, hydrate, flushSync, signal, resetForm,
 * changedFields, For, Show, document }; `changedFields(el)` is how many
 * fields hydration would count as changed by the user at `el`, which for an
 * untouched page is none. `Component` the component; `html` the server markup to
 * hydrate, or undefined to mount. With `early`, the script's first edit is
 * made on the server's markup before hydration runs, as a user does while
 * the page loads, and the first state checked is the edited one.
 */
export async function runClient(env, shape, Component, html, early = false) {
  const expected = expectations(shape);
  const v = isDynamic(shape) ? env.signal(shape.initial) : undefined;
  const o = env.signal(shape.late === undefined);
  const l = env.signal(false);
  const host = env.document.createElement('div');
  env.document.body.append(host);
  const problems = [];
  let stop = null;
  try {
    let adopted = null;
    // The input and change events dispatched while the client takes over:
    // the user's own edit has been made by then, so there must be none.
    const dispatched = [];
    const record = (event) => dispatched.push(event.type);
    if (html !== undefined) {
      host.innerHTML = html;
      adopted = host.querySelector('[name]');
      if (early) applyEdit(shape, host.querySelector('form'), expected[0].live);
      else {
        const changed = [...findAll(host.querySelector('form'), '[name]')].reduce((n, el) => n + env.changedFields(el), 0);
        if (changed > 0) problems.push(`hydration counts ${changed} untouched field(s) as changed`);
      }
      host.addEventListener('input', record, true);
      host.addEventListener('change', record, true);
      stop = env.hydrate(env.h(Component, { v, o, l }), host, { onHydrationError: (info) => problems.push(`hydration error: ${info && (info.kind || info.message)}`) });
    } else {
      stop = env.mount(env.h(Component, { v, o, l }), host);
    }
    await flushMicrotasks();
    if (shape.late !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      o(true);
      env.flushSync();
      await flushMicrotasks();
    }
    host.removeEventListener('input', record, true);
    host.removeEventListener('change', record, true);
    if (dispatched.length > 0) problems.push(`hydration dispatched ${dispatched.join(', ')}`);
    const form = host.querySelector('form');
    if (form === null) return { step: 'first', problem: 'no form rendered' };
    if (adopted !== null && host.querySelector('[name]') !== adopted) problems.push('hydration did not adopt the server field');
    // An uncontrolled field nobody touched is left clean by hydration: a new
    // default still moves what it shows.
    if (html !== undefined && !early && shape.binding === 'none' && textual(shape)) {
      const el = find(form, shape.control === 'textarea' ? 'textarea' : 'input');
      const [value, dflt] = [el.value, el.defaultValue];
      el.defaultValue = shape.control === 'range' ? '33' : 'moved';
      if (el.value !== el.defaultValue) problems.push(`hydration left the untouched field dirty (${JSON.stringify(value)}, default ${JSON.stringify(dflt)})`);
      el.defaultValue = dflt;
    }
    let at = early ? 1 : 0;
    const check = (step) => {
      const actual = readState(shape, form);
      const want = expected[at++];
      if (problems.length > 0) return { step, problem: problems.join('; '), expected: want, actual };
      return differs(want, actual) ? { step, expected: want, actual } : null;
    };
    let found = check(early ? 'edit before hydration' : 'first');
    if (found) return found;
    for (const want of expected.slice(at)) {
      if (want.step === 'edit') applyEdit(shape, form, expected[at - 1].live);
      else if (want.step === 'relabel') {
        l(true);
        env.flushSync();
      } else if (want.step === 'reset') env.resetForm(form, (error) => problems.push(`reset threw: ${error && error.message}`));
      else {
        const index = shape.writes.findIndex((w) => `write ${JSON.stringify(w) ?? 'undefined'}` === want.step);
        v(shape.writes[index]);
        env.flushSync();
      }
      await flushMicrotasks();
      found = check(want.step);
      if (found) return found;
    }
    return null;
  } catch (error) {
    return { step: 'run', problem: `threw: ${error && error.stack || error}` };
  } finally {
    if (stop) stop();
    host.remove();
  }
}

/**
 * Compare the server markup `html` of `shape` with the equivalent static
 * HTML, parsed by the same DOM: the first finding, or null.
 */
export function checkServerHtml(env, shape, html) {
  const parse = (markup) => {
    const host = env.document.createElement('div');
    host.innerHTML = markup;
    const form = host.querySelector('form');
    return form === null ? null : readState(shape, form);
  };
  const expected = parse(staticHtml(shape));
  const actual = parse(html);
  if (actual === null) return { step: 'server', problem: 'no form in the markup', html };
  // What the page shows and submits. Its defaults matter once a script runs,
  // and hydration writes the declared ones: before that, a single select
  // with no option marked and one with its first option marked are the same
  // page.
  return differs(expected, actual, ['live', 'data']) ? { step: 'server', expected, actual, html } : null;
}
