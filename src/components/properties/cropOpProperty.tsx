import { SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide-react';
import { PreviewSelectProperty } from './Property';
import type { CropOp, ShapeElement, TextElement } from '../../types/presentation';

const OPTIONS: Array<{ value: CropOp; label: string; Icon: typeof SquaresUnite }> = [
  { value: 'add', label: 'Add — reveal this area', Icon: SquaresUnite },
  { value: 'subtract', label: 'Subtract — cut this area away', Icon: SquaresSubtract },
  { value: 'intersect', label: 'Intersect — keep only where it overlaps', Icon: SquaresIntersect },
];

/** How a crop shape (or crop text) combines with the crop shapes below it,
 *  in layer order. Shown only on crop shapes. */
export function cropOpProperty<T extends ShapeElement | TextElement>() {
  return new PreviewSelectProperty<T, CropOp>({
    key: 'cropOp', label: 'Crop', iconOnly: true, defaultValue: 'add', columns: 3,
    visibleFor: el => !!el.cropGroupId && !!el.objectGroupIds?.includes(el.cropGroupId),
    options: OPTIONS.map(({ value, label, Icon }) => ({ value, label, preview: () => <Icon size={18} aria-hidden="true" /> })),
  });
}
