// What Framework - Server: the streaming renderer.
//
// Out of order. The shell (everything outside a <Suspense> that is still
// waiting) goes out in one chunk as soon as it is rendered, with each waiting
// boundary's fallback in place. Every boundary then follows on its own as soon
// as its data is ready:
//
//   shell      ...<template id="pl-ID"></template>FALLBACK<!--pl-ID-->...
//   later      <script type="application/json" data-what-data>DATA</script>
//              <template id="ID">CONTENT</template>
//              <script nonce="N">_$W.s("ID")</script>
//
// DATA is the hydration data channel (what-core hydration-data.js): the
// resources that settled since the last chunk, sent before the swap so the
// client has them when the content appears. _$W.s is defined once, in the
// first boundary's script; it replaces the placeholder and the fallback with
// the template's content. A boundary nested in another one is sent after its
// parent, so its placeholder is always live when its swap runs. With noScripts
// the swap scripts are left out and what-core's applyStreamedBoundaries() does
// the same work from the client entry.
//
// Ids are `${idPrefix}${random}-${n}`: the random part is fresh for every
// stream, so markup on the page (a heading slug, a user's profile anchor) can
// never name a boundary. The swap does not trust ids alone either: the content
// is the <template> right before the running script, and the placeholder is
// looked up as a <template> with that id (an attribute selector: engines may
// answer `tag#id` from the first element with the id), so an element of any
// other kind carrying it is never touched. Ids hold only letters, digits, '_'
// and '-', so they go into a selector as they are.
//
// The output is hydratable (compiled.js has the protocol): components carry
// their owner path as data-hk, and reactive children, the arrays they return
// and boundaries are bracketed by comment markers. A boundary still waiting is
// <!--b--><template id="pl-ID"></template>FALLBACK<!--pl-ID--><!--/b-->, and
// its swap leaves <!--b-->CONTENT<!--/b-->.
//
// A boundary that could not be rendered sends its `failed` record and
// `_$W.s("ID", 1)`, which removes the placeholder and the end marker and turns
// <!--b--> into <!--b!-->, leaving the fallback standing alone exactly as if
// the server had rendered the fallback: the client hydrates it as one and
// renders the boundary itself. Either way the swap then calls `_$W.h(ID)` when
// the client has installed it, so a page that hydrated while the boundary was
// waiting hydrates the boundary now (what-core render.js).
// <Head> tags a boundary sets after the shell (and its <head>) went out travel
// with that boundary and are applied to document.head by _$W.t, or by
// applyStreamedBoundaries() with noScripts.
//
// The renderer is an explicit work stack. Everything a synchronous slice
// produces is appended to the buffer of the segment it belongs to (the shell
// or one boundary), and a segment becomes one chunk when it is complete. When
// a node has to wait (an async component, a suspended resource) inside a
// <Suspense>, the rest of that boundary's work is moved to a segment of its
// own and the shell carries on; outside any <Suspense>, the render waits in
// place.
//
// The same engine renders the buffered forms (renderToStringAsync,
// renderDocument): nothing is written, and once every boundary has settled the
// segments are stitched back together with each boundary's content in place of
// its fallback, so a buffered page and a streamed one are the same tree
// rendered by the same rules.
//
// Component frames are owners under the render's root, and a frame is never
// left current across an await. Each frame is created with an explicit parent
// and is current only for the synchronous call that needs it (the component
// body, a reactive child), so concurrent streams cannot read each other's
// context and leave no frame current behind them. An async component's code
// after an `await` finds its own frame through the async context (what-core's
// _runComponentAsync), never another stream's.
//
// A render ends exactly once (finished, failed or aborted), and ending it
// releases its context: the listener on the caller's signal is removed and the
// reactive root that owns every effect and computed its components created is
// disposed (see context.js).

import {
  _beginComponentSSR,
  _endComponentSSR,
  _runInComponentSSR,
  _runComponentAsync,
  _mapArrayToArray,
  _assignOwnerPath,
  _ownerCounter,
  runWithServerContext,
  __flushOutsideServerContext,
  isVNode,
} from 'what-core/internal';
import { childNamespace } from 'what-core/internal/markup-rules';
import { createRenderContext, ensureServerRuntime, resourcePayload, errorRecord } from './context.js';
import { getIslandStoresSnapshot } from './islands.js';
import { serializeState } from './serialize.js';
import {
  SERVER_SKIPPED_TAGS,
  VOID_ELEMENTS,
  _componentProps,
  _boundaryFallback,
  _isDevMode,
  _exposesErrorDetails,
  _resolveInnerHTML,
  _claimThrow,
  _rawText,
  _isTextContent,
  _afterOpen,
  _plainText,
  assertSafeTag,
  renderAttrs,
  _markSelected,
  _field,
  escapeHtml,
  arrayKeys,
} from './html.js';
import {
  ARRAY_CLOSE,
  ARRAY_OPEN,
  BOUNDARY_CLOSE,
  BOUNDARY_FALLBACK,
  BOUNDARY_OPEN,
  REGION_CLOSE,
  REGION_OPEN,
  isHtml,
  placeKey,
} from './compiled.js';

// Same bound as renderToStringAsync's resolve passes.
const MAX_ATTEMPTS = 12;

// Work-stack markers. Vnodes, strings, arrays and functions are pushed as is.
const CLOSE = 1;     // emit fixed markup (a closing tag, a placeholder end)
const END = 2;       // a component's subtree is finished
const SCOPE_END = 3; // a <Suspense> / <ErrorBoundary> subtree is finished
const RETRY = 4;     // re-run a node that suspended
const AWAITED = 5;   // the settled result of an async component
const NS_END = 6;    // an element whose children sit in another namespace is finished
const SELECT_END = 7; // a <select> with a value is finished: mark its options

// A marker is an instance of this module's own class, never a shape: a child
// can be any value a reactive child returns, JSON included, and a plain
// object reading { $m: 1, html } must render as the text it is, not as markup.
class Mark {
  constructor($m, fields) {
    this.$m = $m;
    Object.assign(this, fields);
  }
}

/** @returns {any} a marker, with the fields its kind carries */
function mark($m, fields) {
  return new Mark($m, fields);
}

// Swap one streamed boundary into place, or with `f` set, drop the placeholder
// of one that failed and keep its fallback. Kept in step with
// applyStreamedBoundaries in what-core's hydration-data.js.
const SWAP_FUNCTION = '(self._$W=self._$W||{}).s=function(i,f){'
  + 'var W=self._$W,d=document,p=d.querySelector(\'template[id="pl-\'+i+\'"]\'),c=d.currentScript,t=c&&c.previousElementSibling,n,e,b;'
  + 'if(!p)return;'
  + 'if(!f&&(!t||t.tagName!=="TEMPLATE"||t.id!==i))return;'
  + 'for(n=p.nextSibling;n&&!(n.nodeType===8&&n.data==="pl-"+i);n=e){e=n.nextSibling;if(!f)n.remove()}'
  + 'b=p.previousSibling;if(f&&b&&b.nodeType===8&&b.data==="b")b.data="b!";'
  + 'if(n)n.remove();if(f)p.remove();else{p.replaceWith(t.content);t.remove()}'
  + 'if(W.h)W.h(i)};';

// Apply <Head> tags a boundary set after the shell: the title, and each meta
// or link, replacing the head element with the same dedup key (head.js). The
// tags are built with setAttribute from data, never parsed as markup. Kept in
// step with applyLateHead in what-core's hydration-data.js.
const HEAD_FUNCTION = '(self._$W=self._$W||{}).t=function(h){'
  + 'var d=document,H=d.head,g=function(l,tag,m){(l||[]).forEach(function(a){'
  + 'var el=d.createElement(tag),k,v,o,w=m(a);'
  + 'for(k in a){v=a[k];if(v==null||v===false)continue;if(k==="httpEquiv")k="http-equiv";'
  + 'if(/^[a-zA-Z_:][a-zA-Z0-9:._-]*$/.test(k)&&!/^on./i.test(k))el.setAttribute(k,String(v))}'
  + 'if(w)for(o=H.firstChild;o;o=o.nextSibling)if(o.nodeType===1&&o.tagName===el.tagName&&w(o)){o.replaceWith(el);return}'
  + 'H.appendChild(el)})};'
  + 'if(h.title!=null)d.title=h.title;'
  + 'g(h.meta,"meta",function(a){var n=a.name?"name":a.property?"property":a.httpEquiv?"http-equiv":null,'
  + 'v=String(a.name||a.property||a.httpEquiv);'
  + 'return n&&function(o){return o.getAttribute(n)===v}});'
  + 'g(h.link,"link",function(a){return function(o){return o.getAttribute("rel")===String(a.rel)'
  + '&&o.getAttribute("href")===(a.href==null?null:String(a.href))}})};';

const ID_PREFIX = /^[A-Za-z][\w-]*$/;

function isThenable(value) {
  return value != null && typeof value.then === 'function';
}

function inFrame(frame, fn) {
  return frame ? _runInComponentSSR(frame, fn) : fn();
}

// `--` cannot end the comment early: escapeHtml leaves it alone, so it is
// broken up here.
function errorComment(error) {
  if (!_exposesErrorDetails()) return '<!-- SSR Error -->';
  const message = escapeHtml(String((error && error.message) || 'Component error')).replace(/--/g, '- -');
  return `<!-- SSR Error: ${message} -->`;
}

function defaultOnError(error) {
  // A coded error leads with its code, as a diagnostic does.
  if (error != null && typeof error.code === 'string' && error.code.startsWith('ERR_')) console.error(`${error.code} ${error.message}`);
  else console.error('[what-server] Error during streaming SSR:', error);
}

function timeoutError() {
  return Object.assign(
    new Error(`[what-server] A resource was still pending after ${MAX_ATTEMPTS} attempts during streaming SSR.`),
    { code: 'ERR_SSR_SUSPENSE_TIMEOUT' },
  );
}

// A streamed boundary that cannot finish keeps its fallback; the client is
// told to render it.
class BoundaryFailure {
  constructor(error) {
    this.error = error;
  }
}

// --- Segments -------------------------------------------------------------
//
// A segment is the shell (id null) or one streamed boundary. `parent` is the
// segment whose output holds its placeholder: it is sent only after its parent.
// `detached` lists the boundaries whose placeholders sit in this segment's
// buffer, with the offset, so discarding that part of the buffer cancels them.

/**
 * @typedef {object} Segment
 * @property {any} r
 * @property {string | null} id
 * @property {Segment | null} parent
 * @property {any} inheritedBoundary
 * @property {any[]} items
 * @property {any[]} owners
 * @property {string} buf
 * @property {Array<{ suspense: boolean, vnode: any, owner: any, bufStart: number, itemIndex: number, ns: string | null }>} scopes
 * @property {Array<{ segment: Segment, at: number }>} detached
 * @property {Segment[]} waiting
 * @property {boolean} emitted
 * @property {boolean} cancelled
 * @property {unknown} failure
 * @property {string | null} ns      the namespace of the next item (enterNamespace)
 * @property {string | null} baseNs  the namespace the segment's content starts in
 * @property {string | null} key     the hydration key waiting for the next write (compiled.js)
 */

/** @returns {Segment} */
function createSegment(r, parent, id, inheritedBoundary, ns, baseNs) {
  return {
    r,
    id,
    parent,
    inheritedBoundary,
    items: [],
    owners: [],
    buf: '',
    scopes: [],
    detached: [],
    waiting: [],
    emitted: false,
    cancelled: false,
    failure: null,
    ns,
    baseNs,
    key: null,
  };
}

// Everything a segment's output gains goes through here, so a component's
// pending hydration key lands on the element its output opens with.
function put(seg, html) {
  if (seg.key !== null && html !== '') {
    html = placeKey(html, seg.key);
    seg.key = null;
  }
  seg.buf += html;
}

function push(seg, node, owner) {
  seg.items.push(node);
  seg.owners.push(owner);
}

function pushChildren(seg, children, owner) {
  for (let i = children.length - 1; i >= 0; i--) push(seg, children[i], owner);
}

// Process work items until the segment is finished (returns null) or has to
// wait outside any <Suspense> (returns the thenable; the blocked item is back
// on the stack).
function runSegment(seg) {
  const { r, items, owners } = seg;
  while (items.length) {
    if (r.aborted || seg.cancelled) return null;
    const node = items.pop();
    const owner = owners.pop();
    let blocker;
    try {
      blocker = step(seg, node, owner);
    } catch (error) {
      if (error instanceof BoundaryFailure) throw error;
      _claimThrow(error);
      handleError(seg, error, node);
      continue;
    }
    if (blocker && !detach(seg, blocker)) return blocker;
  }
  return null;
}

function step(seg, node, owner) {
  if (node == null || node === false || node === true) return null;
  const type = typeof node;
  if (type === 'string') { put(seg, escapeHtml(node)); return null; }
  if (type === 'number') { put(seg, String(node)); return null; }
  if (type === 'function') return stepFunction(seg, node, owner, 0);
  if (Array.isArray(node)) {
    put(seg, ARRAY_OPEN);
    push(seg, mark(CLOSE, { html: ARRAY_CLOSE }), owner);
    pushChildren(seg, node, owner);
    return null;
  }

  if (node instanceof Mark) {
    const marker = /** @type {any} */ (node);
    switch (marker.$m) {
      case CLOSE: put(seg, marker.html); return null;
      case END:
        if (seg.key === marker.frame._ownerPath) seg.key = marker.outer;
        return null;
      case SCOPE_END: seg.scopes.pop(); return null;
      case NS_END: seg.ns = marker.ns; return null;
      case SELECT_END: markSelectedIn(seg, marker); return null;
      case RETRY: return retry(seg, marker, owner);
      case AWAITED:
        if (marker.failed) throw marker.error;
        push(seg, marker.value, marker.frame);
        return null;
    }
  }

  // Compiled JSX (ssr-runtime.js, compiled.js): finished markup, or markup and
  // between it the thunks, vnodes and attributes rendered here in document
  // order, as the same children of an h() tree would be.
  if (isHtml(node)) {
    const parts = node.parts(seg.ns);
    if (typeof parts === 'string') {
      put(seg, parts);
      return null;
    }
    enterNamespace(seg, node.childNs(seg.ns), owner);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      push(seg, typeof part === 'string' ? mark(CLOSE, { html: part }) : part, owner);
    }
    return null;
  }

  if (!isVNode(node)) {
    put(seg, _plainText(node));
    return null;
  }

  const tag = node.tag;
  if (SERVER_SKIPPED_TAGS.has(tag)) return null;

  // A boundary's work items: its closing marker, SCOPE_END, then its children.
  // bufStart is where its content starts, right after <!--b-->.
  if (tag === '__suspense' || tag === '__errorBoundary') {
    put(seg, BOUNDARY_OPEN);
    seg.scopes.push({
      suspense: tag === '__suspense',
      vnode: node,
      owner,
      bufStart: seg.buf.length,
      itemIndex: seg.items.length,
      ns: seg.ns,
    });
    push(seg, mark(CLOSE, { html: BOUNDARY_CLOSE }), owner);
    push(seg, mark(SCOPE_END), owner);
    pushChildren(seg, node.children || [], owner);
    return null;
  }

  if (typeof tag === 'function') return stepComponent(seg, node, owner, 0);

  assertSafeTag(tag, node);
  const props = node.props;
  const field = _field(tag, props);
  put(seg, `<${tag}${renderAttrs(field ? field.props : props || {})}>`);
  if (VOID_ELEMENTS.has(tag)) return null;
  const rawInner = _resolveInnerHTML(props);
  if (rawInner != null) {
    seg.buf += `${String(rawInner)}</${tag}>`;
    return null;
  }
  seg.buf += _afterOpen(tag, seg.ns);
  if (_isTextContent(tag, seg.ns)) {
    seg.buf += `${_rawText(tag, node.children, seg.ns, field)}</${tag}>`;
    return null;
  }
  enterNamespace(seg, childNamespace(seg.ns, tag, props && props.encoding), owner);
  push(seg, mark(CLOSE, { html: `</${tag}>` }), owner);
  if (field && field.select) push(seg, mark(SELECT_END, { start: seg.buf.length, value: field.select.value }), owner);
  pushChildren(seg, node.children, owner);
  return null;
}

// A finished <select>'s options, marked in the segment's output. Content a
// boundary inside the select streams later is in another segment, and is
// left as it is; so is everything when one did (its placeholder's offset
// must not move).
function markSelectedIn(seg, marker) {
  if (seg.buf.length < marker.start || seg.detached.some((d) => d.at >= marker.start)) return;
  seg.buf = seg.buf.slice(0, marker.start) + _markSelected(seg.buf.slice(marker.start), marker.value);
}

// The items pushed next sit in namespace `ns` (what-core's childNamespace); the
// segment returns to its current one once they are done. The namespace decides
// whether a <script> or <style> holds raw text, and nothing else.
function enterNamespace(seg, ns, owner) {
  if (ns === seg.ns) return;
  push(seg, mark(NS_END, { ns: seg.ns }), owner);
  seg.ns = ns;
}

// A reactive child, a signal or a compiled keyed list: evaluated once, in the
// frame that owns it.
function stepFunction(seg, fn, owner, attempts) {
  const holder = _ownerCounter(owner || null, seg.r.ctx);
  const children = holder._ownerChildren;
  const resources = holder._ownerResources;
  let value;
  try {
    value = inFrame(owner, fn._mapArray ? () => _mapArrayToArray(fn) : fn);
  } catch (error) {
    if (isThenable(error)) return suspend(seg, fn, owner, attempts, children, resources, error);
    _claimThrow(error);
    // A throwing child renders an empty region, as in renderToString: one bad
    // binding must not take its component down with it.
    report(seg.r, error, 'render', seg.id);
    put(seg, REGION_OPEN + REGION_CLOSE);
    return null;
  }
  put(seg, REGION_OPEN);
  push(seg, mark(CLOSE, { html: REGION_CLOSE }), owner);
  // An array is the region's rows, written with their keys when they are
  // keyed (arrayKeys).
  if (Array.isArray(value)) {
    put(seg, ARRAY_OPEN + arrayKeys(value));
    push(seg, mark(CLOSE, { html: ARRAY_CLOSE }), owner);
    pushChildren(seg, value, owner);
  } else {
    push(seg, value, owner);
  }
  return null;
}

function stepComponent(seg, node, owner, attempts) {
  const holder = _ownerCounter(owner || null, seg.r.ctx);
  const children = holder._ownerChildren;
  const resources = holder._ownerResources;
  const frame = _beginComponentSSR(node.tag, owner);
  // A built-in the compiler lowers away has no key (hydration-data.js).
  const stepped = _assignOwnerPath(frame, owner, seg.r.ctx);
  const outer = seg.key;
  if (stepped) seg.key = frame._ownerPath;
  let result;
  try {
    // In its frame for its code after an `await` too (an async component).
    result = _runComponentAsync(frame, () => node.tag(_componentProps(node)));
  } catch (error) {
    seg.key = outer;
    if (isThenable(error)) return suspend(seg, node, owner, attempts, children, resources, error);
    throw error;
  } finally {
    _endComponentSSR(frame);
  }
  push(seg, mark(END, { frame, outer }), frame);
  if (isThenable(result)) {
    const awaited = mark(AWAITED, { frame, failed: false, value: undefined, error: undefined });
    push(seg, awaited, frame);
    return result.then(
      (value) => { awaited.value = value; },
      (error) => { awaited.failed = true; awaited.error = error; },
    );
  }
  push(seg, result, frame);
  return null;
}

// Something suspended: wait for it, then run the same node again in place.
// `children` and `resources` are the owner's counters before the attempt (see
// hydration-data.js in what-core); restoring them gives the retry the same
// owner path and resource keys, so it finds what the first attempt started.
function suspend(seg, node, owner, attempts, children, resources, thenable) {
  push(seg, mark(RETRY, { node, attempts: attempts + 1, children, resources }), owner);
  return thenable;
}

function retry(seg, marker, owner) {
  const { node, attempts } = marker;
  if (attempts > MAX_ATTEMPTS) {
    const error = timeoutError();
    if (fallBackToSuspense(seg, error)) return null;
    if (seg.id !== null) throw new BoundaryFailure(error);
    throw error;
  }
  const holder = _ownerCounter(owner || null, seg.r.ctx);
  holder._ownerChildren = marker.children;
  holder._ownerResources = marker.resources;
  return typeof node === 'function'
    ? stepFunction(seg, node, owner, attempts)
    : stepComponent(seg, node, owner, attempts);
}

// Give up on the innermost <Suspense> still open in this segment: its fallback
// becomes its final content, as renderToStringAsync does once its passes run out.
function fallBackToSuspense(seg, error) {
  for (let i = seg.scopes.length - 1; i >= 0; i--) {
    const scope = seg.scopes[i];
    if (!scope.suspense) continue;
    unwindTo(seg, scope, i);
    report(seg.r, error, 'boundary', seg.id);
    renderFallback(seg, scope, null);
    return true;
  }
  return false;
}

// Drop everything a scope produced and everything still queued inside it.
function unwindTo(seg, scope, index) {
  seg.items.length = scope.itemIndex;
  seg.owners.length = scope.itemIndex;
  seg.scopes.length = index;
  seg.buf = seg.buf.slice(0, scope.bufStart);
  seg.ns = scope.ns;
  seg.key = null;
  cancelDetachedFrom(seg, scope.bufStart);
}

// The fallback in place of an unwound boundary's content, opened by
// <!--b!--> instead of the <!--b--> it was opened with.
function renderFallback(seg, scope, error) {
  seg.buf = seg.buf.slice(0, scope.bufStart - BOUNDARY_OPEN.length) + BOUNDARY_FALLBACK;
  push(seg, mark(CLOSE, { html: BOUNDARY_CLOSE }), scope.owner);
  push(seg, _boundaryFallback(scope.vnode, error, (e) => report(seg.r, e, 'boundary', seg.id)), scope.owner);
}

function cancelDetachedFrom(seg, offset) {
  const keep = [];
  for (const entry of seg.detached) {
    if (entry.at >= offset) cancel(entry.segment);
    else keep.push(entry);
  }
  seg.detached = keep;
}

function cancel(seg) {
  if (seg.cancelled) return;
  seg.cancelled = true;
  seg.r.pending--;
  for (const entry of seg.detached) cancel(entry.segment);
}

// The innermost <ErrorBoundary> around scope `index` of `seg`, or the one the
// segment inherited from the segment it was detached from.
function enclosingErrorBoundary(seg, index) {
  for (let i = index - 1; i >= 0; i--) {
    const scope = seg.scopes[i];
    if (!scope.suspense) return { vnode: scope.vnode, owner: scope.owner };
  }
  return seg.inheritedBoundary;
}

// A node inside a <Suspense> has to wait: move the rest of that boundary into a
// segment of its own and put a placeholder with the fallback in its place.
// Returns false when no <Suspense> is open, so the caller waits in place.
function detach(seg, blocker) {
  let index = seg.scopes.length - 1;
  while (index >= 0 && !seg.scopes[index].suspense) index--;
  if (index < 0) return false;

  const r = seg.r;
  const scope = seg.scopes[index];
  const id = `${r.idPrefix}${r.nextId++}`;
  const boundary = createSegment(r, seg, id, enclosingErrorBoundary(seg, index), seg.ns, scope.ns);
  // The boundary's children move to the new segment; its closing marker stays
  // here, after the placeholder and the fallback.
  const first = scope.itemIndex + 2;
  boundary.items = seg.items.splice(first);
  boundary.owners = seg.owners.splice(first);
  seg.items.length = scope.itemIndex + 1;
  seg.owners.length = scope.itemIndex + 1;
  // A key still pending belongs to a component inside the boundary: the
  // boundary's <!--b--> settled any from outside.
  boundary.key = seg.key;
  seg.key = null;
  boundary.buf = seg.buf.slice(scope.bufStart);
  seg.buf = seg.buf.slice(0, scope.bufStart);
  for (let i = index + 1; i < seg.scopes.length; i++) {
    const inner = seg.scopes[i];
    boundary.scopes.push({ ...inner, itemIndex: inner.itemIndex - first, bufStart: inner.bufStart - scope.bufStart });
  }
  seg.scopes.length = index;
  seg.ns = scope.ns;
  const keep = [];
  for (const entry of seg.detached) {
    if (entry.at >= scope.bufStart) {
      entry.segment.parent = boundary;
      boundary.detached.push({ segment: entry.segment, at: entry.at - scope.bufStart });
    } else {
      keep.push(entry);
    }
  }
  seg.detached = keep;

  seg.detached.push({ segment: boundary, at: seg.buf.length });
  seg.buf += `<template id="pl-${id}"></template>`;
  push(seg, mark(CLOSE, { html: `<!--pl-${id}-->` }), scope.owner);
  push(seg, _boundaryFallback(scope.vnode, null, (e) => report(r, e, 'boundary', seg.id)), scope.owner);
  r.pending++;
  driveBoundary(boundary, blocker);
  return true;
}

// An error escaped a node. Inside an <ErrorBoundary> the boundary's output so
// far is discarded and its fallback renders in its place, which is what
// renderToString does; a streamed boundary whose <ErrorBoundary> already went
// out with the shell carries that fallback as its content instead. Outside one,
// the error is contained to the component it came from and replaced by an
// error comment, so one broken component does not take the page with it.
function handleError(seg, error, node) {
  const r = seg.r;
  for (let i = seg.scopes.length - 1; i >= 0; i--) {
    const scope = seg.scopes[i];
    if (scope.suspense) continue;
    unwindTo(seg, scope, i);
    report(r, error, 'boundary', seg.id);
    renderFallback(seg, scope, error);
    return;
  }

  if (seg.inheritedBoundary) {
    const errorBoundary = seg.inheritedBoundary;
    seg.inheritedBoundary = null;
    seg.items.length = 0;
    seg.owners.length = 0;
    seg.scopes.length = 0;
    seg.buf = '';
    seg.key = null;
    seg.ns = seg.baseNs;
    cancelDetachedFrom(seg, 0);
    report(r, error, 'boundary', seg.id);
    push(seg, _boundaryFallback(errorBoundary.vnode, error, (e) => report(r, e, 'boundary', seg.id)), errorBoundary.owner);
    return;
  }

  if (node instanceof Mark ? node.$m === AWAITED || node.$m === RETRY : isVNode(node) && typeof node.tag === 'function') {
    report(r, error, 'render', seg.id);
    put(seg, errorComment(error));
    return;
  }
  while (seg.items.length) {
    const item = seg.items.pop();
    seg.owners.pop();
    if (!(item instanceof Mark)) continue;
    const marker = /** @type {any} */ (item);
    if (marker.$m === CLOSE) put(seg, marker.html);
    else if (marker.$m === SCOPE_END) seg.scopes.pop();
    else if (marker.$m === NS_END) seg.ns = marker.ns;
    else if (marker.$m === END) {
      if (seg.key === marker.frame._ownerPath) seg.key = marker.outer;
      report(r, error, 'render', seg.id);
      put(seg, errorComment(error));
      return;
    }
  }
  throw error;
}

function report(r, error, phase, boundaryId) {
  try {
    r.onError(error, boundaryId != null ? { phase, boundaryId } : { phase });
  } catch (hookError) {
    defaultOnError(hookError);
  }
}

// --- Driving segments -------------------------------------------------------

const ignore = () => {};

function settle(thenable) {
  return Promise.resolve(thenable).then(ignore, ignore);
}

async function driveShell(r, shell) {
  try {
    for (let blocker = runSlice(r, shell); blocker !== null; blocker = runSlice(r, shell)) {
      await settle(blocker);
      if (r.aborted) return;
    }
  } catch (error) {
    failRender(r, error, 'shell');
    return;
  }
  if (r.aborted) return;
  if (!r.buffered) {
    r.ctx.response._commit((location) => lateRedirect(r, location));
    write(r, r.document.open(r.ctx) + shell.buf + r.document.shellData(r.ctx, r.sent, r.options));
    if (r.document.head) r.headSent = headSnapshot(r.ctx.head);
    r.storesSent = storeSnapshots(r.ctx);
  }
  shell.emitted = true;
  r.resolveShell();
  emitWaiting(shell);
  maybeEnd(r);
}

async function driveBoundary(seg, blocker) {
  const r = seg.r;
  try {
    while (blocker !== null) {
      await settle(blocker);
      if (r.aborted || seg.cancelled) return;
      blocker = runSlice(r, seg);
    }
  } catch (error) {
    if (r.aborted || seg.cancelled) return;
    if (!(error instanceof BoundaryFailure)) {
      try {
        _claimThrow(error);
      } catch (fatal) {
        failRender(r, fatal, 'stream');
        return;
      }
    }
    const cause = error instanceof BoundaryFailure ? error.error : error;
    report(r, cause, 'boundary', seg.id);
    seg.failure = cause;
    cancelDetachedFrom(seg, 0);
  }
  if (r.aborted || seg.cancelled) return;
  if (seg.parent.emitted) emitBoundary(seg);
  else seg.parent.waiting.push(seg);
}

// One synchronous slice of the render, then the effect re-runs its writes
// queued, outside any render (see what-core's __flushOutsideServerContext).
function runSlice(r, seg) {
  try {
    return runWithServerContext(r.ctx, () => runSegment(seg));
  } finally {
    __flushOutsideServerContext();
  }
}

function emitBoundary(seg) {
  const r = seg.r;
  if (!r.buffered) {
    const payload = resourcePayload(r.ctx, r.sent);
    const stores = changedStores(r);
    if (stores) payload.islandStores = stores;
    let html;
    if (seg.failure) {
      payload.failed = { [seg.id]: errorRecord(seg.failure) };
      html = dataElement(payload, r.options) + swapScript(r, `_$W.s(${JSON.stringify(seg.id)},1)`);
    } else {
      const head = r.headSent ? lateHead(r, seg.id) : null;
      if (head && r.options.noScripts) payload.head = { [seg.id]: head };
      let code = `_$W.s(${JSON.stringify(seg.id)})`;
      if (head && !r.options.noScripts) {
        code += `;_$W.t(${serializeState(head)})`;
        if (!r.headDefined) {
          code = HEAD_FUNCTION + code;
          r.headDefined = true;
        }
      }
      html = dataElement(payload, r.options) + `<template id="${seg.id}">${seg.buf}</template>` + swapScript(r, code);
    }
    write(r, html);
  }
  seg.emitted = true;
  r.pending--;
  emitWaiting(seg);
  maybeEnd(r);
}

// The inline script for one boundary, carrying the swap function the first
// time. Nothing without scripts.
function swapScript(r, code) {
  if (r.options.noScripts) return '';
  if (r.swapDefined) return scriptElement(code, r.options);
  r.swapDefined = true;
  return scriptElement(SWAP_FUNCTION + code, r.options);
}

function emitWaiting(seg) {
  const waiting = seg.waiting;
  seg.waiting = [];
  for (const child of waiting) if (!child.cancelled) emitBoundary(child);
}

// A redirect from a streamed boundary: the status line has gone out, so the
// browser is told to navigate. Without inline scripts there is no way to.
function lateRedirect(r, location) {
  if (r.options.noScripts) {
    report(r, Object.assign(
      new Error(`[what-server] redirect(${JSON.stringify(location)}) after the shell was sent needs an inline script, and this stream has noScripts.`),
      { code: 'ERR_LATE_REDIRECT' },
    ), 'stream');
    return;
  }
  write(r, scriptElement(`location.replace(${serializeState(location)})`, r.options));
}

function nonceAttr(options) {
  return options.nonce ? ` nonce="${escapeHtml(String(options.nonce))}"` : '';
}

function scriptElement(code, options) {
  return `<script${nonceAttr(options)}>${code}</script>`;
}

function dataElement(payload, options) {
  for (const _ in payload) {
    return `<script type="application/json" data-what-data${nonceAttr(options)}>${serializeState(payload)}</script>`;
  }
  return '';
}

// --- Head and island stores after the shell ---------------------------------

function headSnapshot(sink) {
  return { title: sink.title, metas: new Map(sink.metas), links: new Map(sink.links) };
}

// The <Head> writes made since the last chunk, or null. Reported once per
// stream in development: tags set inside a streamed boundary reach the page by
// script, so a crawler that runs none sees the shell's head without them.
function lateHead(r, boundaryId) {
  const sink = r.ctx.head;
  const sent = r.headSent;
  /** @type {{ title?: string, meta?: any[], link?: any[] } | null} */
  let out = null;
  if (sink.title !== sent.title) {
    sent.title = sink.title;
    if (sink.title != null) (out ||= {}).title = String(sink.title);
  }
  for (const [key, attrs] of sink.metas) {
    if (sent.metas.get(key) === attrs) continue;
    sent.metas.set(key, attrs);
    ((out ||= {}).meta ||= []).push(attrs);
  }
  for (const [key, attrs] of sink.links) {
    if (sent.links.get(key) === attrs) continue;
    sent.links.set(key, attrs);
    ((out ||= {}).link ||= []).push(attrs);
  }
  if (out && _isDevMode && !r.lateHeadReported) {
    r.lateHeadReported = true;
    console.warn(
      `[what-server] <Head> inside a streamed <Suspense> (boundary ${boundaryId}) set head tags after the shell was sent. ` +
      'They are sent with the boundary and applied by script, so the document\'s own <head> does not carry them. ' +
      'Set them outside the boundary (or from the loader\'s data) to have them in the server HTML. (ERR_SSR_LATE_HEAD)',
    );
  }
  return out;
}

function storeSnapshots(ctx) {
  if (!ctx.islandStores.size) return null;
  const out = new Map();
  const snapshot = getIslandStoresSnapshot(ctx);
  for (const name in snapshot) out.set(name, JSON.stringify(snapshot[name]));
  return out;
}

// Island stores written by a boundary after the shell was sent: only those
// whose snapshot changed since it was last sent.
function changedStores(r) {
  if (!r.ctx.islandStores.size) return null;
  const sent = r.storesSent || (r.storesSent = new Map());
  const snapshot = getIslandStoresSnapshot(r.ctx);
  /** @type {Record<string, any> | null} */
  let out = null;
  for (const name in snapshot) {
    const json = JSON.stringify(snapshot[name]);
    if (sent.get(name) === json) continue;
    sent.set(name, json);
    (out ||= {})[name] = snapshot[name];
  }
  return out;
}

// A body-only stream: no document around it, and the shell's data (loader
// data, resolved resources, island stores) in a data element after it.
const BODY = {
  head: false,
  open: () => '',
  shellData(ctx, sent, options) {
    const payload = resourcePayload(ctx, sent);
    if (ctx.loaderData !== undefined) payload.loaderData = ctx.loaderData;
    const islandStores = getIslandStoresSnapshot(ctx);
    for (const _ in islandStores) {
      payload.islandStores = islandStores;
      break;
    }
    return dataElement(payload, options);
  },
  close: '',
};

// --- Buffered output -------------------------------------------------------
//
// Each segment's buffer holds, for every boundary detached from it,
// `<template id="pl-ID"></template>FALLBACK<!--pl-ID-->` at the offset its
// `detached` entry records. Stitching replaces that range with the boundary's
// own stitched content, or, for a boundary that failed, with its fallback, so
// the result is what a browser shows once every swap has run.

function stitch(seg) {
  return stitchRange(seg, 0, seg.buf.length);
}

function stitchRange(seg, start, end) {
  const children = seg.detached
    .filter((entry) => !entry.segment.cancelled && entry.at >= start && entry.at < end)
    .sort((a, b) => a.at - b.at);
  let out = '';
  let at = start;
  for (const { segment, at: open } of children) {
    if (open < at) continue; // inside a fallback that was replaced
    const opening = `<template id="pl-${segment.id}"></template>`;
    const closing = `<!--pl-${segment.id}-->`;
    const close = seg.buf.indexOf(closing, open + opening.length);
    out += seg.buf.slice(at, open);
    out += segment.failure ? stitchRange(seg, open + opening.length, close) : stitch(segment);
    at = close + closing.length;
  }
  return out + seg.buf.slice(at, end);
}

// --- Output -----------------------------------------------------------------
//
// Writes made in one tick are coalesced into one chunk. Consumers pull chunks
// with nextChunk(); a slow consumer leaves them queued.

function write(r, html) {
  if (!html) return;
  r.out += html;
  if (!r.flushQueued) {
    r.flushQueued = true;
    queueMicrotask(() => flush(r));
  }
}

function flush(r) {
  r.flushQueued = false;
  if (r.out) {
    r.chunks.push(r.out);
    r.out = '';
  }
  if (r.endWhenFlushed && !r.ended) {
    r.ended = true;
    if (r.abortReason !== null) r.rejectAll(r.abortReason);
    else r.resolveAll();
  }
  wake(r);
}

function maybeEnd(r) {
  if (r.ended || r.endWhenFlushed || !r.shell.emitted || r.pending > 0) return;
  r.ctx.release();
  if (r.buffered) {
    r.ended = true;
    r.result = stitch(r.shell);
    r.resolveAll();
    return;
  }
  write(r, r.document.close);
  r.endWhenFlushed = true;
  if (!r.flushQueued) flush(r);
}

function wake(r) {
  const waiter = r.waiter;
  r.waiter = null;
  if (waiter) waiter();
}

function failRender(r, error, phase) {
  if (r.ended) return;
  report(r, error, phase);
  r.error = error;
  r.aborted = true;
  r.ended = true;
  r.ctx.release();
  r.rejectShell(error);
  r.rejectAll(error);
  wake(r);
}

// Stop the render: the consumer went away, or the caller's signal aborted. The
// render's own signal aborts with it, so the loader's and every fetcher's work
// stops too. Before the shell (or in a buffered render) every promise rejects
// with the reason. After the shell, what was rendered is closed off: the
// document's closing tags are written, boundaries still pending keep their
// fallbacks, and allReady rejects, because they were never sent.
function abortRender(r, reason) {
  if (r.ended || r.aborted || r.endWhenFlushed) return;
  r.aborted = true;
  const error = reason ?? Object.assign(new Error('The render was aborted.'), { name: 'AbortError' });
  r.ctx.abort(error);
  r.ctx.release();
  if (r.buffered || !r.shell.emitted) {
    r.error = error;
    r.ended = true;
    r.rejectShell(error);
    r.rejectAll(error);
    wake(r);
    return;
  }
  r.abortReason = error;
  const rest = r.out + r.document.close;
  r.out = '';
  if (rest) r.chunks.push(rest);
  r.endWhenFlushed = true;
  if (!r.flushQueued) flush(r);
}

// A failed render rejects its reader once the chunks already made are read;
// an aborted one simply ends.
function nextChunk(r) {
  if (r.chunks.length) return Promise.resolve({ value: r.chunks.shift(), done: false });
  if (r.error) return Promise.reject(r.error);
  if (r.ended) return Promise.resolve({ value: undefined, done: true });
  return new Promise((resolve) => { r.waiter = resolve; }).then(() => nextChunk(r));
}

function claim(r) {
  if (r.claimed) throw new Error('[what-server] This render stream is already being consumed; pipe, read or iterate it once.');
  r.claimed = true;
}

/** @returns {Promise<void>} */
function drained(writable) {
  return new Promise((resolve) => {
    const done = () => {
      writable.off('drain', done);
      writable.off('close', done);
      resolve();
    };
    writable.on('drain', done);
    writable.on('close', done);
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  promise.catch(ignore);
  return { promise, resolve, reject };
}

function randomIdPart() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return words[0].toString(36) + words[1].toString(36);
}

/** The validated idPrefix option. @param {unknown} idPrefix */
function idPrefixOf(idPrefix) {
  if (idPrefix === undefined) return 'wb';
  if (typeof idPrefix !== 'string' || !ID_PREFIX.test(idPrefix)) {
    // ERROR_CODES.SSR_INVALID_ID_PREFIX
    throw Object.assign(
      new TypeError(`[what-server] idPrefix ${JSON.stringify(idPrefix)} is not a letter followed by letters, digits, "_" or "-".`),
      { code: 'ERR_SSR_INVALID_ID_PREFIX' },
    );
  }
  return idPrefix;
}

/**
 * Check the options a stream is started with before any work is done for it.
 * @internal
 */
export function checkStreamOptions(options) {
  idPrefixOf(options.idPrefix);
}

// Start the render: shared by the streamed and the buffered forms. It owns
// `ctx` from here: every way the render ends releases it.
function startRender(vnode, ctx, options, document) {
  ensureServerRuntime();
  let idPrefix;
  try {
    idPrefix = idPrefixOf(options.idPrefix);
  } catch (error) {
    ctx.release();
    throw error;
  }
  const shellReady = deferred();
  const allReady = deferred();
  const r = {
    ctx,
    options,
    document,
    buffered: !!document.buffered,
    onError: options.onError || defaultOnError,
    idPrefix: `${idPrefix}${randomIdPart()}-`,
    nextId: 0,
    sent: new Set(),
    pending: 0,
    aborted: false,
    swapDefined: false,
    headDefined: false,
    lateHeadReported: false,
    /** @type {{ title: any, metas: Map<string, any>, links: Map<string, any> } | null} */
    headSent: null,
    /** @type {Map<string, string> | null} */
    storesSent: null,
    shell: /** @type {Segment | null} */ (null),
    result: '',
    out: '',
    chunks: [],
    flushQueued: false,
    endWhenFlushed: false,
    ended: false,
    /** @type {unknown} what the reader is rejected with: a failure, or an abort before the shell */
    error: null,
    /** @type {unknown} an abort after the shell: allReady rejects with it */
    abortReason: null,
    waiter: null,
    claimed: false,
    resolveShell: () => shellReady.resolve(),
    rejectShell: shellReady.reject,
    resolveAll: () => allReady.resolve(),
    rejectAll: allReady.reject,
    shellReady: shellReady.promise,
    allReady: allReady.promise,
  };
  r.shell = createSegment(r, null, null, null, null, null);
  push(r.shell, vnode, null);

  // The render's own signal follows the caller's (context.js); it dies with
  // the render, so this listener needs no removal.
  if (ctx.signal.aborted) abortRender(r, ctx.signal.reason);
  else ctx.signal.addEventListener('abort', () => abortRender(r, ctx.signal.reason), { once: true });
  if (!r.aborted) driveShell(r, r.shell);
  return r;
}

/**
 * Start a streaming render. `ctx` is the render context; `document` frames
 * the output (BODY for a bare body, see index.js for a whole document).
 * @internal
 */
export function startStream(vnode, ctx, options, document) {
  const r = startRender(vnode, ctx, options, document);
  return {
    shellReady: r.shellReady,
    allReady: r.allReady,
    /** The response components set through getResponse(). */
    response: ctx.response,
    abort(reason) {
      abortRender(r, reason);
    },
    pipe(writable) {
      claim(r);
      const onClose = () => {
        if (!r.ended) abortRender(r);
      };
      writable.on('close', onClose);
      (async () => {
        try {
          for (let chunk = await nextChunk(r); !chunk.done; chunk = await nextChunk(r)) {
            if (writable.destroyed) return;
            if (!writable.write(chunk.value)) await drained(writable);
          }
          writable.off('close', onClose);
          writable.end();
        } catch (error) {
          writable.off('close', onClose);
          writable.destroy(error);
        }
      })();
      return writable;
    },
    get readable() {
      claim(r);
      const encoder = new TextEncoder();
      return new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await nextChunk(r);
            if (chunk.done) controller.close();
            else controller.enqueue(encoder.encode(chunk.value));
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          abortRender(r, reason);
        },
      });
    },
    [Symbol.asyncIterator]() {
      claim(r);
      return {
        next: () => nextChunk(r),
        return() {
          abortRender(r);
          return Promise.resolve({ value: undefined, done: true });
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}

const BUFFERED = { buffered: true };

/**
 * Render with the streaming engine and resolve with the settled body, every
 * boundary's content in place. Rejects with the error that failed the render,
 * or with the abort reason.
 * @internal
 * @returns {Promise<string>}
 */
export function renderBuffered(vnode, ctx, options = {}) {
  const r = startRender(vnode, ctx, options, BUFFERED);
  return r.allReady.then(() => r.result);
}

/**
 * Stream a vnode tree as HTML, shell first and boundaries out of order.
 *
 * options.loaderData  what useLoaderData() returns during this render
 * options.request     handed to server resource fetchers
 * options.response    what getResponse() returns (a createResponse()); the
 *                     stream also exposes it as `stream.response`
 * options.signal      aborting it stops the render and ends the stream
 * options.nonce       set on every <script> the stream writes (CSP)
 * options.noScripts   no inline scripts: streamed boundaries are sent as
 *                     templates for what-core's applyStreamedBoundaries()
 * options.onError     called with (error, { phase, boundaryId? }) for every
 *                     error the render contains or fails on; default
 *                     console.error. Never silent.
 * options.idPrefix    prefix for boundary ids (default 'wb'): a letter, then
 *                     letters, digits, '_' or '-'
 *
 * Returns { shellReady, allReady, response, pipe(writable), readable,
 * abort(reason) }. It is also async-iterable (string chunks). Consume it one
 * way, once.
 */
export function renderToStream(vnode, options = {}) {
  checkStreamOptions(options);
  const ctx = createRenderContext(options.loaderData, { signal: options.signal, request: options.request, response: options.response });
  return startStream(vnode, ctx, options, BODY);
}
