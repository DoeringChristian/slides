import type { ImageElement, ShapeElement } from '../../types/presentation';
import { noPaint } from './paintColor';

/** An image's tint as the rectangle that paints it: the shared shape fill
 *  (solid or gradient) over the image's box, so every renderer and export
 *  draws the tint exactly as it draws a shape's fill. Null without a tint. */
export function imageTintShape(image: ImageElement): ShapeElement | null {
  const gradient = image.tintStyle === 'linear' || image.tintStyle === 'radial';
  if (noPaint(image.tint ?? '') && !(gradient && !noPaint(image.tintTo ?? ''))) return null;
  return {
    id: `${image.id}-tint`, type: 'shape', shapeType: 'rect', creationPreset: 'rect',
    x: image.x, y: image.y, width: image.width, height: image.height, rotation: image.rotation,
    opacity: image.opacity, locked: false, visible: image.visible,
    fill: image.tint ?? '', fillStyle: image.tintStyle ?? 'solid', fillTo: image.tintTo, fillLine: image.tintLine,
    stroke: '', strokeWidth: 0, cornerRadius: 0,
  };
}
