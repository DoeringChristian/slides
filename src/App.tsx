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

// Check if this is the audience window
const isAudienceMode = new URLSearchParams(window.location.search).get('audience') === 'true';

function App() {
  const [vaultInitialized, setVaultInitialized] = useState(false);
  const [audienceReady, setAudienceReady] = useState(false);

  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
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

  // Initialize vault store on mount (skip for audience mode)
  useEffect(() => {
    if (isAudienceMode) return;
    initializeVault().then(() => setVaultInitialized(true));
  }, [initializeVault]);

  // Initialize active slide on mount
  useEffect(() => {
    if (!activeSlideId && slideOrder.length > 0) {
      setActiveSlide(slideOrder[0]);
    }
  }, [activeSlideId, slideOrder, setActiveSlide]);

  // Auto-save when project is open
  useEffect(() => {
    if (!activeProjectId) return;

    const unsub = usePresentationStore.subscribe(() => {
      scheduleSave();
    });
    return unsub;
  }, [activeProjectId, scheduleSave]);

  useKeyboardShortcuts();

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
