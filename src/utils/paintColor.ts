/** Supported persisted paint syntax. Unknown CSS colours remain renderable and
 * snap during interpolation; editing alpha is disabled for unknown syntax. */
export interface PaintColor { r: number; g: number; b: number; a: number }
const clamp = (v: number, max = 1) => Math.max(0, Math.min(max, v));
export function noPaint(color: string): boolean {
  return !color || color === 'none' || color === 'transparent';
}
export function parsePaintColor(color: string): PaintColor | null {
  if (noPaint(color)) return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length < 5 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*((?:\d*\.)?\d+)(%?)\s*[, ]\s*((?:\d*\.)?\d+)(%?)\s*[, ]\s*((?:\d*\.)?\d+)(%?)(?:\s*[,/]\s*((?:\d*\.)?\d+)(%?))?\s*\)$/i.exec(color.trim());
  if (!rgb) return null;
  return { r: clamp(+rgb[1] * (rgb[2] ? 2.55 : 1), 255), g: clamp(+rgb[3] * (rgb[4] ? 2.55 : 1), 255), b: clamp(+rgb[5] * (rgb[6] ? 2.55 : 1), 255), a: rgb[7] === undefined ? 1 : clamp(+rgb[7] / (rgb[8] ? 100 : 1)) };
}
export function paintHex(c: PaintColor): string {
  return '#' + [c.r, c.g, c.b].map(v => Math.round(clamp(v, 255)).toString(16).padStart(2, '0')).join('');
}
export function formatPaintColor(c: PaintColor): string {
  return c.a >= 1 ? paintHex(c) : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+clamp(c.a).toFixed(4)})`;
}
export function withPaintAlpha(color: string, alpha: number): string {
  const c = parsePaintColor(color);
  return c ? formatPaintColor({ ...c, a: clamp(alpha) }) : color;
}
/** A no-colour sentinel has no remembered colour; picking a swatch starts opaque. */
export function withPaintRgb(current: string, rgb: string): string {
  const c = parsePaintColor(rgb);
  return c ? formatPaintColor({ ...c, a: noPaint(current) ? 1 : (parsePaintColor(current)?.a ?? 1) }) : rgb;
}
