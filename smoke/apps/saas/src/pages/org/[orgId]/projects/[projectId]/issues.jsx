// A project's issues. The filters, the sort and the page are the query string
// (?status=open&sort=updated&page=2), and so is the editor (&edit=APO-12), so
// every state is a URL that back and forward return to and a link can share.
// Saving an edit shows it in the list at once; the server's answer replaces
// it, or the list goes back to what it was when the server refuses.

import { useOptimistic, useState, useTransition } from 'what-framework';
import { Link, navigate } from 'what-router';
import { updateIssue } from '../../../../../actions.js';
import { issueFilters, keys, prefetchIssues, useIssues } from '../../../../../queries.js';
import { loadPage } from '../../../../../loaders.js';

// A navigation here (a tab, a filter, a page) waits for the list it shows, so
// the page appears with its rows. The server's render has them already: its
// loader filled the entry.
export const preload = ({ params, query }) => (import.meta.env.SSR ? undefined : prefetchIssues(params.orgId, params.projectId, issueFilters(query)));

export const loader = (ctx) => loadPage(ctx, (db) => {
  const { orgId, projectId } = ctx.params;
  const filters = issueFilters(ctx.query);
  return [
    [keys.org(orgId), db.org(orgId)],
    [keys.projects(orgId), db.projects(orgId)],
    [keys.issues(orgId, projectId, filters), db.issues(orgId, projectId, filters)],
  ];
});

const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', closed: 'Closed' };
const day = (t) => new Date(t).toISOString().slice(0, 10);

function EditIssue({ issue, saving, error, onSave, onCancel }) {
  const [title, setTitle] = useState(issue.title);
  const [status, setStatus] = useState(issue.status);
  const submit = (e) => {
    e.preventDefault();
    onSave({ id: issue.id, title: title().trim(), status: status() });
  };
  return (
    <div class="backdrop" data-modal-backdrop>
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" data-edit-dialog={issue.id} onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
        <h2 id="edit-title">Edit {issue.id}</h2>
        <label>Title <input data-edit-title value={title()} onInput={(e) => setTitle(e.currentTarget.value)} /></label>
        <label>Status
          <select data-edit-status value={status()} onChange={(e) => setStatus(e.currentTarget.value)}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        {error() ? <p class="error" role="alert" data-edit-error>{error()}</p> : null}
        <div class="actions">
          <button type="button" data-edit-cancel onClick={onCancel}>Cancel</button>
          <button type="submit" class="button primary" data-edit-save disabled={saving()}>{saving() ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

export default function Issues({ params, query }) {
  const orgId = () => params.orgId;
  const projectId = () => params.projectId;
  const filters = () => issueFilters(query);
  const issues = useIssues(orgId, projectId, filters);
  const [rows, showEdit] = useOptimistic(
    () => issues.data()?.rows ?? [],
    (list, edit) => list.map((r) => (r.id === edit.id ? { ...r, ...edit, pending: true } : r)),
  );
  const [saving, startSave] = useTransition();
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');

  // This list's URL with some of its query changed (a value of undefined
  // removes it; the defaults are left out).
  const hrefWith = (patch) => {
    const next = { ...filters(), edit: query.edit, ...patch };
    const search = new URLSearchParams();
    if (next.status !== 'all') search.set('status', next.status);
    if (next.sort !== 'updated') search.set('sort', next.sort);
    if (next.page !== '1') search.set('page', next.page);
    if (next.edit) search.set('edit', next.edit);
    const qs = search.toString();
    return `/org/${params.orgId}/projects/${params.projectId}/issues${qs ? `?${qs}` : ''}`;
  };
  const setFilter = (name) => (e) => navigate(hrefWith({ [name]: e.currentTarget.value, page: '1' }));
  const editing = () => (query.edit ? rows().find((r) => r.id === query.edit) ?? null : null);
  const close = () => {
    setError(null);
    navigate(hrefWith({ edit: undefined }));
  };
  const save = (patch) => {
    setError(null);
    startSave(async () => {
      showEdit(patch);
      try {
        await updateIssue({ orgId: params.orgId, projectId: params.projectId, ...patch, back: hrefWith({ edit: undefined }) });
      } catch {
        setError('The server refused the change, so nothing was saved.');
      }
    });
  };

  return (
    <main class="page" data-page="issues">
      <div class="toolbar">
        <label>Status
          <select data-filter="status" value={filters().status} onChange={setFilter('status')}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label>Sort
          <select data-filter="sort" value={filters().sort} onChange={setFilter('sort')}>
            <option value="updated">Recently updated</option>
            <option value="priority">Priority</option>
            <option value="title">Title</option>
          </select>
        </label>
        <input class="draft" placeholder="New issue title" data-draft value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
        <span class="muted" data-issue-total>{issues.data() ? `${issues.data().total} issues` : 'Loading…'}</span>
      </div>
      <table class="table issues" data-issues>
        <thead><tr><th>Id</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Updated</th><th /></tr></thead>
        <tbody>
          {rows().map((r) => (
            <tr key={r.id} data-issue={r.id} data-pending={r.pending ? 'true' : undefined}>
              <td class="mono">{r.id}</td>
              <td data-issue-title>{r.title}</td>
              <td><span class={`pill ${r.status}`} data-issue-status>{STATUS_LABEL[r.status]}</span></td>
              <td>P{r.priority}</td>
              <td>{r.assignee}</td>
              <td>{day(r.updated)}</td>
              <td><Link href={hrefWith({ edit: r.id })} data-edit={r.id}>Edit</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav class="pager" aria-label="Pages" data-pager>
        {issues.data() ? Array.from({ length: issues.data().pages }, (_, i) => String(i + 1)).map((n) => (
          <Link key={n} href={hrefWith({ page: n, edit: undefined })} data-page-link={n}
            aria-current={n === String(issues.data().page) ? 'page' : undefined}>{n}</Link>
        )) : null}
      </nav>
      {/* A keyed list of one, by the issue's id: moving to another issue's
          editor (a link behind the dialog, back and forward) builds it again
          with that issue's title and status, and a save that changes the
          issue keeps what was typed. */}
      {(editing() ? [editing().id] : []).map((id) => (
        <EditIssue key={id} issue={rows().find((r) => r.id === id)} saving={saving} error={error} onSave={save} onCancel={close} />
      ))}
    </main>
  );
}
