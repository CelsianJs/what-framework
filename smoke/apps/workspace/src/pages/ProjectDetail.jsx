// A project. The rename is optimistic: the new name shows at once and the
// server's answer settles it, back to the old name when the server refuses.

import { startTransition, useOptimistic, useState } from 'what-framework';
import { FocusTrap, useFocusRestore } from 'what-framework/a11y';
import { Portal } from 'what-framework';
import { invalidateQueries, useQuery } from 'what-framework/data';
import { navigate } from 'what-router';

import { archiveProject, getProject, renameProject } from '../api.js';
import { useToasts } from '../state/toasts.js';

function ArchiveDialog({ name, onCancel, onConfirm }) {
  return (
    <Portal target="#modal-root">
      <div class="backdrop" onClick={onCancel}>
        <FocusTrap>
          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="archive-title" data-dialog
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
            <h2 id="archive-title">Archive {name}?</h2>
            <p>It leaves the project list. Nothing is deleted.</p>
            <label>Reason <input data-archive-reason /></label>
            <div class="actions">
              <button data-dialog-cancel onClick={onCancel}>Cancel</button>
              <button class="danger" data-dialog-confirm onClick={onConfirm}>Archive</button>
            </div>
          </div>
        </FocusTrap>
      </div>
    </Portal>
  );
}

export default function ProjectDetail({ params }) {
  const toasts = useToasts();
  const project = useQuery({ queryKey: () => ['project', params.id], queryFn: ({ queryKey }) => getProject(queryKey[1]) });
  const [name, setName] = useOptimistic(() => project.data()?.name ?? '');
  const [draft, setDraft] = useState('');
  const [archiving, setArchiving] = useState(false);
  const focus = useFocusRestore();

  const rename = (e) => {
    e.preventDefault();
    const next = draft().trim();
    if (!next) return;
    setDraft('');
    startTransition(async () => {
      setName(next);
      try {
        await renameProject(params.id, next);
        await invalidateQueries(['project', params.id]);
        invalidateQueries(['projects']);
        toasts.push(`Renamed to ${next}`, 'success');
      } catch (err) {
        toasts.push(err.message, 'error');
      }
    });
  };

  const openArchive = (e) => { focus.capture(e.currentTarget); setArchiving(true); };
  const closeArchive = () => { setArchiving(false); focus.restore(); };
  const confirmArchive = async () => {
    await archiveProject(params.id);
    setArchiving(false);
    await invalidateQueries(['projects']);
    toasts.push('Project archived', 'success');
    navigate('/projects');
  };

  return (
    <section data-detail>
      {project.isLoading() ? <p class="muted">Loading…</p> : (
        <>
          <div class="page-head">
            <h1 data-project-name>{name()}</h1>
            <button data-archive onClick={openArchive}>Archive</button>
          </div>
          <p class="muted" data-project-meta>{project.data()?.kind} · owned by {project.data()?.owner}</p>
          <form class="rename" onSubmit={rename}>
            <label>Rename <input data-rename-input value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} /></label>
            <button type="submit" data-rename-submit>Save</button>
          </form>
        </>
      )}
      {archiving() ? <ArchiveDialog name={name()} onCancel={closeArchive} onConfirm={confirmArchive} /> : null}
    </section>
  );
}
