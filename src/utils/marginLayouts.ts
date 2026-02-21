import type { MarginLayout } from '../store/editorStore';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';

// Preset margin layouts
export const MARGIN_LAYOUTS: MarginLayout[] = [
  {
    id: 'none',
    name: 'None',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  {
    id: 'narrow',
    name: 'Narrow',
    left: 40,
    right: 40,
    top: 40,
    bottom: 40,
  },
  {
    id: 'normal',
    name: 'Normal',
    left: 80,
    right: 80,
    top: 60,
    bottom: 60,
  },
  {
    id: 'wide',
    name: 'Wide',
    left: 120,
    right: 120,
    top: 80,
    bottom: 80,
  },
  {
    id: 'title',
    name: 'Title Slide',
    left: 80,
    right: 80,
    top: 180,
    bottom: 120,
  },
  {
    id: 'content-left',
    name: 'Content Left',
    left: 80,
    right: SLIDE_WIDTH * 0.4,
    top: 80,
    bottom: 80,
  },
  {
    id: 'content-right',
    name: 'Content Right',
    left: SLIDE_WIDTH * 0.4,
    right: 80,
    top: 80,
    bottom: 80,
  },
  {
    id: 'two-column',
    name: 'Two Column',
    left: 60,
    right: 60,
    top: 80,
    bottom: 80,
  },
];

export function getMarginLayout(id: string | null): MarginLayout | null {
  if (!id) return null;
  return MARGIN_LAYOUTS.find((l) => l.id === id) || null;
}

// Get margin bounds as virtual element bounds for alignment snapping
export function getMarginBounds(layout: MarginLayout): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
} {
  return {
    left: layout.left,
    right: SLIDE_WIDTH - layout.right,
    top: layout.top,
    bottom: SLIDE_HEIGHT - layout.bottom,
    centerX: SLIDE_WIDTH / 2,
    centerY: SLIDE_HEIGHT / 2,
  };
}
