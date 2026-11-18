// Why a collaboration connection failed, in words. A browser WebSocket
// reports a failed handshake as a bare `Event` — no status, no reason — so
// the server's own account is fetched from /api/projects/:id/collab-status.

interface CollabStatus {
  ok: boolean;
  error?: string;
  lastSnapshotError?: string;
}

export async function explainConnectionFailure(
  serverUrl: string,
  projectId: string,
  userId: string,
  shareToken: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const headers: Record<string, string> = { 'X-Slides-User': userId };
  if (shareToken) headers['X-Share-Token'] = shareToken;
  let res: Response;
  try {
    res = await fetchImpl(`${serverUrl}/api/projects/${encodeURIComponent(projectId)}/collab-status`, { headers });
  } catch {
    return `Cannot reach the collaboration server at ${serverUrl}.`;
  }
  let body: CollabStatus | null = null;
  try { body = await res.json() as CollabStatus; } catch { /* not JSON: an older server or a proxy */ }
  if (body?.error) return body.error;
  if (res.status === 403) return 'You do not have access to this deck on this server.';
  if (res.status === 404) return `The server at ${serverUrl} does not report connection status; it may need a restart to pick up the current version.`;
  if (!res.ok) return `The collaboration server answered ${res.status}.`;
  // The server sees no problem: a dropped network, or a restart under way.
  return `Lost the connection to the collaboration server at ${serverUrl}; retrying…`;
}
