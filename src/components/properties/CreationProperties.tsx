import { useRef, useState } from 'react';
import { CreationDraftContext } from './CreationDraftContext';
import { ShapeProperties } from './ShapeProperties';
import { composeUserShape } from '../../utils/userShapeCreation';
import { useCreationPreferences, type CreationKey } from '../../store/creationPreferences';
import type { ShapeElement, Tool } from '../../types/presentation';
import type { CurrentChange } from '../../store/currentMutation';

/** Scrub previews belong to this mounted draft, never remembered preferences. */
export function CreationProperties({ tool, creationKey }: { tool: Tool; creationKey: CreationKey }) {
  useCreationPreferences(s => s.styles);
  const [preview, setPreview] = useState<Partial<ShapeElement>>({});
  const previewRef = useRef<Partial<ShapeElement>>({});
  // Settings edit remembered intent, not the effective two-point gesture.
  const composeDraft = (overrides: Partial<ShapeElement>) => composeUserShape(tool, {
    closed: useCreationPreferences.getState().styles[creationKey]?.closed ?? false,
    ...overrides, id: 'creation-draft', x: 0, y: 0,
  });
  const current = () => composeDraft(previewRef.current);
  const discard = () => { previewRef.current = {}; setPreview({}); };
  const resolve = (changes: CurrentChange<ShapeElement>) => typeof changes === 'function' ? changes(current()) : changes;
  return <CreationDraftContext.Provider value={{
    update: changes => {
      previewRef.current = { ...previewRef.current, ...resolve(changes) };
      setPreview(previewRef.current);
    },
    commit: changes => {
      useCreationPreferences.getState().remember(creationKey, resolve(changes));
      discard();
    },
    discard,
  }}><ShapeProperties element={composeDraft(preview)} /></CreationDraftContext.Provider>;
}
