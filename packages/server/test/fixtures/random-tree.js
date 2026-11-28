// Seeded random vnode trees covering every attribute kind the string renderers
// handle (aliases, booleans, enumerated, URL, refused, invalid names, function
// values, style objects), boundaries, context, components and raw HTML.
// Adapted from the functional review's old-vs-new harness, which compared the
// string renderers byte for byte against the previous release on these trees.

export function randomTree(core, seed0) {
  let seed = seed0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ri = (n) => Math.floor(rnd() * n);
  const { h, ErrorBoundary, Suspense, createContext, useContext } = core;
  const Ctx = createContext('d');
  const Reader = () => h('span', null, 'ctx=', useContext(Ctx));
  const Thrower = () => { throw new Error('boom'); };
  const vals = [true, false, null, undefined, 0, 1, '', 'x', 'a"b<c>&\'', () => 'fn', () => false, { a: 1 }, ['p', 'q'], NaN];
  const names = ['class', 'className', 'id', 'title', 'href', 'src', 'style', 'hidden', 'disabled', 'checked', 'value', 'htmlFor', 'aria-label', 'aria-hidden', 'role', 'data-x', 'tabIndex', 'onclick', 'onClick', 'key', 'ref', 'srcdoc', 'for', 'xlink:href', 'readOnly', 'http-equiv', 'httpEquiv', 'contenteditable', 'bad name', 'on', 'acceptCharset'];
  function attrs() {
    const o = {};
    for (let i = ri(5); i > 0; i--) {
      const n = names[ri(names.length)];
      let v = vals[ri(vals.length)];
      if (n === 'style' && rnd() < 0.5) v = { color: 'red', fontSize: '2px', '--v': '1' };
      if ((n === 'href' || n === 'src') && rnd() < 0.3) v = ' javascript:alert(1)';
      o[n] = v;
    }
    return o;
  }
  const tags = ['div', 'span', 'p', 'ul', 'li', 'a', 'img', 'input', 'br', 'svg', 'textarea', 'my-el', 'button', 'section'];
  function gen(d) {
    const out = [];
    for (let n = ri(4); n > 0; n--) {
      const k = ri(11);
      const kid = () => (d > 0 ? gen(d - 1) : ['t', 1, 'l<&>'][ri(3)]);
      if (k === 0) out.push(['text', 'a & b', '<x>', 42, 0, null, false, true, ''][ri(9)]);
      else if (k <= 3) out.push(h(tags[ri(tags.length)], attrs(), kid()));
      else if (k === 4) out.push(kid());
      else if (k === 5) { const v = kid(); out.push(() => v); }
      else if (k === 6) out.push(h(Ctx.Provider, { value: 'v' + ri(9) }, h(Reader), kid()));
      else if (k === 7) out.push(h(ErrorBoundary, { fallback: ({ error }) => h('b', null, 'eb ' + error.message) }, kid(), rnd() < 0.5 ? h(Thrower) : null));
      else if (k === 8) out.push(h(Suspense, { fallback: 'fb' }, kid()));
      else if (k === 9) { const c = kid(); out.push(h(function Comp(props) { return h('i', null, props.children); }, null, c)); }
      else out.push(h('div', { dangerouslySetInnerHTML: { __html: '<b>raw</b>' } }));
    }
    return out;
  }
  return h('main', null, gen(3));
}
