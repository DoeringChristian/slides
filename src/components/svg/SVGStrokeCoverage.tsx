import { useId } from 'react';
import type { NativeStrokePlan } from '../../utils/nativeStrokePlan';
import { coverageLayerSvg, type WeightedStrokeCoveragePlan } from '../../utils/weightedStrokeCoverage';

/** Union opaque shaft coverage first, then apply paint alpha exactly once.
 * Original distances preserve dash/reveal phase across consumed intervals. */
export function SVGStrokeCoverage({ plan, color, width, dash, offset = 0, opacity = 1, idPrefix = 'shaft', instanceId }: {
  plan: NativeStrokePlan | WeightedStrokeCoveragePlan; color: string; width: number; dash?: string | number;
  offset?: number; opacity?: number; idPrefix?: string;
  /** Stable owner identity across a consumed/native branch change. */
  instanceId?: string;
}) {
  const fallback = useId();
  const instance = (instanceId ?? fallback).replace(/:/g, '');
  const id = `${encodeURIComponent(idPrefix)}-coverage-${instance}`;
  if ('layers' in plan) {
    if (width !== plan.strokeWidth) throw new RangeError('Weighted coverage width differs from validated bounds');
    if (!plan.layers.length) return null;
    const pattern = dash === undefined ? [] : String(dash).split(/[ ,]+/).map(Number);
    return <>
      <defs><filter id={`${id}-max`} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" {...plan.bounds} colorInterpolationFilters="sRGB">
        {plan.layers.map((layer, i) => <feImage key={`image-${i}`} {...plan.bounds} preserveAspectRatio="none"
          href={`data:image/svg+xml,${encodeURIComponent(coverageLayerSvg(plan, layer.runs, pattern, offset))}`} result={`opaque-${i}`} />)}
        {plan.layers.map((layer, i) => <feComponentTransfer key={`weight-${i}`} in={`opaque-${i}`} result={`weight-${i}`}>
          <feFuncA type="linear" slope={layer.weight} />
        </feComponentTransfer>)}
        {plan.layers.slice(1).flatMap((_, j) => {
          const i = j + 1, previous = i === 1 ? 'weight-0' : `max-${i - 1}`;
          // max(A,B) = positive(A-B)+B. Source-over and transparent
          // lighten both fail the .25/.5 overlap discriminator.
          return [
            <feComposite key={`positive-${i}`} in={previous} in2={`weight-${i}`} operator="arithmetic" k2={1} k3={-1} result={`positive-${i}`} />,
            <feComposite key={`max-${i}`} in={`positive-${i}`} in2={`weight-${i}`} operator="arithmetic" k2={1} k3={1} result={`max-${i}`} />,
          ];
        })}
      </filter>
      <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" {...plan.bounds} style={{ maskType: 'alpha' }}>
        <rect {...plan.bounds} fill="white" filter={`url(#${id}-max)`} />
      </mask></defs>
      <rect {...plan.bounds} fill={color} opacity={opacity} mask={`url(#${id})`} style={{ pointerEvents: 'none' }} />
    </>;
  }
  if (!plan.runs.length || width <= 0) return null;
  // A single native stroke already unions self-crossings before applying alpha.
  // Keep this equivalent fast path (and its native rasterization) when possible.
  if (plan.runs.length === 1) {
    const run = plan.runs[0];
    return <path d={run.d} fill="none" stroke={color} strokeWidth={width} strokeOpacity={opacity}
      strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeDashoffset={offset + run.offset}
      style={{ pointerEvents: 'none' }} />;
  }
  return <>
    <defs><mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" {...plan.bounds} style={{ maskType: 'alpha' }}>
      {plan.runs.map((run, i) => <path key={i} d={run.d} fill="none" stroke="white" strokeWidth={width}
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeDashoffset={offset + run.offset} />)}
    </mask></defs>
    <rect {...plan.bounds} fill={color} opacity={opacity} mask={`url(#${id})`} style={{ pointerEvents: 'none' }} />
  </>;
}
