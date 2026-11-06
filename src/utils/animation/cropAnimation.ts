import type { ImageElement } from '../../types/presentation';

export interface CropRect { x: number; y: number; width: number; height: number }
export interface CropFade { from: CropRect; to: CropRect; t: number }
/** Transient render hint; never stored in the document. */
export type CropFadeImage = ImageElement & { _cropFade?: CropFade; _cropLift?: { original: ImageElement; t: number } };

export function cropRect(image: ImageElement): CropRect {
  return { x: image.cropX, y: image.cropY, width: image.cropWidth, height: image.cropHeight };
}

export function imagePoint(image: ImageElement, u: number, v: number) {
  const dx = (u - image.cropX - image.cropWidth / 2) * image.width / image.cropWidth;
  const dy = (v - image.cropY - image.cropHeight / 2) * image.height / image.cropHeight;
  const angle = image.rotation * Math.PI / 180;
  return { x: image.x + image.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: image.y + image.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

/** Change the window without moving or rescaling the image beneath it. */
export function applyImageCrop(image: ImageElement, crop: CropRect): Partial<ImageElement> {
  const width = crop.width * image.width / image.cropWidth;
  const height = crop.height * image.height / image.cropHeight;
  const center = imagePoint(image, crop.x + crop.width / 2, crop.y + crop.height / 2);
  return { x: center.x - width / 2, y: center.y - height / 2, width, height,
    cropX: crop.x, cropY: crop.y, cropWidth: crop.width, cropHeight: crop.height };
}

/** Interpolate the source image transform, not two independently changing
 * bounding boxes. A shared source-pixel anchor follows a direct path, and
 * scale progresses monotonically even when crop and zoom happen together. */
export function interpolateCropGeometry(a: ImageElement, b: ImageElement, frame: ImageElement,
  positionT: number, sizeT: number): Partial<ImageElement> {
  const u = (Math.max(a.cropX, b.cropX) + Math.min(a.cropX + a.cropWidth, b.cropX + b.cropWidth)) / 2;
  const v = (Math.max(a.cropY, b.cropY) + Math.min(a.cropY + a.cropHeight, b.cropY + b.cropHeight)) / 2;
  const start = imagePoint(a, u, v), end = imagePoint(b, u, v);
  const mix = (x: number, y: number, t: number) => x + (y - x) * t;
  const sx = mix(a.width / a.cropWidth, b.width / b.cropWidth, sizeT);
  const sy = mix(a.height / a.cropHeight, b.height / b.cropHeight, sizeT);
  const width = frame.cropWidth * sx, height = frame.cropHeight * sy;
  const dx = (frame.cropX + frame.cropWidth / 2 - u) * sx;
  const dy = (frame.cropY + frame.cropHeight / 2 - v) * sy;
  const angle = frame.rotation * Math.PI / 180;
  return { width, height,
    x: mix(start.x, end.x, positionT) + dx * Math.cos(angle) - dy * Math.sin(angle) - width / 2,
    y: mix(start.y, end.y, positionT) + dx * Math.sin(angle) + dy * Math.cos(angle) - height / 2 };
}

/** Disjoint mask regions prevent the shared area from fading or doubling up.
 * Also supports expanding, moving, and reversing the crop. */
export function cropFadeRegions({ from, to, t }: CropFade): (CropRect & { opacity: number })[] {
  const xs = [...new Set([from.x, from.x + from.width, to.x, to.x + to.width])].sort((a, b) => a - b);
  const ys = [...new Set([from.y, from.y + from.height, to.y, to.y + to.height])].sort((a, b) => a - b);
  const contains = (r: CropRect, x: number, y: number) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height;
  const result = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const x = xs[i], y = ys[j], width = xs[i + 1] - x, height = ys[j + 1] - y;
    const a = contains(from, x + width / 2, y + height / 2);
    const b = contains(to, x + width / 2, y + height / 2);
    const opacity = a && b ? 1 : a ? 1 - t : b ? t : 0;
    if (opacity > 0) result.push({ x, y, width, height, opacity });
  }
  return result;
}
