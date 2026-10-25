import type { NativeStrokePlan } from './nativeStrokePlan';
import { collapsedCoverageCapVisible, type WeightedStrokeCoveragePlan } from './weightedStrokeCoverage';

/** Device-space intersection keeps far-off-world paths from allocating giant
 * layers. Rotation/shear transform the exact local curve/stroke bounding box. */
export function strokeCoverageDeviceBounds(plan: Pick<NativeStrokePlan, 'bounds'>, m: Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>, width: number, height: number) {
  const b = plan.bounds;
  const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]];
  const xs = corners.map(([x, y]) => m.a * x + m.c * y + m.e);
  const ys = corners.map(([x, y]) => m.b * x + m.d * y + m.f);
  const x = Math.max(0, Math.floor(Math.min(...xs)) - 1), y = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const right = Math.min(width, Math.ceil(Math.max(...xs)) + 1), bottom = Math.min(height, Math.ceil(Math.max(...ys)) + 1);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** Canvas/PDF counterpart of SVGStrokeCoverage: opaque union, source-in paint,
 * then one composite under the caller's opacity and silhouette clips. */
export function drawCanvasStrokeCoverage(ctx: CanvasRenderingContext2D, plan: NativeStrokePlan | WeightedStrokeCoveragePlan, color: string, width: number, dash: number[], offset = 0) {
  if ('layers' in plan) {
    drawWeightedCanvasStrokeCoverage(ctx, plan, color, width, dash, offset);
    return;
  }
  if (!plan.runs.length || width <= 0 || color === 'none') return;
  if (plan.runs.length === 1) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash);
    ctx.lineDashOffset = offset + plan.runs[0].offset;
    ctx.stroke(new Path2D(plan.runs[0].d));
    ctx.restore();
    return;
  }
  const transform = ctx.getTransform();
  const bounds = strokeCoverageDeviceBounds(plan, transform, ctx.canvas.width, ctx.canvas.height);
  if (!bounds.width || !bounds.height) return;
  const layer = document.createElement('canvas');
  layer.width = bounds.width; layer.height = bounds.height;
  const coverage = layer.getContext('2d')!;
  coverage.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e - bounds.x, transform.f - bounds.y);
  coverage.strokeStyle = '#fff'; coverage.lineWidth = width;
  coverage.lineCap = 'round'; coverage.lineJoin = 'round'; coverage.setLineDash(dash);
  for (const run of plan.runs) {
    coverage.lineDashOffset = offset + run.offset;
    coverage.stroke(new Path2D(run.d));
  }
  coverage.resetTransform();
  coverage.globalCompositeOperation = 'source-in';
  coverage.fillStyle = color;
  coverage.fillRect(0, 0, layer.width, layer.height);
  ctx.save();
  ctx.resetTransform();
  ctx.drawImage(layer, bounds.x, bounds.y);
  ctx.restore();
}

/** Two viewport-intersected buffers regardless of cohort count. Union each
 * cohort opaquely BEFORE weighting, then take the scalar per-pixel maximum.
 * Caller transform, clips, element alpha and composition apply only on output. */
function drawWeightedCanvasStrokeCoverage(ctx: CanvasRenderingContext2D, plan: WeightedStrokeCoveragePlan,
  color: string, width: number, dash: number[], offset: number) {
  if (width !== plan.strokeWidth) throw new RangeError('Weighted coverage width differs from validated bounds');
  if (!plan.layers.length || color === 'none') return;
  const m = ctx.getTransform();
  const b = strokeCoverageDeviceBounds(plan, m, ctx.canvas.width, ctx.canvas.height);
  if (!b.width || !b.height) return;
  const layer = document.createElement('canvas'); layer.width = b.width; layer.height = b.height;
  const coverage = layer.getContext('2d', { willReadFrequently: true })!;
  const maximum = coverage.createImageData(b.width, b.height);
  for (const cohort of plan.layers) {
    if (cohort.weight === 0) continue;
    coverage.resetTransform(); coverage.clearRect(0, 0, b.width, b.height);
    coverage.setTransform(m.a, m.b, m.c, m.d, m.e - b.x, m.f - b.y);
    coverage.strokeStyle = coverage.fillStyle = '#fff'; coverage.lineWidth = width;
    coverage.lineCap = coverage.lineJoin = 'round'; coverage.setLineDash(dash);
    for (const run of cohort.runs) {
      coverage.lineDashOffset = offset + run.offset;
      if (run.collapsedPoint) {
        if (collapsedCoverageCapVisible(offset + run.offset, dash)) {
          coverage.beginPath(); coverage.arc(...run.collapsedPoint, width / 2, 0, 2 * Math.PI); coverage.fill();
        }
      } else coverage.stroke(new Path2D(run.d));
    }
    const pixels = coverage.getImageData(0, 0, b.width, b.height).data;
    for (let i = 3; i < pixels.length; i += 4) maximum.data[i] = Math.max(maximum.data[i], Math.round(cohort.weight * pixels[i]));
  }
  for (let i = 0; i < maximum.data.length; i += 4) maximum.data[i] = maximum.data[i + 1] = maximum.data[i + 2] = 255;
  coverage.resetTransform(); coverage.putImageData(maximum, 0, 0);
  coverage.globalCompositeOperation = 'source-in'; coverage.fillStyle = color;
  coverage.fillRect(0, 0, b.width, b.height);
  ctx.save(); ctx.resetTransform(); ctx.drawImage(layer, b.x, b.y); ctx.restore();
}
