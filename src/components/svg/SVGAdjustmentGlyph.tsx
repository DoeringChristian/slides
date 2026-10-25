import { CONTROL_THEME } from './controlTheme';

/** Paint-only parametric adjustment glyph. The owning control supplies its
 * independent hit target, pointer ownership and gesture math. */
export function SVGAdjustmentGlyph({ x, y, zoom }: { x: number; y: number; zoom: number }) {
  const r = CONTROL_THEME.adjustmentSize / 2 / zoom;
  return <path data-adjustment-visual
    d={`M ${x} ${y - r} l ${r} ${r} l ${-r} ${r} l ${-r} ${-r} Z`}
    fill={CONTROL_THEME.fill} stroke={CONTROL_THEME.color}
    strokeWidth={CONTROL_THEME.strokeWidth / zoom}
    style={{ pointerEvents: 'none' }} />;
}
