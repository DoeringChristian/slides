import { readEditorLocation, rememberEditorLocation } from './utils/io/editorLocation';
import { useEffect, useState, useRef } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { AppLayoutMobile } from './components/layout/AppLayoutMobile';
import { PresenterView } from './components/presenter/PresenterView';
import { PresenterControlPanel } from './components/presenter/PresenterControlPanel';
import { AudienceView } from './components/presenter/AudienceView';
import { ProjectPickerDialog } from './components/dialogs/ProjectPickerDialog';
import { useEditorStore } from './store/editorStore';
import { usePresentationStore } from './store/presentationStore';
import { trackDeckMedia } from './media/mediaStore';
import { useVaultStore } from './store/vaultStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useIsMobile } from './hooks/useIsMobile';
import { useProjectCollab } from './hooks/useProjectCollab';
import { readStandaloneBoot, applyStandaloneBoot } from './utils/io/standaloneBoot';
import { addJoinedProject } from './store/joinedStore';
import { setStorageConfig } from './utils/io/storageClient';

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
  // Copy every media file of the open deck to this machine in the
  // background, so presenting never depends on the network.
  const resources = usePresentationStore((s) => s.presentation.resources);
  useEffect(() => { trackDeckMedia({ resources }); }, [resources]);
  const loadPresentation = usePresentationStore((s) => s.loadPresentation);

  const activeProjectId = useVaultStore((s) => s.activeProjectId);
  const initializeVault = useVaultStore((s) => s.initialize);
  const scheduleSave = useVaultStore((s) => s.scheduleSave);
  const bootPromise = useRef<Promise<void> | null>(null);
  const storageMode = useVaultStore((s) => s.storageMode);

  const collab = useProjectCollab({ disabled: isAudienceMode || !!standaloneBoot });

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
    // StrictMode and Fast Refresh must not start competing project loads.
    bootPromise.current ??= (async () => {
      const location = readEditorLocation();
      await initializeVault();
      const vault = useVaultStore.getState();
      if (vault.activeProjectId) return;
      if (pendingJoin) {
        await vault.openProject(pendingJoin.projectId);
      } else if (location && vault.storageMode === location.storageMode && vault.serverUrl === location.serverUrl) {
        await vault.openProject(location.projectId);
        if (useVaultStore.getState().activeProjectId === location.projectId &&
            usePresentationStore.getState().presentation.slides[location.slideId]) {
          useEditorStore.getState().setActiveSlide(location.slideId);
        }
      }
    })();
    void bootPromise.current.then(() => setVaultInitialized(true));
  }, [initializeVault]);

  // Keep navigation separate from document persistence. Never rewrite the
  // saved location while startup is restoring it or after a failed reopen.
  useEffect(() => {
    if (!vaultInitialized || isAudienceMode || standaloneBoot) return;
    const remember = () => {
      const vault = useVaultStore.getState();
      const slideId = useEditorStore.getState().activeSlideId;
      if (vault.activeProjectId && slideId && usePresentationStore.getState().presentation.id === vault.activeProjectId) {
        rememberEditorLocation({projectId: vault.activeProjectId, slideId, storageMode: vault.storageMode, serverUrl: vault.serverUrl});
      }
    };
    remember();
    const offEditor = useEditorStore.subscribe(remember), offVault = useVaultStore.subscribe(remember);
    return () => { offEditor(); offVault(); };
  }, [vaultInitialized]);

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
