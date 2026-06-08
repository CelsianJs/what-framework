// Vercel CDN adapter. Vercel ISR is mostly header-driven (s-maxage), so this is
// a thin on-demand purge via the project API when a token is supplied; it
// no-ops (header-only mode) without one.

export function createVercelCDN({ token, projectId, teamId } = {}) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const qs = teamId ? `?teamId=${teamId}` : '';

  async function purgeTags(tags) {
    if (!token || !projectId) return;
    await fetch(`https://api.vercel.com/v1/projects/${projectId}/cache/purge${qs}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tags }),
    });
  }

  return {
    purge: () => Promise.resolve(), // Vercel purges by tag; URL purge is header-driven
    purgeTags,
  };
}
