/** Shared canvas-control paint and screen-space dimensions. Hit geometry is
 * owned separately by each interaction, never inferred from the visible glyph. */
export const CONTROL_THEME = {
  color: '#6965db',
  lockedColor: '#dc2626',
  fill: 'white',
  strokeWidth: 1,
  adjustmentSize: 8,
} as const;
