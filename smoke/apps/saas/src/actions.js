// The issue editor's server action. It runs on the server, takes a while, and
// refuses a title with "fail" in it, the app's error path. On success it
// redirects to the issue list it was opened from (the URL without `edit`),
// and the client refetches every issue list, project and org it shows, so
// the shell's open count follows a status change.

import { getResponse } from 'what-framework';
import { action } from 'what-framework/server';

export const updateIssue = action(async ({ orgId, projectId, id, title, status, back }) => {
  const { db, latency } = await import('./db.js');
  await latency(300);
  const text = String(title ?? '').trim();
  if (/fail/i.test(text)) throw new Error(`The server refused the title "${text}"`);
  const saved = db.updateIssue(String(orgId), String(projectId), String(id), { title: text, status: String(status) });
  if (saved === null) throw new Error(`No issue ${id}`);
  const to = String(back ?? '');
  if (to.startsWith('/') && !to.startsWith('//')) getResponse().redirect(to);
  return saved;
}, { id: 'updateIssue', invalidates: [['issues'], ['project'], ['projects'], ['org']] });
