import React, { useEffect, useState } from 'react';
import { X, Link as LinkIcon, Copy, Loader2, Trash2, Check } from 'lucide-react';
import { mintShare, listShares, revokeShare, type ShareEntry } from '../../utils/storageClient';

interface Props {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
}

function shareUrlFor(token: string, projectId: string): string {
  const u = new URL(window.location.href);
  // Strip any existing query params so the URL is clean to share.
  u.search = '';
  u.searchParams.set('project', projectId);
  u.searchParams.set('t', token);
  return u.toString();
}

export const ShareDialog: React.FC<Props> = ({ isOpen, projectId, onClose }) => {
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setShares(await listShares(projectId));
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kick off the async share-list fetch when the dialog opens; state lands after the request resolves
    if (isOpen) void refresh();
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const onMint = async () => {
    setMinting(true);
    setError(null);
    try {
      const entry = await mintShare(projectId);
      // Optimistically prepend; refresh in the background to be safe.
      setShares((prev) => [entry, ...prev]);
    } catch (err) {
      setError((err as Error).message);
    }
    setMinting(false);
  };

  const onRevoke = async (token: string) => {
    setShares((prev) => prev.filter((s) => s.token !== token));
    try {
      await revokeShare(token);
    } catch (err) {
      setError((err as Error).message);
      void refresh(); // resync if the optimistic update was wrong
    }
  };

  const onCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrlFor(token, projectId));
      setJustCopied(token);
      setTimeout(() => setJustCopied(null), 1500);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[480px] mx-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <LinkIcon size={18} />
            Share this presentation
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-600">
            Anyone with a share link can join and edit. Revoke a link to cut access.
          </p>

          <button
            onClick={() => { void onMint(); }}
            disabled={minting}
            className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {minting ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
            Create a new share link
          </button>

          {error && (
            <div className="p-2 text-sm bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>
          )}

          <div className="border-t border-gray-100 pt-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Active links
            </div>
            {loading && shares.length === 0 ? (
              <div className="text-sm text-gray-400 flex items-center gap-2 py-2">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : shares.length === 0 ? (
              <div className="text-sm text-gray-400 py-2">No active links yet.</div>
            ) : (
              <ul className="space-y-2">
                {shares.map((s) => (
                  <li key={s.token} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-gray-600 truncate">{shareUrlFor(s.token, projectId)}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        Created {new Date(s.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => { void onCopy(s.token); }}
                      className="p-1.5 rounded text-gray-600 hover:bg-gray-200"
                      title="Copy URL"
                    >
                      {justCopied === s.token ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={() => { void onRevoke(s.token); }}
                      className="p-1.5 rounded text-red-500 hover:bg-red-50"
                      title="Revoke"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
