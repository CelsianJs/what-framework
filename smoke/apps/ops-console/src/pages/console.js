// The console. Server-rendered shell, hydrated, then live.
//
// Three async surfaces meet here:
//   - useInfiniteQuery drives the event feed and APPENDS a page per "load older"
//   - useOptimistic acknowledges a row instantly and reconciles onto whatever
//     the server says, or rolls the row back when the server refuses
//   - the detail pane is a separate client-routed region mounted by
//     entry-client.js; this page only renders the empty <aside> it lands in
//
// The feed itself is deliberately NOT server-rendered: it is a live tail, and
// the first page arrives from /api/events after hydration. What IS
// server-rendered is everything an operator needs before JavaScript lands: the
// chrome, the filter form, the counts from the loader.

import {
  LiveRegion,
  Show,
  computed,
  effect,
  h,
  Head,
  rules,
  signal,
  simpleResolver,
  useForm,
  useId,
  useInfiniteQuery,
  useLoaderData,
} from 'what-framework';
import { useOptimistic } from 'what-server/actions';
import { Link } from 'what-router';

import { Footer, SeverityTag, TopBar } from '../components/chrome.js';
import { IncidentDialog } from '../components/incident-dialog.js';
import { PAGE_SIZE, fetchAcks, fetchEvents, postAck, postIncident } from '../lib/api.js';
import { clock } from '../lib/format.js';

export const loader = async () => {
  const { listServices, listSeverities, listEvents } = await import('../data/incidents.js');
  return {
    services: listServices(),
    severities: listSeverities(),
    total: listEvents(0, 1).total,
  };
};

export default function Console() {
  const { services, severities, total } = useLoaderData();

  const announcement = signal('Console ready. Feed is live.', 'ops:announcement');
  const serviceFilter = signal('', 'ops:filter');
  const dialogOpen = signal(false, 'ops:dialogOpen');

  // --- Event feed: one page appended per fetchNextPage() ------------------
  const feed = useInfiniteQuery({
    queryKey: ['events'],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal: abort }) => {
      // The initial fetch lives in an effect, and effects run during SSR too.
      // Node has no base URL for a relative fetch, so the server render yields
      // an empty page and the browser performs the real request. Everything
      // below is written to render that empty state without complaining.
      if (typeof window === 'undefined') return { events: [], nextCursor: null, total };
      return fetchEvents(pageParam, PAGE_SIZE, abort);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const loaded = computed(() => (feed.data().pages || []).flatMap((p) => p.events || []));
  const rows = computed(() => {
    const term = serviceFilter();
    const all = loaded();
    return term ? all.filter((event) => event.service.includes(term)) : all;
  });

  // --- Optimistic acknowledge --------------------------------------------
  // The reducer appends an ack with no `by`: that missing field IS the pending
  // state. Only the server can fill it in, so a row that says "acknowledged by
  // ops-bot" cannot be the optimistic guess.
  const acks = useOptimistic([], (list, action) => [...list, { id: action.id, by: null, at: null }]);
  const ackIndex = computed(() => new Map(acks.value().map((ack) => [ack.id, ack])));

  // Read the acknowledgements the server already has, so a reload does not
  // pretend every incident is unacknowledged.
  //
  // This wants to be onMount(), and is not. In what-framework 0.12.2 as
  // published, renderToString calls a component function directly with no
  // component context, so onMount (and onCleanup, useState, useRef, useEffect,
  // ...) throws "can only be called inside a component function" and takes the
  // whole server render down with a 500. A component runs exactly once, and on
  // the client that once is hydration, so a guarded call in the body does the
  // same job and works on every build.
  if (typeof window !== 'undefined') {
    fetchAcks()
      .then((list) => acks.set(list))
      .catch(() => announcement('Could not load existing acknowledgements.'));
  }

  async function acknowledge(id) {
    const action = { id };
    try {
      const confirmed = await acks.withOptimistic(action, async () => (await postAck(id)).acks);
      const record = confirmed.find((ack) => ack.id === id);
      announcement(`${id} acknowledged by ${record ? record.by : 'the server'}.`);
    } catch (err) {
      // withOptimistic has already rolled the row back by the time we get here.
      announcement(`Could not acknowledge ${id}: ${err.message}. Rolled back.`);
    }
  }

  // --- Filter form --------------------------------------------------------
  // useId pairs the label with the input and the input with its two description
  // slots. The ids have to survive the trip from SSR to hydration or every one
  // of those relationships points at nothing.
  const inputId = useId('svc');
  const hintId = useId('svc-hint');
  const errorId = useId('svc-error');

  const filterForm = useForm({
    defaultValues: { service: '' },
    resolver: simpleResolver({
      service: [rules.custom((value) => (
        typeof value === 'string' && value.trim().length === 1
          ? 'Use at least two characters, or leave it blank to show every service.'
          : undefined
      ))],
    }),
  });

  const filterError = () => filterForm.formState.error('service');

  const applyFilter = filterForm.handleSubmit((values) => {
    const term = values.service.trim().toLowerCase();
    serviceFilter(term);
    announcement(term ? `Feed filtered to services matching "${term}".` : 'Service filter cleared.');
  });

  // `aria-describedby` has to point at the error slot only while there IS an
  // error, and a function-valued attribute prop does not survive SSR (the
  // server serializes the thunk itself). So the server writes the static hint
  // pairing and the client takes over through a ref-scoped effect, which is
  // also what proves the client's useId sequence matches the server's: a drifted
  // id would leave this attribute pointing at an element that does not exist.
  const describeInput = (el) => {
    if (!el) return;
    effect(() => {
      el.setAttribute('aria-describedby', filterError() ? `${errorId()} ${hintId()}` : hintId());
    });
  };

  // --- Create ------------------------------------------------------------
  async function createIncident(values) {
    const { incident } = await postIncident(values);
    dialogOpen(false);
    // refetch() replaces the loaded pages with a fresh first page, which is
    // where a brand new incident lands (the feed is newest first).
    await feed.refetch();
    announcement(`${incident.id} declared: ${incident.title}`);
  }

  return h('div', { class: 'app' },
    h(Head, {
      title: 'Northwind Ops Console',
      meta: [{ name: 'description', content: 'Incident feed, acknowledgements and service health.' }],
    }),
    h(TopBar, { current: 'console' }),

    h('main', { class: 'grid' },
      h('section', { class: 'col feed-col', 'aria-labelledby': 'feed-heading' },
        h('div', { class: 'col-head' },
          h('h1', { id: 'feed-heading' }, 'Event feed'),
          h('button', {
            type: 'button',
            class: 'primary',
            'data-new-incident': '',
            onclick: () => dialogOpen(true),
          }, 'Declare incident'),
        ),

        h('form', { class: 'filter', onsubmit: applyFilter, 'data-filter-form': '' },
          h('label', { for: inputId(), class: 'filter-label' }, 'Service'),
          h('input', {
            id: inputId(),
            name: 'service',
            type: 'search',
            autocomplete: 'off',
            placeholder: 'payments',
            'data-filter-input': '',
            'aria-describedby': hintId(),
            ref: describeInput,
            oninput: filterForm.register('service').oninput,
            onblur: filterForm.register('service').onBlur,
          }),
          h('button', { type: 'submit', class: 'ghost', 'data-filter-apply': '' }, 'Apply'),
          h('p', { id: errorId(), class: 'field-error', role: 'alert', 'data-filter-error': '' },
            () => filterError()?.message || ''),
          h('p', { id: hintId(), class: 'hint', 'data-filter-hint': '' },
            `Filter the loaded events by service. ${services.length} services reporting.`),
        ),

        h('ul', { class: 'feed', 'data-feed': '' }, () => {
          const index = ackIndex();
          const list = rows();
          if (list.length === 0) {
            return h('li', { class: 'feed-empty', 'data-feed-empty': '' },
              serviceFilter() ? 'No loaded events match that service.' : 'Waiting for the event stream...');
          }
          return list.map((event) => {
            const ack = index.get(event.id);
            const state = !ack ? 'open' : (ack.by ? 'confirmed' : 'pending');
            return h('li', {
              key: event.id,
              class: `row row-${state}`,
              'data-row': event.id,
              'data-service': event.service,
              'data-ack-state': state,
              'data-acked-by': ack && ack.by ? ack.by : '',
            },
              h(Link, {
                href: `/incidents/${event.id}`,
                class: 'row-main',
                'data-open': event.id,
                prefetch: false,
                transition: false,
              },
                h('span', { class: 'row-id' }, event.id),
                h('span', { class: 'row-title' }, event.title),
              ),
              h('span', { class: 'row-meta' },
                h(SeverityTag, { severity: event.severity }),
                h('span', { class: 'row-service' }, event.service),
                h('time', { class: 'row-time' }, clock(event.openedAt)),
              ),
              h('span', { class: 'row-ack', 'data-ack-label': event.id },
                state === 'open' ? '' : (state === 'pending' ? 'acknowledging...' : `ack ${ack.by}`)),
              state === 'open'
                ? h('button', {
                  type: 'button',
                  class: 'ack',
                  'data-ack': event.id,
                  onclick: () => acknowledge(event.id),
                }, 'Ack')
                : h('button', { type: 'button', class: 'ack', disabled: true }, 'Ack'),
            );
          });
        }),

        h('div', { class: 'feed-actions' },
          h('button', {
            type: 'button',
            class: 'ghost',
            'data-load-more': '',
            onclick: () => feed.fetchNextPage(),
          }, 'Load older events'),
          h('span', { class: 'muted', 'data-feed-status': '' }, () => {
            if (feed.isFetchingNextPage()) return 'Loading...';
            const shown = rows().length;
            const all = loaded().length;
            const suffix = shown === all ? '' : ` (${all} loaded)`;
            return feed.hasNextPage()
              ? `${shown} of ${total} events${suffix}`
              : `all ${all} events loaded${suffix}`;
          }),
        ),
      ),

      // Client-routed region. entry-client.js mounts a Suspense boundary and a
      // Router here; the server ships it empty so there is nothing to mismatch.
      h('aside', { id: 'detail-pane', class: 'col pane', 'aria-label': 'Incident detail' }),
    ),

    // The status strip is the live region. Visible on purpose: an operator
    // should see the same thing a screen reader hears.
    h('div', { class: 'statusbar', 'data-announcer': '' },
      h(LiveRegion, { priority: 'polite' }, () => announcement()),
    ),

    h('div', { id: 'dialog-root' }),

    h(Show, { when: dialogOpen },
      h(IncidentDialog, {
        services,
        severities,
        onClose: () => dialogOpen(false),
        onCreate: createIncident,
      }),
    ),

    h(Footer, {}),
  );
}
