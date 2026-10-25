import { createContext } from 'react';
import type { ShapeElement } from '../../types/presentation';
import type { CurrentChange } from '../../store/currentMutation';

/** A local draft sink, not a persisted element or a keyframe mutation. */
export const CreationDraftContext = createContext<null | {
  update: (changes: CurrentChange<ShapeElement>) => void;
  commit: (changes: CurrentChange<ShapeElement>) => void;
  discard: () => void;
}>(null);
