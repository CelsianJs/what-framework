export function schedules() {
  const result = [];
  for (const a of ['resolve', 'reject']) {
    for (const b of ['resolve', 'reject']) {
      const first = [a, 'A'];
      const second = [b, 'B'];
      result.push(
        [['mount', 'A'], ['supersede', 'B'], first, second],
        [['mount', 'A'], ['supersede', 'B'], second, first],
        [['mount', 'A'], ['dispose'], ['mount', 'B'], second, first],
        [['mount', 'A'], ['dispose'], ['mount', 'B'], first, second],
        [['mount', 'A'], ['supersede', 'B'], ['dispose'], first, second],
      );
    }
  }
  return result;
}

// Model one live observer per source. A superseded or disposed flight may
// still finish on the transport, but cannot publish data or error.
export function asyncSourceOracle() {
  let current = null;
  let mounted = false;
  let data = null;
  let error = null;
  let pending = false;
  let starts = 0;
  return {
    step([action, request]) {
      if (action === 'mount' || action === 'supersede') {
        mounted = true;
        current = request;
        pending = true;
        error = null;
        starts++;
      } else if (action === 'dispose') {
        mounted = false;
        current = null;
        pending = false;
      } else if (mounted && request === current) {
        if (action === 'resolve') data = request;
        else error = 'failed ' + request;
        pending = false;
        current = null;
      }
      return { starts, view: mounted ? { data, error, pending } : null };
    },
  };
}

// Model one observer of an async computed (docs/ASYNC.md), in one of four
// modes. The observer shows a binding over the value that catches errors
// itself (`v:<value>`, `e:<message>`; a held binding keeps what it showed), the
// value's pending() state, and a label bound to the source the value is
// fetched for.
//   default     a supersede is a plain write: the label shows it at once
//   suspense    as default, under <Suspense>: the fallback stands until the
//               first landing and never comes back; onMount runs once, then
//   transition  a supersede is startTransition(() => source(B)): the label
//               waits for B's run to land, and commits with it
//   optimistic  as transition, adding the overlay `opt:B` first: shown at once
//               when there is a value to put it on, dropped with the commit
export function asyncComputedOracle(mode) {
  let current = null;
  let mounted = false;
  let hasValue = false;
  let landed = false;
  let inFlight = false;
  let starts = 0;
  let shown = '';
  let label = '';
  let source = '';
  let open = false;
  let overlay = null;
  let mounts = 0;
  return {
    step([action, request]) {
      if (action === 'mount') {
        mounted = true;
        current = request;
        inFlight = true;
        starts++;
        hasValue = false;
        landed = false;
        shown = '';
        label = source = request;
        open = false;
        overlay = null;
      } else if (action === 'supersede') {
        current = request;
        inFlight = true;
        starts++;
        source = request;
        if (mode === 'transition' || mode === 'optimistic') {
          open = true;
          if (mode === 'optimistic') overlay = 'opt:' + request;
        } else {
          label = request;
        }
      } else if (action === 'dispose') {
        mounted = false;
        current = null;
        inFlight = false;
        open = false;
        overlay = null;
      } else if (mounted && request === current) {
        if (action === 'resolve') {
          hasValue = true;
          shown = 'v:' + request;
        } else {
          shown = 'e:failed ' + request;
        }
        if (mode === 'suspense' && !landed) mounts++;
        landed = true;
        inFlight = false;
        current = null;
        if (open) {
          label = source;
          open = false;
          overlay = null;
        }
      }
      if (!mounted) return { starts, view: null };
      // Behind the fallback the content is out of the document.
      const view = mode === 'suspense' && !landed
        ? { shown: null, pending: null, label: null }
        : { shown: overlay !== null && hasValue ? 'v:' + overlay : shown, pending: inFlight && hasValue, label };
      if (mode === 'suspense') Object.assign(view, { fallback: !landed, mounts });
      return { starts, view };
    },
  };
}
