/** Thumb positions of a logarithmic slider: [0, LOG_STEPS] spread evenly over
 *  the doublings of [min, max] (equal travel from 25% to 50% as from 800% to
 *  1600%). */
export const LOG_STEPS = 1000;

export function logThumb(value: number, min: number, max: number): number {
  const v = Math.max(min, Math.min(max, value));
  return Math.round(LOG_STEPS * Math.log(v / min) / Math.log(max / min));
}

/** The value at a thumb position, rounded to `step`. */
export function logValue(thumb: number, min: number, max: number, step: number): number {
  return Math.round(min * Math.pow(max / min, thumb / LOG_STEPS) / step) * step;
}
