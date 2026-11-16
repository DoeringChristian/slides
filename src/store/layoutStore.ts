import { create } from 'zustand';

/**
 * Desktop panel layout, per browser.
 *
 * Every panel has a fixed size in each of its states, and what happens inside
 * a panel (a selection bar appearing, a long list) scrolls within it — it
 * never resizes a neighbour or the canvas. Dragging a panel's edge follows the
 * pointer and snaps to the nearest state on release; clicking the edge
 * toggles between them.
 *
 * - slides (left): full thumbnails, or a narrow strip of slide numbers and
 *   slide actions;
 * - side (right): hidden, or one width, with Properties and Assistant tabs;
 * - objects (bottom of the canvas): hidden by default, or one height.
 */

export type SlidesMode = 'full' | 'strip';
export type SideTab = 'properties' | 'assistant';

export const SIZES = {
  slidesFull: 240,
  slidesStrip: 56,
  side: 300,
  objects: 240,
  /** Header row of the objects panel, always visible. */
  objectsHeader: 28,
} as const;

interface LayoutState {
  slides: SlidesMode;
  sideOpen: boolean;
  sideTab: SideTab;
  objectsOpen: boolean;
  setSlides: (mode: SlidesMode) => void;
  setSideOpen: (open: boolean) => void;
  /** Show the right panel on this tab. */
  showSideTab: (tab: SideTab) => void;
  setObjectsOpen: (open: boolean) => void;
}

const STORAGE_KEY = 'slides.layout.v1';

type Persisted = Pick<LayoutState, 'slides' | 'sideOpen' | 'sideTab' | 'objectsOpen'>;
const DEFAULTS: Persisted = { slides: 'full', sideOpen: true, sideTab: 'properties', objectsOpen: false };

function load(): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Persisted> | null;
    if (!raw) return DEFAULTS;
    return {
      slides: raw.slides === 'strip' ? 'strip' : 'full',
      sideOpen: raw.sideOpen !== false,
      sideTab: raw.sideTab === 'assistant' ? 'assistant' : 'properties',
      objectsOpen: raw.objectsOpen === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export const useLayout = create<LayoutState>((set) => ({
  ...load(),
  setSlides: (slides) => set({ slides }),
  setSideOpen: (sideOpen) => set({ sideOpen }),
  showSideTab: (sideTab) => set({ sideOpen: true, sideTab }),
  setObjectsOpen: (objectsOpen) => set({ objectsOpen }),
}));

useLayout.subscribe((s) => {
  const { slides, sideOpen, sideTab, objectsOpen } = s;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ slides, sideOpen, sideTab, objectsOpen })); } catch { /* private mode */ }
});

/** Which of two snap states a dragged size is closer to. */
export function snapTo<T>(size: number, a: { size: number; value: T }, b: { size: number; value: T }): T {
  return Math.abs(size - a.size) <= Math.abs(size - b.size) ? a.value : b.value;
}
