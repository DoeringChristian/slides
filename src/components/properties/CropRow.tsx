import { Crop, Eraser } from 'lucide-react';
import { IconButtonRow } from '../controls/IconButtonRow';
import { useCropAction, runCrop, removeCrop, cropLabel } from '../canvas/cropActions';

/** The crop control in Properties: the same action as the selection bar's
 *  (one image, one image with the shapes to crop it to, or exactly one crop
 *  group), so it is absent for any other selection. */
export function CropRow() {
  const action = useCropAction();
  if (!action) return null;
  return <IconButtonRow items={[
    { icon: <Crop size={14} />, label: cropLabel(action), active: action.kind === 'edit', onClick: () => runCrop(action),
      title: action.kind === 'make' ? 'Crop the image to the selected shapes, then adjust in crop mode'
        : 'Crop mode: draw shapes to choose what shows, and edit them' },
    ...(action.kind === 'edit' ? [{ icon: <Eraser size={14} />, label: 'Remove crop', active: false,
      onClick: () => removeCrop(action), title: 'Remove the crop; its shapes stay in the group' }] : []),
  ]} />;
}
