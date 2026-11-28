// The compiled-JSX hydration oracle's grammar: random component trees, each a
// module of compiled JSX with a `Page`, written the ways apps write them.
//
// A tree is made of nodes:
//   - form controls at the leaves (text inputs, textareas, checkboxes,
//     selects), each with a name of its own;
//   - text, a static expression and a reactive one (`{n()}`);
//   - form controls with bindings: an event handler, a ref, a reactive
//     attribute, `bind:value`;
//   - elements and fragments, which hold nodes;
//   - components the module declares, used side by side:
//       a wrapper that destructures `children`, one that reads
//       `props.children`, one with a named JSX slot (`header={…}`), one
//       that hands a slot on to another, a render prop, children as a
//       function, a component that returns a fragment (starting with text,
//       an expression or an element, or a label and its field), an array,
//       or text;
//   - a field component that returns a fragment beside controls with
//     bindings, first, in the middle or last, inside a wrapper that
//     destructures `children`, one that reads `props.children`, a <Form>,
//     a <Show> or a provider;
//   - conditionals (`&&`, `?:`, `<Show>`);
//   - keyed and unkeyed `.map()` lists, reactive and over a plain array,
//     whose rows hold nodes too, and array literals;
//   - `<Suspense>`, `<ErrorBoundary>` and a context provider.
//
// Every case has a reactive text node somewhere (`{n()}`), so a later write
// shows whether the hydrated tree still updates in place.

/** A deterministic generator: `next()` in [0, 1). */
export function random(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const PRELUDE = `
import { signal, Show, Suspense, ErrorBoundary, createContext, useContext } from 'what-framework';
import { Form } from 'what-framework/server';
export const n = signal(0);
export const v = signal('bound');
export const show = signal(true);
export const items = signal([1, 2]);
const rows = [1, 2];
const Ctx = createContext('none');
function Reader() { return <i class="ctx">{useContext(Ctx)}</i>; }
`;

/**
 * One case: { id, source } where source is a module exporting `Page`, `n`,
 * `v`, `show` and `items`.
 */
export function generateCase(id, next) {
  const pick = (list) => list[Math.floor(next() * list.length)];
  const components = [];
  let fields = 0;
  let classes = 0;

  // A node at `depth`; `row` names the list row the node is in (its fields'
  // names then carry the row's item, so each row's are its own).
  function node(depth, row = null) {
    const leaf = depth >= 3 || next() < 0.25;
    if (leaf) return leafNode(row);
    return build(pick(['element', 'element', 'fragment', 'component', 'component', 'component', 'conditional', 'list', 'boundary', 'fields']), depth, row);
  }

  function fieldName(row) {
    return row === null ? `"f${fields++}"` : `{"f${fields++}-" + ${row}}`;
  }

  // A control whose template has bindings.
  function boundControl(row) {
    const name = fieldName(row);
    return pick([
      () => `<input name=${name} onInput={(e) => e.target.setCustomValidity('')} />`,
      () => `<input name=${name} ref={(el) => el} />`,
      () => `<input name=${name} title={n() >= 0 ? "t" : "u"} />`,
      () => `<input name=${name} bind:value={v} />`,
    ])();
  }

  // A component that returns a label and its field as a fragment.
  function fieldComponent(row) {
    const name = `C${components.length}`;
    components.push(`function ${name}({ name }) { return <><label>Label</label><input name={name} /></>; }`);
    return `<${name} name=${fieldName(row)} />`;
  }

  function children(depth, row) {
    const count = 1 + Math.floor(next() * 3);
    let out = '';
    for (let i = 0; i < count; i++) out += node(depth + 1, row);
    return out;
  }

  function leafNode(row) {
    if (next() < 0.15) return boundControl(row);
    const name = fieldName(row);
    return pick([
      () => `<input name=${name} />`,
      () => `<textarea name=${name} />`,
      () => `<input type="checkbox" name=${name} />`,
      () => `<select name=${name}><option value="a">A</option><option value="b">B</option></select>`,
      () => 'text ',
      () => '{n()}',
      () => '{"static"}',
      () => `<b class="e${classes++}">bold</b>`,
    ])();
  }

  function element(tag, inner) {
    return `<${tag} class="e${classes++}">${inner}</${tag}>`;
  }

  function build(kind, depth, row) {
    switch (kind) {
      case 'element':
        return element(pick(['div', 'section']), children(depth, row));
      case 'fragment':
        return `<>${children(depth, row)}</>`;
      case 'conditional': {
        const a = node(depth + 1, row);
        return pick([
          () => `{show() && ${wrapJsx(a)}}`,
          () => `{show() ? ${wrapJsx(a)} : ${wrapJsx(node(depth + 1, row))}}`,
          () => `<Show when={show}>${a}</Show>`,
        ])();
      }
      case 'list': {
        const inner = node(depth + 1, 'it');
        return pick([
          () => `<ul class="e${classes++}">{items().map((it) => <li key={it}>${inner}</li>)}</ul>`,
          () => `<ul class="e${classes++}">{items().map((it) => <li>${inner}</li>)}</ul>`,
          () => `<div class="e${classes++}">{items().map((it) => ${component(depth, 'it', inner)})}</div>`,
          () => `<div class="e${classes++}">{rows.map((it) => ${component(depth, 'it', inner)})}</div>`,
          () => `<div class="e${classes++}">{[${wrapJsx(node(depth + 1, row))}, "text ", ${wrapJsx(node(depth + 1, row))}]}</div>`,
        ])();
      }
      case 'fields': {
        const parts = [boundControl(row), boundControl(row)];
        parts.splice(Math.floor(next() * 3), 0, fieldComponent(row));
        const inner = parts.join('');
        const name = `C${components.length}`;
        return pick([
          () => {
            components.push(`function ${name}({ children }) { return <form class="w">{children}</form>; }`);
            return `<${name}>${inner}</${name}>`;
          },
          () => {
            components.push(`function ${name}(props) { return <div class="w">{props.children}</div>; }`);
            return `<${name}>${inner}</${name}>`;
          },
          () => `<Form action="/save">${inner}</Form>`,
          () => `<Show when={show}>${inner}</Show>`,
          () => `<Ctx.Provider value="v">${inner}</Ctx.Provider>`,
        ])();
      }
      case 'boundary':
        return pick([
          () => `<Suspense fallback={<div>wait</div>}>${children(depth, row)}</Suspense>`,
          () => `<ErrorBoundary fallback={<div>failed</div>}>${children(depth, row)}</ErrorBoundary>`,
          () => `<Ctx.Provider value="v">${children(depth, row)}<Reader /></Ctx.Provider>`,
        ])();
      default:
        return component(depth, row, null);
    }
  }

  // JSX in an expression position: a fragment around anything that is not
  // one element.
  function wrapJsx(jsx) {
    return /^<[a-zA-Z]/.test(jsx) && !/^<>/.test(jsx) ? jsx : `<>${jsx}</>`;
  }

  // A use of a component the module declares, holding `inner` (or new nodes).
  function component(depth, row, inner) {
    const name = `C${components.length}`;
    const body = () => inner ?? children(depth, row);
    const kind = pick(['destructured', 'props', 'slot', 'handOn', 'renderProp', 'functionChild', 'fragment', 'array', 'text']);
    const key = row !== null && inner !== null ? ` key={${row}}` : '';
    switch (kind) {
      case 'destructured':
        components.push(`function ${name}({ children }) { return <section class="w">{children}</section>; }`);
        return `<${name}${key}>${body()}</${name}>`;
      case 'props':
        components.push(`function ${name}(props) { return <div class="w">{props.children}</div>; }`);
        return `<${name}${key}>${body()}</${name}>`;
      case 'slot':
        components.push(`function ${name}({ header, children }) { return <div class="layout"><div class="head">{header}</div><div class="body">{children}</div></div>; }`);
        return `<${name}${key} header={${wrapJsx(node(depth + 1, row))}}>${body()}</${name}>`;
      case 'handOn': {
        const leafName = `${name}Leaf`;
        components.push(`function ${leafName}({ header }) { return <div class="aside">{header}</div>; }`);
        components.push(`function ${name}(props) { return <${leafName} header={props.header} />; }`);
        return `<${name}${key} header={${wrapJsx(inner ?? node(depth + 1, row))}} />`;
      }
      case 'renderProp':
        components.push(`function ${name}({ render }) { return <div class="rp">{render("r")}</div>; }`);
        return `<${name}${key} render={(x) => ${wrapJsx(inner ?? node(depth + 1, row))}} />`;
      case 'functionChild':
        components.push(`function ${name}({ children }) { return <div class="fc">{children("c")}</div>; }`);
        return `<${name}${key}>{(x) => ${wrapJsx(inner ?? node(depth + 1, row))}}</${name}>`;
      case 'fragment': {
        const lead = pick(['text ', '{n()} ', '<b>lead</b>']);
        components.push(`function ${name}(props) { return <>${lead}{props.children}</>; }`);
        return `<${name}${key}>${body()}</${name}>`;
      }
      case 'array':
        components.push(`function ${name}(props) { return [<em>one</em>, props.children]; }`);
        return `<${name}${key}>${body()}</${name}>`;
      default:
        components.push(`function ${name}(props) { return props.children; }`);
        return `<${name}${key}>${inner ?? 'just text'}</${name}>`;
    }
  }

  const tree = `${node(0)}${node(0)}<div class="live">{n()}</div>`;
  const source = `${PRELUDE}${components.join('\n')}\nexport function Page() { return <main>${tree}</main>; }\n`;
  return { id, source };
}

/** The markup a structural comparison reads: no comments, no hydration keys. */
export function structure(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/ data-hk="[^"]*"/g, '');
}

// The controls a user can change (a <Form>'s hidden fields are its own).
const CONTROLS = 'input:not([type=hidden]), textarea, select';

/** Apply an edit to every form control in `root`, as a user does while the page loads. */
export function editControls(root) {
  const edits = [];
  for (const el of root.querySelectorAll(CONTROLS)) {
    if (el.type === 'checkbox') el.checked = !el.checked;
    else if (el.localName === 'select') el.value = 'b';
    else el.value = `edited ${edits.length}`;
    edits.push([el.name, el.type === 'checkbox' ? el.checked : el.value]);
  }
  return edits;
}

/** What the controls in `root` show, as [name, value or checkedness]. */
export function readControls(root) {
  return [...root.querySelectorAll(CONTROLS)].map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value]);
}

/**
 * Run `fn` with console warnings and errors held back: the grammar writes
 * unkeyed `.map()` lists on purpose, which what-compiler warns for, and a
 * known divergence prints its ERR_HYDRATION_MISMATCH, which the oracle
 * collects through onHydrationError instead.
 */
export async function quietly(fn) {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}
