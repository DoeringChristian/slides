import { useEffect, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { PresenterView } from './components/presenter/PresenterView';
import { PresenterControlPanel } from './components/presenter/PresenterControlPanel';
import { AudienceView } from './components/presenter/AudienceView';
import { ProjectPickerDialog } from './components/dialogs/ProjectPickerDialog';
import { useEditorStore } from './store/editorStore';
import { usePresentationStore } from './store/presentationStore';
import { useVaultStore } from './store/vaultStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { readStandaloneBoot, applyStandaloneBoot } from './utils/standaloneBoot';

// Check if this is the audience window
const isAudienceMode = new URLSearchParams(window.location.search).get('audience') === 'true';

const standaloneBoot = isAudienceMode ? null : readStandaloneBoot();
// Apply synchronously, before React renders. See applyStandaloneBoot's note for why.
if (standaloneBoot) applyStandaloneBoot(standaloneBoot);

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

  // Initialize active slide on mount
  useEffect(() => {
    if (!activeSlideId && slideOrder.length > 0) {
      setActiveSlide(slideOrder[0]);
    }
  }, [activeSlideId, slideOrder, setActiveSlide]);

  // Auto-save when project is open (only when a vault project is active — not in standalone)
  useEffect(() => {
    if (!activeProjectId || standaloneBoot) return;

    const unsub = usePresentationStore.subscribe(() => {
      scheduleSave();
    });
    return unsub;
  }, [activeProjectId, scheduleSave]);

  useKeyboardShortcuts();

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

  return (
    <>
      <AppLayout />
      <PresenterView />
      <PresenterControlPanel />
    </>
  );
}

export default App;
