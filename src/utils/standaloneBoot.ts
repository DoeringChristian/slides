import type { Presentation } from '../types/presentation';
import { useEditorStore, type StandaloneMode } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';

export interface StandaloneBoot {
  presentation: Presentation;
  mode: StandaloneMode;
  editorOrigin: string;
}

// Apply a boot payload to the existing stores. Call this *synchronously* before
// React renders so PresenterView's useState initializers see the standalone mode
// on first render (otherwise hasBootstrapped initializes to true and the
// "Press Enter to start" gate never fires).
export function applyStandaloneBoot(boot: StandaloneBoot, modeOverride?: StandaloneMode) {
  const mode = modeOverride ?? boot.mode;
  usePresentationStore.getState().loadPresentation(boot.presentation);
  useEditorStore.getState().setStandaloneMode(mode, boot.editorOrigin);
  if (boot.presentation.slideOrder.length > 0) {
    useEditorStore.getState().setActiveSlide(boot.presentation.slideOrder[0]);
  }
  useEditorStore.getState().setPresenting(true);
}

// Read the presentation JSON + config that exportStandaloneHtml.ts embeds into
// a standalone HTML. Returns null when the document has no payload (i.e. we're
// running in the regular editor, not a standalone HTML).
export function readStandaloneBoot(): StandaloneBoot | null {
  const payloadEl = document.getElementById('slides-payload');
  const configEl = document.getElementById('slides-config');
  if (!payloadEl || !configEl) return null;
  try {
    const presentation = JSON.parse(payloadEl.textContent || '') as Presentation;
    const config = JSON.parse(configEl.textContent || '') as { mode: StandaloneMode; editorOrigin: string };
    if (config.mode !== 'editor' && config.mode !== 'viewer') return null;
    return { presentation, mode: config.mode, editorOrigin: config.editorOrigin };
  } catch (err) {
    console.error('Failed to read standalone payload:', err);
    return null;
  }
}
