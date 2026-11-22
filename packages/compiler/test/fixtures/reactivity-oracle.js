// The compiler's reactivity oracle: generated modules whose JSX reads values
// the module builds, some of which read signals, compiled twice. The analysed
// build is what what-compiler emits; the reference build is the same source
// with every JSX expression written as a function (`{() => (expr)}`), which
// the runtime always treats as an accessor: every expression reactive. After
// mount and after every signal write the two DOMs must be identical: a
// divergence is a read the analysis took for static that reads a signal (a
// false negative). An expression the analysis wrapped whose reference never
// re-ran is a false positive, measured in bytes, not a failure.
//
// The space (each case its own names, so cases share one module):
//   - values: object literals with getters, setters, methods and nested
//     objects; class instances with getters and methods (and a subclass);
//     static getters; objects given a getter by Object.defineProperty;
//     arrays of objects; objects returned by a function or an arrow the
//     module declares, or built around another object by a closure;
//   - names for them: aliases, `a || b`, `c ? a : b`, `(0, a)`, property
//     projections, array elements, object and array destructuring with
//     defaults, a variable reassigned later, a property assigned later, at
//     module level or in the component body;
//   - reads in JSX: member chains, optional and computed members, method
//     calls with and without arguments, a template literal, arithmetic, a
//     conditional, calls of helpers that read the object (directly, through
//     a callback, through a generator), as children and as attributes.
// Leaves read one of four signals, or a constant.
//
// It covers what a JSX read can reach in a module. A prop's or a parameter's
// property is read once by the documented rule (docs/GOTCHAS.md section 2),
// so no read here starts from one.

export const SIGNALS = 4;

/** A seeded generator (an LCG): the same seed always gives the same cases. */
export function makeRandom(seed) {
  let state = seed >>> 0;
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  const int = (n) => Math.floor(rnd() * n);
  const pick = (list) => list[int(list.length)];
  return { rnd, int, pick };
}

// An expression giving a string, reading a signal or not.
function leaf(g) {
  const k = g.int(SIGNALS);
  return g.pick([`s${k}()`, `'k${g.int(9)}'`, `s${k}() + '!'`, `String(${g.int(9)})`, `s${k}().toUpperCase()`, `\`t\${s${k}()}\``, `'k'`]);
}

// A value of the shape every object here has: a getter `a`, data `b`, a
// method `m` and an arrow `f`, and below depth 0 a nested object `c`.
function objectLiteral(g, depth) {
  const props = [`get a() { return ${leaf(g)}; }`, `b: ${g.rnd() < 0.7 ? `'k${g.int(9)}'` : leaf(g)}`, `m() { return ${leaf(g)}; }`, `f: () => ${leaf(g)}`];
  if (depth > 0) props.push(`c: ${objectLiteral(g, depth - 1)}`);
  if (g.rnd() < 0.3) props.push('set z(v) { this.b = v; }');
  for (let i = props.length - 1; i > 0; i--) {
    const j = g.int(i + 1);
    [props[i], props[j]] = [props[j], props[i]];
  }
  return `{ ${props.join(', ')} }`;
}

/**
 * One case: `decls` at module level, `body` in the component before its
 * return, and `reads`, the JSX expressions, each { code, attr } (attr: the
 * attribute it is the value of, or null for a child).
 */
export function generateCase(g, id) {
  const p = `c${id}_`;
  const decls = [];
  const body = [];
  const reads = [];
  let n = 0;
  const fresh = (stem) => `${p}${stem}${n++}`;
  // Where each name is declared: module level or the component body. A name
  // made from others is declared in the body when any of them is.
  const inBody = new Set();
  const place = (name, ...sources) => {
    const local = sources.some((source) => inBody.has(source)) || g.rnd() < 0.3;
    if (local) inBody.add(name);
    return local ? body : decls;
  };
  const depth = g.int(3);
  // Bindings of the object shape ({ name, d }: with `c` of depth d - 1 while
  // d > 0), of arrays of them (depth `depth`), of leaf values, of classes
  // with a static getter.
  const objects = [];
  const arrays = [];
  const leaves = [];
  const classes = [];

  // Values.
  const makers = [
    () => objectLiteral(g, depth),
    () => {
      const k = fresh('K');
      const extra = depth > 0 ? ` this.c = ${objectLiteral(g, depth - 1)};` : '';
      decls.push(`class ${k} { constructor() { this.b = 'k';${extra} } get a() { return ${leaf(g)}; } m() { return ${leaf(g)}; } f() { return ${leaf(g)}; } static get s() { return ${leaf(g)}; } }`);
      classes.push(k);
      if (g.rnd() < 0.4) {
        const sub = fresh('K');
        decls.push(`class ${sub} extends ${k} { get a() { return ${leaf(g)}; } }`);
        return `new ${sub}()`;
      }
      return `new ${k}()`;
    },
    () => {
      const f = fresh('make');
      decls.push(g.rnd() < 0.5 ? `function ${f}() { return ${objectLiteral(g, depth)}; }` : `const ${f} = () => (${objectLiteral(g, depth)});`);
      return `${f}()`;
    },
    () => {
      const d = fresh('d');
      const rest = [`b: 'k'`, `m() { return ${leaf(g)}; }`, `f: () => ${leaf(g)}`];
      if (depth > 0) rest.push(`c: ${objectLiteral(g, depth - 1)}`);
      decls.push(`const ${d} = { ${rest.join(', ')} };`, `Object.defineProperty(${d}, 'a', { get() { return ${leaf(g)}; } });`);
      return d;
    },
  ];
  const value = () => g.pick(makers)();
  const count = 1 + g.int(3);
  for (let i = 0; i < count; i++) {
    const name = fresh('m');
    const code = value();
    place(name).push(`const ${name} = ${code};`);
    objects.push({ name, d: depth });
  }
  if (g.rnd() < 0.5) {
    const name = fresh('arr');
    const code = `[${value()}, ${value()}]`;
    place(name).push(`const ${name} = ${code};`);
    arrays.push(name);
  }
  if (g.rnd() < 0.4) {
    // A closure: an object whose members read another's.
    const wrap = fresh('wrap');
    const inner = depth > 0 ? ', c: o.c' : '';
    decls.push(`function ${wrap}(o) { return { get a() { return o.a; }, b: o.b, m() { return o.m(); }, f: () => o.f()${inner} }; }`);
    const name = fresh('w');
    const from = g.pick(objects.filter((o) => o.d === depth));
    place(name, from.name).push(`const ${name} = ${wrap}(${from.name});`);
    objects.push({ name, d: depth });
  }

  // Names for them.
  const derived = 1 + g.int(4);
  for (let i = 0; i < derived; i++) {
    const source = g.pick(objects);
    const from = source.name;
    const twin = g.pick(objects);
    const other = twin.name;
    const arr = arrays.length > 0 ? g.pick(arrays) : null;
    const name = fresh('x');
    const roll = g.int(source.d > 0 ? 12 : 8);
    const where = place(name, from, other, ...(arr === null ? [] : [arr]));
    // The depth every value the name may hold has.
    let d = Math.min(source.d, twin.d);
    if (roll === 0) where.push(`const ${name} = ${from};`) && (d = source.d);
    else if (roll === 1) where.push(`const ${name} = ${g.rnd() < 0.5 ? 'true' : 'false'} ? ${from} : ${other};`);
    else if (roll === 2) where.push(`const ${name} = ${from} || ${other};`);
    else if (roll === 3) where.push(`const ${name} = (0, ${from});`) && (d = source.d);
    else if (roll === 4) where.push(`let ${name} = ${other};`, `${name} = ${from};`);
    else if (roll === 5 || roll === 7) {
      where.push(roll === 5 ? `const { a: ${name} } = ${from};` : `const { b: ${name} = 'none' } = ${from};`);
      leaves.push(name);
      continue;
    } else if (roll === 6 && arr !== null) {
      if (g.rnd() < 0.5) where.push(`const ${name} = ${arr}[${g.int(2)}];`);
      else where.push(`const [${g.rnd() < 0.5 ? `, ${name}` : name}] = ${arr};`);
      d = depth;
    } else if (roll === 6) {
      where.push(`const ${name} = ${from};`);
      d = source.d;
    } else if (roll === 8) where.push(`const ${name} = ${from}.c;`) && (d = source.d - 1);
    else if (roll === 9) where.push(`const { c: ${name} } = ${from};`) && (d = source.d - 1);
    else if (roll === 10) where.push(`const { c: ${name} = ${other} } = ${from};`) && (d = Math.min(source.d - 1, twin.d));
    else {
      // A property assigned after the object was made.
      where.push(`${from}.c = ${objectLiteral(g, source.d - 1)};`, `const ${name} = ${from}.c;`);
      d = source.d - 1;
    }
    objects.push({ name, d });
  }

  // Helpers a read may call.
  const fmt = fresh('fmt');
  const get = fresh('get');
  const pickFn = fresh('pick');
  const each = fresh('each');
  const gen = fresh('gen');
  decls.push(
    `function ${fmt}(v, n) { return '[' + v + (n || '') + ']'; }`,
    `function ${get}(o) { return o.a; }`,
    `const ${pickFn} = (o) => o;`,
    `function ${each}(list, fn) { return list.map(fn).join(','); }`,
    `function* ${gen}(o) { yield o.a; yield o.b; }`,
  );

  // Reads.
  const member = ({ name: o, d }) => {
    const path = d > 0 && g.rnd() < 0.3 ? '.c' : '';
    return g.pick([`${o}${path}.a`, `${o}${path}.b`, `${o}${path}.m()`, `${o}${path}.f()`, `${o}${path}.m(1)`, `${o}${path}?.a`, `${o}${path}['a']`]);
  };
  const readCount = 3 + g.int(4);
  for (let i = 0; i < readCount; i++) {
    const o = g.pick(objects);
    const roll = g.int(16);
    let code;
    if (roll < 5) code = member(o);
    else if (roll === 5) code = `\`\${${member(o)}}-\${${member(g.pick(objects))}}\``;
    else if (roll === 6) code = `${member(o)} + ${member(g.pick(objects))}`;
    else if (roll === 7) code = `${g.rnd() < 0.5 ? 'true' : 'false'} ? ${member(o)} : 'none'`;
    else if (roll === 8) code = `${fmt}(${member(o)}, 1)`;
    else if (roll === 9) code = `${get}(${o.name})`;
    else if (roll === 10) code = `${pickFn}(${o.name}).a`;
    else if (roll === 11 && arrays.length > 0) code = g.pick([`${g.pick(arrays)}[0].a`, `${each}(${g.pick(arrays)}, (x) => x.a)`, `${g.pick(arrays)}.at(1).a`]);
    else if (roll === 12 && leaves.length > 0) code = g.pick([g.pick(leaves), `${g.pick(leaves)} + '!'`]);
    else if (roll === 13 && classes.length > 0) code = `${g.pick(classes)}.s`;
    else if (roll === 14) code = `[...${gen}(${o.name})].join('|')`;
    else code = `(${g.rnd() < 0.5 ? 'true' : 'false'} ? ${o.name} : ${g.pick(objects).name}).a`;
    reads.push({ code, attr: g.rnd() < 0.25 ? g.pick(['title', 'data-x', 'class']) : null });
  }
  return { id, decls, body, reads };
}

// The JSX of a case's view: each read marked with its number, the reference
// build's written as a function.
function view(c, reference, marks) {
  const attrs = [];
  const children = [];
  c.reads.forEach((r, i) => {
    const mark = `/*@E${marks.base + i}*/ `;
    const expr = reference ? `() => (__ran(${marks.base + i}), ${r.code})` : `${mark}${r.code}`;
    if (r.attr !== null && !attrs.some((a) => a.startsWith(r.attr + '='))) attrs.push(`${r.attr}={${expr}}`);
    else children.push(`<span>{${expr}}</span>`);
  });
  return `export function V${c.id}() {\n  ${c.body.join('\n  ')}\n  return <div ${attrs.join(' ')}>${children.join('')}</div>;\n}`;
}

/**
 * The module of `cases`: the analysed build's source, or the reference's.
 * Read number i of case c is marked /*@E<n>*\/ with n = c's base + i; the
 * reference counts its runs in `runs[n]` (a read that never re-runs after
 * the writes reads no signal).
 */
export function moduleSource(cases, reference) {
  const counter = reference ? 'export const runs = [];\nfunction __ran(i) { runs[i] = (runs[i] || 0) + 1; }\n' : '';
  const signals = counter + Array.from({ length: SIGNALS }, (_, k) => `export const s${k} = signal('v${k}');`).join('\n');
  let base = 0;
  const parts = cases.map((c) => {
    const marks = { base };
    base += c.reads.length;
    return `${c.decls.join('\n')}\n${view(c, reference, marks)}`;
  });
  return `import { signal } from 'what-framework';\n${signals}\n${parts.join('\n')}\n`;
}

/** The DOM under `node` as text: tags, sorted attributes and text, no comments. */
export function serialize(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return '';
  const attrs = [...node.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ');
  let inner = '';
  for (const child of node.childNodes) inner += serialize(child);
  return `<${node.localName}${attrs ? ' ' + attrs : ''}>${inner}</${node.localName}>`;
}

/**
 * Which marked reads the analysed build wrapped: a Set of their numbers.
 * A read is wrapped when its statement makes it a function (`() =>`).
 */
export function wrappedReads(code) {
  const wrapped = new Set();
  for (const match of code.matchAll(/\/\*@E(\d+)\*\//g)) {
    const line = code.slice(code.lastIndexOf('\n', match.index) + 1, match.index);
    if (line.includes('() =>')) wrapped.add(Number(match[1]));
  }
  return wrapped;
}

// --- Pathological shapes: the analysis must never throw ---

/** Sources the compiler must compile, each a view that reads signal s0. */
export function pathological(g, size) {
  const sources = [];
  const head = `import { signal } from 'what-framework';\nexport const s0 = signal('v0');\n`;
  const n = size;
  // A long chain of aliases of an object with a getter.
  sources.push(head + `const a0 = { get t() { return s0(); } };\n` +
    Array.from({ length: n }, (_, i) => `const a${i + 1} = a${i};`).join('\n') + `\nexport const View = () => <p>{a${n}.t}</p>;`);
  // A chain of projections.
  sources.push(head + `const p0 = { get t() { return s0(); } };\n` +
    Array.from({ length: n }, (_, i) => `const p${i + 1} = { v: p${i} };`).join('\n') +
    `\nexport const View = () => <p>{p${Math.min(n, 400)}${'.v'.repeat(Math.min(n, 400))}.t}</p>;`);
  // Reassigned locals, each written from the last with nested arithmetic.
  const arith = ' + 1'.repeat(40 + g.int(40));
  sources.push(head + `function read() {\n` + Array.from({ length: n }, (_, i) => `  let v${i} = 0;`).join('\n') + '\n' +
    Array.from({ length: n - 1 }, (_, i) => `  v${n - 1 - i} = v${n - 2 - i}${arith};`).join('\n') +
    `\n  v0 = s0().length;\n  return v${n - 1} + s0();\n}\nexport const View = () => <p>{read()}</p>;`);
  // Nested arithmetic and conditionals in one expression.
  const depthExpr = (d) => (d === 0 ? 's0()' : g.rnd() < 0.5 ? `(${depthExpr(d - 1)} + 'x')` : `(true ? ${depthExpr(d - 1)} : 'y')`);
  sources.push(head + `const fmt = (v) => v;\nexport const View = () => <p>{fmt(${depthExpr(Math.min(n, 300))})}</p>;`);
  // A long chain of helpers calling each other.
  sources.push(head + `function h0(x) { return x + s0(); }\n` + Array.from({ length: n }, (_, i) => `function h${i + 1}(x) { return h${i}(x); }`).join('\n') +
    `\nexport const View = () => <p>{h${n}('a')}</p>;`);
  // Destructuring through many levels.
  sources.push(head + `const d0 = { get t() { return s0(); } };\n` +
    Array.from({ length: n }, (_, i) => `const { k: d${i + 1} } = { k: d${i} };`).join('\n') + `\nexport const View = () => <p>{d${n}.t}</p>;`);
  // Variables written from each other in a cycle.
  sources.push(head + `let x0 = { get t() { return s0(); } };\n` + Array.from({ length: n }, (_, i) => `let x${i + 1} = x${i};`).join('\n') + '\n' +
    Array.from({ length: n }, (_, i) => `x${i} = x${(i + 1) % (n + 1)};`).join('\n') + `\nexport const View = () => <p>{x${n}.t}</p>;`);
  return sources;
}
