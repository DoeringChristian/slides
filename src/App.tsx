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

  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);

  const activeProjectId = useVaultStore((s) => s.activeProjectId);
  const initializeVault = useVaultStore((s) => s.initialize);
  const scheduleSave = useVaultStore((s) => s.scheduleSave);

  // Initialize vault store on mount
  useEffect(() => {
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
