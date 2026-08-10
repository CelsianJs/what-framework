// The lazily loaded detail panel. Its own module, reached only by navigating to
// /incidents/:id, so it is never in the first byte the browser parses.

import { h, useQuery } from 'what-framework';
import { useParams } from 'what-router';

import { SeverityTag } from '../components/chrome.js';
import { fetchIncident } from '../lib/api.js';
import { clock, shortDate } from '../lib/format.js';

export default function IncidentDetail() {
  // The router rebuilds this component for every navigation, so reading the
  // param once in the body is correct: a second incident is a second instance.
  const { id } = useParams();

  const query = useQuery({
    queryKey: ['incident', id],
    queryFn: ({ signal }) => fetchIncident(id, signal),
    staleTime: 15_000,
  });

  return h('article', { class: 'detail', 'data-detail': id },
    h('header', { class: 'detail-head' },
      h('p', { class: 'detail-id' }, id),
      h('h2', { 'data-detail-title': '' }, () => query.data()?.title ?? 'Loading incident...'),
    ),

    h('div', { class: 'detail-body' }, () => {
      if (query.isError()) {
        return h('p', { class: 'field-error' }, `Could not load ${id}: ${query.error()?.message}`);
      }
      const incident = query.data();
      if (!incident) return h('p', { class: 'muted', 'data-detail-loading': '' }, 'Fetching detail...');

      return [
        h('dl', { class: 'metrics' },
          h('div', { class: 'metric' },
            h('dt', {}, 'Service'),
            h('dd', { 'data-detail-service': '' }, incident.service)),
          h('div', { class: 'metric' },
            h('dt', {}, 'Severity'),
            h('dd', {}, h(SeverityTag, { severity: incident.severity }))),
          h('div', { class: 'metric' },
            h('dt', {}, 'Opened'),
            h('dd', {}, `${shortDate(incident.openedAt)} ${clock(incident.openedAt)}`)),
          h('div', { class: 'metric' },
            h('dt', {}, 'Source'),
            h('dd', {}, incident.source)),
        ),

        h('h3', {}, 'Timeline'),
        h('ol', { class: 'timeline', 'data-detail-timeline': '' },
          incident.timeline.map((entry, i) =>
            h('li', { key: `${incident.id}-${i}` },
              h('time', {}, clock(entry.at)),
              h('span', {}, entry.label))),
        ),

        h('p', { class: 'muted', 'data-detail-ack': '' },
          incident.ack
            ? `Acknowledged by ${incident.ack.by}.`
            : 'Not acknowledged yet.'),
      ];
    }),
  );
}
