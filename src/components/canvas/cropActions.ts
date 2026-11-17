import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { getActiveDoc } from '../../collab/yDocAdapter';
import { yDocToJsonSlideOnly } from '../../collab/ySchema';
import { selectionCropAction, type CropAction } from '../../utils/model/groupCrop';

/** The crop control's action for the current selection (null: no control).
 *  The selection bar and the Properties panel share it, so they always agree. */
export function useCropAction(): CropAction | null {
  const ids = useEditorStore(s => s.selectedElementIds);
  const slideId = useEditorStore(s => s.activeSlideId);
  const cropping = useEditorStore(s => s.croppingElementId);
  const elements = usePresentationStore(s => s.presentation.slides[slideId]?.elements);
  if (cropping || !elements) return null;
  return selectionCropAction(elements, ids);
}

/** Crop: start or edit the crop in crop mode; with image + shapes selected,
 *  the shapes become the crop first. */
export function runCrop(action: CropAction) {
  const { activeSlideId, enterCropMode } = useEditorStore.getState();
  if (action.kind === 'make') usePresentationStore.getState().setCrop(activeSlideId, action.imageId, action.shapeIds);
  enterCropMode(action.imageId);
}

/** Remove the crop: its shapes become ordinary members of the group. */
export function removeCrop(action: CropAction) {
  const { activeSlideId, setSelectedElements } = useEditorStore.getState();
  usePresentationStore.getState().setCrop(activeSlideId, action.imageId, null);
  const doc = getActiveDoc();
  const slide = doc ? yDocToJsonSlideOnly(doc, activeSlideId) : usePresentationStore.getState().presentation.slides[activeSlideId];
  if (slide) setSelectedElements(useEditorStore.getState().selectedElementIds.filter(id => slide.elements[id]));
}

export const cropLabel = (action: CropAction) => action.kind === 'edit' ? 'Edit crop' : action.kind === 'make' ? 'Crop to shapes' : 'Crop';
