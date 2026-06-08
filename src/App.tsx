import { useEffect, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { AppLayoutMobile } from './components/layout/AppLayoutMobile';
import { PresenterView } from './components/presenter/PresenterView';
import { PresenterControlPanel } from './components/presenter/PresenterControlPanel';
import { AudienceView } from './components/presenter/AudienceView';
import { ProjectPickerDialog } from './components/dialogs/ProjectPickerDialog';
import { useEditorStore } from './store/editorStore';
import { usePresentationStore } from './store/presentationStore';
import { useVaultStore } from './store/vaultStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useIsMobile } from './hooks/useIsMobile';
import { useIdentity } from './hooks/useIdentity';
import { useCollabConnection } from './collab/useCollabConnection';
import { useYToStoreSync } from './collab/yToStoreSync';
import { useAwarenessPublish } from './collab/useAwarenessPublish';
import { setActiveAwareness } from './collab/activeAwareness';
import { setActiveDoc } from './collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager } from './collab/activeUndo';
import { readStandaloneBoot, applyStandaloneBoot } from './utils/standaloneBoot';
import { addJoinedProject, getJoinedProject } from './store/joinedStore';
import { setStorageConfig } from './utils/storageClient';

// Check if this is the audience window
const isAudienceMode = new URLSearchParams(window.location.search).get('audience') === 'true';

const standaloneBoot = isAudienceMode ? null : readStandaloneBoot();
// Apply synchronously, before React renders. See applyStandaloneBoot's note for why.
if (standaloneBoot) applyStandaloneBoot(standaloneBoot);

// Share-URL boot: when the page loads with ?project=<id>&t=<token>, record the
// join and bootstrap into server mode if needed. The vault's existing
// `openProject` flow picks up the token via the joinedStore. We strip the
// params from the URL so reload doesn't re-join.
const pendingJoin: { projectId: string; token: string } | null = (() => {
  if (isAudienceMode || standaloneBoot) return null;
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project');
  const token = params.get('t');
  if (!projectId || !token) return null;

  addJoinedProject({ projectId, token });

  // Force server mode if we're not on one yet — pasted share URLs should
  // "just work" in a fresh browser. Default to localhost:3001 for dev; in
  // production this URL is whatever's already configured.
  try {
    const raw = localStorage.getItem('slides-storage-config');
    const existing = raw ? (JSON.parse(raw) as { mode?: string; serverUrl?: string }) : null;
    if (existing?.mode !== 'server' || !existing.serverUrl) {
      setStorageConfig({ mode: 'server', serverUrl: existing?.serverUrl || 'http://localhost:3001' });
    }
  } catch { /* localStorage disabled — fall through */ }

  // Strip the query so a reload doesn't re-join.
  const u = new URL(window.location.href);
  u.searchParams.delete('project');
  u.searchParams.delete('t');
  window.history.replaceState({}, '', u.toString());

  return { projectId, token };
})();

function App() {
  const [vaultInitialized, setVaultInitialized] = useState(false);
  const [audienceReady, setAudienceReady] = useState(false);

  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const standaloneMode = useEditorStore((s) => s.standaloneMode);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const loadPresentation = usePresentationStore((s) => s.loadPresentation);

  const activeProjectId = useVaultStore((s) => s.activeProjectId);
  const initializeVault = useVaultStore((s) => s.initialize);
  const scheduleSave = useVaultStore((s) => s.scheduleSave);
  const openProject = useVaultStore((s) => s.openProject);
  const storageMode = useVaultStore((s) => s.storageMode);
  const serverUrl = useVaultStore((s) => s.serverUrl);

  // Collab connection — only opens a WS when the active project lives on
  // the server. Hook is a no-op (returns INITIAL) for local/filesystem modes,
  // and lazily code-splits yjs + y-websocket internally so non-collab users
  // never pay the bundle cost.
  const identity = useIdentity();
  const activeJoined = activeProjectId ? getJoinedProject(activeProjectId) : undefined;
  const collab = useCollabConnection({
    projectId: storageMode === 'server' && activeProjectId ? activeProjectId : null,
    serverUrl: storageMode === 'server' ? serverUrl : null,
    identity,
    shareToken: activeJoined?.token,
  });

  // Phase 4 visibility — log peer changes during early testing. The UI piece
  // moves to phase 7 (header avatars + selection outlines).
  useEffect(() => {
    if (!collab.ready) return;
    console.log(`[collab] connected as ${identity.name} (${identity.userId}); ${collab.peerCount} peer(s)`);
  }, [collab.ready, collab.peerCount, identity.name, identity.userId]);
  useEffect(() => {
    if (collab.error) console.error(`[collab] ${collab.error}`);
  }, [collab.error]);

  // Phase 5: register the active doc so mutating actions in presentationStore
  // can route through Y, and run the sync hook to mirror Y updates back into
  // Zustand. Phase 8: build a Y.UndoManager scoped to local edits and
  // register it for useHistory to pick up.
  useEffect(() => {
    setActiveDoc(collab.doc);
    if (collab.doc) {
      setActiveUndoManager(createUndoManagerFor(collab.doc));
    }
    return () => {
      setActiveDoc(null);
      setActiveUndoManager(null);
    };
  }, [collab.doc]);
  // Phase 7: register the awareness so the header, slide panel, and canvas
  // can read peer state without prop-drilling.
  useEffect(() => {
    setActiveAwareness(collab.awareness);
    return () => setActiveAwareness(null);
  }, [collab.awareness]);
  useYToStoreSync(collab.doc);
  useAwarenessPublish(collab.awareness);

  // For audience mode: request presentation data from main window
  useEffect(() => {
    if (!isAudienceMode) return;

    const channel = new BroadcastChannel('slides-presenter-data');

    // Request presentation data
    channel.postMessage({ type: 'request-presentation' });

    // Listen for presentation data
    channel.onmessage = (event) => {
      if (event.data.type === 'presentation-data') {
        loadPresentation(event.data.presentation);
        setAudienceReady(true);
      }
    };

    return () => channel.close();
  }, [loadPresentation]);

  // Initialize vault store on mount (skip for audience and standalone modes)
  useEffect(() => {
    if (isAudienceMode || standaloneBoot) return;
    initializeVault().then(() => setVaultInitialized(true));
  }, [initializeVault]);

  // After vault is up, if we boot-detected a share URL, open the joined
  // project. openProject reads the token from the joinedStore entry we wrote
  // synchronously at module load.
  useEffect(() => {
    if (!vaultInitialized || !pendingJoin) return;
    void openProject(pendingJoin.projectId);
  }, [vaultInitialized, openProject]);

  // Initialize active slide on mount
  useEffect(() => {
    if (!activeSlideId && slideOrder.length > 0) {
      setActiveSlide(slideOrder[0]);
    }
  }, [activeSlideId, slideOrder, setActiveSlide]);

  // Auto-save when project is open. Skipped in collab (server) mode — the
  // server's snapshot debouncer takes care of writing JSON on Y updates, and
  // we don't want each Y mirror back into Zustand to fire a REST PUT (it
  // would 403 for share-joiners and is redundant for owners).
  useEffect(() => {
    if (!activeProjectId || standaloneBoot || storageMode === 'server') return;

    const unsub = usePresentationStore.subscribe(() => {
      scheduleSave();
    });
    return unsub;
  }, [activeProjectId, scheduleSave, storageMode]);

  useKeyboardShortcuts();

  const isMobile = useIsMobile();
  // Standalone modes (viewer / standalone editor) keep the existing layout —
  // editing a downloaded standalone HTML on a phone is an edge case.
  const Layout = isMobile ? AppLayoutMobile : AppLayout;

  // Standalone viewer mode: just play the presentation. Esc → editor link
  // (handled inside PresenterView via the standaloneMode flag).
  if (standaloneMode === 'viewer') {
    return <PresenterView />;
  }

  // Standalone editor mode: same shell as the normal editor (skips ProjectPicker
  // because activeProjectId is irrelevant here). PresenterView covers it on boot
  // since setPresenting(true) was called above; Esc hides PresenterView, revealing
  // the editor UI underneath.
  if (standaloneMode === 'editor') {
    return (
      <>
        <AppLayout />
        <PresenterView />
        <PresenterControlPanel />
      </>
    );
  }

  // Render audience view for spawned presentation window
  if (isAudienceMode) {
    if (!audienceReady) {
      return (
        <div className="fixed inset-0 bg-black flex items-center justify-center text-white">
          Loading presentation...
        </div>
      );
    }
    return <AudienceView />;
  }

  // Show loading state while vault initializes
  if (!vaultInitialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // Show project picker when no project is open
  if (!activeProjectId) {
    return <ProjectPickerDialog />;
  }

  // In server (collab) mode, render a "Connecting…" overlay until the WS
  // synchronises. Without this, edits made during the connection race fall
  // through to the Zustand-only branch (getActiveDoc() returns null) and then
  // get clobbered when the first Y sync arrives — peers never see them, and
  // the local user briefly sees their edit too before it disappears.
  if (storageMode === 'server' && !collab.ready) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-100 gap-3">
        <div className="text-gray-500 text-sm">Connecting to collaboration server…</div>
        {collab.error && (
          <div className="text-xs text-red-600 max-w-md text-center">{collab.error}</div>
        )}
      </div>
    );
  }

  return (
    <>
      <Layout />
      <PresenterView />
      <PresenterControlPanel />
    </>
  );
}

export default App;
