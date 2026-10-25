// Actual production primitives, explicit fixed-source plans only. This fixture
// deliberately does NOT add birth-plan selection to RenderShape or playback.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SVGStrokeCoverage } from '/src/components/svg/SVGStrokeCoverage.tsx';
import { drawCanvasStrokeCoverage, strokeCoverageDeviceBounds } from '/src/utils/canvasStrokeCoverage.ts';
import { weightedStrokeCoveragePlan } from '/src/utils/weightedStrokeCoverage.ts';
import { roundedClosingBirthFamily, evaluateRoundedClosingBirth } from '/src/utils/roundedClosingBirth.ts';
import { nativeBernsteinRoots, paintedNativePath } from '/src/utils/nativePathSpans.ts';
import { RenderShape } from '/src/components/svg/ElementRenderer.tsx';
import { drawShapeElement } from '/src/utils/exportPdf.ts';
import { createShapeElement } from '/src/utils/slideFactory.ts';
import { nativeSpanLength } from '/src/utils/nativeStrokePlan.ts';
import { compareCoverageRaster } from './coverageRasterComparator.js';
import { collinearCapsuleUnion, capsuleUnionBoundaryDistance } from './collinearCapsuleUnion.js';
const h = React.createElement;
const value = result => { if (result.kind !== 'supported') throw Error(result.reason); return result.value; };
const size = 320;
function synthetic(specs, width = 20) {
  const spans = specs.map((s, i) => ({ kind: 'L', controls: s.points, role: s.cohort === null ? 'authored' : 'closing', index: i }));
  const painted = paintedNativePath({ start: spans[0].controls[0], spans, closed: false });
  let offset = 0;
  const fragments = painted.spans.map((span, i) => { const length = nativeSpanLength(span), f = { span, spanIndex: i, from: 0, to: 1,
    runIndex: i, cohort: specs[i].cohort, offset, length }; offset += length; return f; });
  const cohorts = [...new Set(specs.map(s => s.cohort).filter(c => c !== null))].map(id => ({ id, active: true, weight: specs.find(s => s.cohort === id).weight }));
  return value(weightedStrokeCoveragePlan({ painted, fragments, cohorts, length: offset, paintConsumption: { runs: fragments.map(f => [f]) } }, width));
}
async function raster(plan, mode, { color = '#000', alpha = 1, dash = [], offset = 0, translate = [40, 40], scale = 1, matrix = [1, 0, 0, 1, 0, 0], clip, originalElement } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (mode === 'canvas') {
    ctx.globalAlpha = alpha; ctx.translate(...translate); ctx.scale(scale, scale); ctx.transform(...matrix);
    if (clip) { ctx.beginPath(); ctx.rect(...clip); ctx.clip(); }
    if (originalElement) drawShapeElement(ctx, originalElement);
    drawCanvasStrokeCoverage(ctx, plan, color, plan.strokeWidth ?? 20, dash, offset);
  } else {
    const markup = renderToStaticMarkup(h('svg', { xmlns: 'http://www.w3.org/2000/svg', width: size, height: size },
      clip && h('defs', null, h('clipPath', { id: 'external-clip' }, h('rect', { x: clip[0], y: clip[1], width: clip[2], height: clip[3] }))),
      h('g', { transform: `translate(${translate.join(' ')}) scale(${scale}) matrix(${matrix.join(' ')})`, opacity: alpha, clipPath: clip ? 'url(#external-clip)' : undefined },
        originalElement && h(RenderShape, { element: originalElement }),
        h(SVGStrokeCoverage, { plan, color, width: plan.strokeWidth ?? 20, dash: dash.join(' ') || undefined, offset, instanceId: 'raster' }))));
    const image = new Image(), url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    try { image.src = url; await image.decode(); ctx.drawImage(image, 0, 0); } finally { URL.revokeObjectURL(url); }
  }
  return { data: ctx.getImageData(0, 0, size, size).data, png: c.toDataURL() };
}
const alphaAt = (image, x, y) => image.data[(y * size + x) * 4 + 3];
const check = (condition, message) => { if (!condition) throw Error(message); };
const flat = (image, x, y, alpha) => [-1, 0, 1].every(dy => [-1, 0, 1].every(dx => alphaAt(image, x + dx, y + dy) === alpha));
const compare = (actual, expected) => compareCoverageRaster(actual, expected, size);
// Tiny-third's RETAINED fragments, not its untrimmed source polyline.
// Each control lies in y=[0,.01] and between its endpoint x values, so its
// continuous x projection is exactly that endpoint interval. Its round stroke
// is within .01 Hausdorff distance of the corresponding horizontal capsule.
// This includes terminal-trimmed shaft caps and the isolated closing cap.
// 2px covers .01 geometry + sqrt(.5) pixel radius + one device AA pixel.
// The fringe is geometry-only; changed pixels never define the exception set.
function tinyCapsuleChanges(actual, before, partitions) {
  const capsules = partitions.flatMap(partition => partition.fragments.map(f => {
    const controls = f.span.controls, xs = [controls[0][0], controls.at(-1)[0]];
    const lo = Math.min(...xs), hi = Math.max(...xs);
    check(controls.every(([x, y]) => x >= lo && x <= hi && y >= 0 && y <= .01), 'tiny capsule projection certificate');
    return { lo: lo + 40, hi: hi + 40, radius: 10 };
  }));
  // Merge overlapping centerlines; certify the remaining capsules disjoint.
  // Internal fragment circles are NOT boundaries of the painted silhouette.
  const union = collinearCapsuleUnion(capsules);
  const changed = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (actual.data.slice(i, i + 4).every((v, k) => v === before.data[i + k])) continue;
    const a = alphaAt(actual, x, y), b = alphaAt(before, x, y);
    const px = x + .5, py = y + .5;
    const boundaryDistance = capsuleUnionBoundaryDistance(union, px, py - 40);
    check(boundaryDistance <= 2, `tiny capsule EXACT core changed at ${x},${y}: ${b}->${a}`);
    changed.push({ x, y, before: b, after: a, boundaryDistance });
  }
  // Real negative space between isolated cap and trimmed shaft; not AA fringe.
  check(flat(actual, 70, 40, 0), 'tiny consumed gap must not acquire ghost ink');
  check(flat(actual, 25, 40, 0), 'tiny closing cap must not grow outside radius');
  return { capsules, union, changedPixels: changed };
}
export async function runWeightedCoverageProof() {
  const records = [], images = [], oracleNegatives = [];
  window.weightedProofProgress = { records, images };
  const cross = [
    { points: [[20, 80], [180, 80]], cohort: 'quarter', weight: .25 },
    { points: [[100, 20], [100, 160]], cohort: 'half', weight: .5 },
  ];
  for (const mode of ['svg', 'canvas']) {
    const scalar = await raster(synthetic(cross), mode);
    check(Math.abs(alphaAt(scalar, 140, 120) - 128) <= 1, `${mode} scalar max must be .5, not .625: ${alphaAt(scalar, 140, 120)}`);
    const repeated = await raster(synthetic([...cross.slice(1), { ...cross[0], cohort: 'half', weight: .5 }, { ...cross[0], cohort: 'half', weight: .5 }]), mode);
    check(Math.abs(alphaAt(repeated, 140, 120) - 128) <= 1, `${mode} repeated cohort weighted once`);
    const rgba = await raster(synthetic(cross), mode, { color: 'rgba(40,80,160,.5)', alpha: .5 });
    check(Math.abs(alphaAt(rgba, 140, 120) - 32) <= 1, `${mode} stroke and element alpha once`);
    const mixed = synthetic([{ ...cross[0], cohort: null }, cross[1]]);
    const old = await raster(mixed, mode), oldReference = await raster({ runs: mixed.layers[0].runs, bounds: mixed.bounds, length: mixed.length }, mode);
    check(flat(old, 140, 120, 255), `${mode} old opaque crossing 3x3 exact`);
    // Old body is never dimmed, even at mixed-run/new coverage crossings.
    let oldFlatMismatch = 0, oldAAChanges = 0;
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      if (flat(oldReference, x, y, 255) && alphaAt(old, x, y) !== 255) oldFlatMismatch++;
      else if (alphaAt(oldReference, x, y) > 0 && alphaAt(oldReference, x, y) < 255 && alphaAt(old, x, y) !== alphaAt(oldReference, x, y)) oldAAChanges++;
    }
    check(oldFlatMismatch === 0, `${mode} old opaque interior changed`);
    // Use actual shared native body/head consumers, not an invented head oracle.
    // This proves compositing preservation, not automatic weighted selection.
    const originalElement = createShapeElement('path', { x: 0, y: 0, points: [20, 80, 180, 80], stroke: '#2850a0', fill: 'none', strokeWidth: 20, startHead: 'triangle', endHead: 'triangle' });
    const base = await raster({ ...mixed, layers: [] }, mode, { originalElement });
    const combined = await raster(mixed, mode, { originalElement, color: '#2850a0' });
    let opaqueRGBA = 0;
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) if (flat(base, x, y, 255)) {
      const i = (y * size + x) * 4;
      check(base.data.slice(i, i + 4).every((v, k) => v === combined.data[i + k]), `${mode} original body/head RGBA changed at ${x},${y}`);
      opaqueRGBA++;
    }
    check(opaqueRGBA > 2000, `${mode} body/head comparison is populated`);
    const self = synthetic([{ points: [[20, 20], [180, 180]], cohort: 'self', weight: .5 }]);
    self.layers[0].runs[0].d = 'M20 20 L180 180 L20 180 L180 20';
    self.bounds = { x: 9, y: 9, width: 182, height: 182 };
    const selfCross = await raster(self, mode);
    check(Math.abs(alphaAt(selfCross, 140, 140) - 128) <= 1, `${mode} one self-crossing stroke weighted once`);
    records.push({ mode, opaqueRGBA, selfCross: alphaAt(selfCross, 140, 140) });
    images.push({ name: `${mode}-original-head-body`, png: combined.png });
    const cap = synthetic([{ points: [[100, 100], [100, 100]], cohort: 'active-raw', weight: 1 }]);
    const visible = await raster(cap, mode), gap = await raster(cap, mode, { dash: [10, 10], offset: 15 });
    check(alphaAt(visible, 140, 140) === 255, `${mode} weight1 collapsed birth cap must survive native normalization`);
    check(alphaAt(gap, 140, 140) === 0, `${mode} collapsed cap must not resurrect dash-gap ink`);
    const createGap = await raster(cap, mode, { dash: [100, 100], offset: 150 });
    check(alphaAt(createGap, 140, 140) === 0, `${mode} collapsed cap respects Create gap`);
    const transformed = await raster(synthetic(cross), mode, { translate: [90, 70], scale: .75, clip: [0, 0, 100, 200] });
    check(Math.abs(alphaAt(transformed, 164, 130) - 128) <= 1 && alphaAt(transformed, 175, 130) === 0, `${mode} transform/clip aligns bounded inputs`);
    records.push({ mode, scalarMax: alphaAt(scalar, 140, 120), repeated: alphaAt(repeated, 140, 120), rgba: alphaAt(rgba, 140, 120), oldFlatMismatch, oldAAChanges, collapsed: alphaAt(visible, 140, 140), gap: alphaAt(gap, 140, 140) });
    images.push({ name: `${mode}-scalar-max`, png: scalar.png }, { name: `${mode}-mixed-alpha`, png: rgba.png });
  }
  const fixtures = [
    { name: 'L', points: [0, 0, 100, 0, 100, 100], threshold: .005 / (100 + 25 / Math.sqrt(2)) },
    { name: 'short', points: [0, 0, 100, 0, 100, 4, 0, 4], threshold: .005 / 6 },
    { name: 'tiny-third', points: [0, 0, 100, 0, 100, .01, 0, .01], threshold: 1 / 3 },
    { name: 'tiny-half', points: [0, .004, 100, .004, 100, .01, 0, .01], threshold: .5 },
    { name: 'collapsed-target', points: [0, 0, 100, 0, 100, .004, 0, .004], threshold: .5 },
    { name: 'late-end-island', points: [0, 100, -100, 0, 0, 0], threshold: .95, shape: { startHead: 'none', endHead: 'circle', cornerRadius: 20, strokeWidth: 5.7 }, options: { translate: [160, 80] } },
    { name: 'late-start-island', points: [0, 0, 100, 0, 0, 100], threshold: nativeBernsteinRoots([25000, -5475, 5810 / 3, -496, 16]).find(p => p > .99 && p < .995), shape: { startHead: 'circle', endHead: 'none', cornerRadius: 20, strokeWidth: 5.7 } },
  ];
  for (const fixture of fixtures) {
    const shape = { points: fixture.points, cornerRadius: 25, strokeWidth: 20, startHead: 'triangle', endHead: 'triangle', ...fixture.shape };
    const family = value(roundedClosingBirthFamily(shape, { geometry: 'fixed' }));
    const phases = [...new Set([.95, .99, .995, 0, 1e-9, 1e-6, .00001, .0001, .001, .01, .05, .1, 1 - 1e-9, 1,
      ...Array.from({ length: 41 }, (_, i) => fixture.threshold + (i - 20) * Math.min(1e-8, fixture.threshold / 100))])].sort((a, b) => a - b);
    let previous, maxAdjacentDelta = 0;
    for (const p of phases) {
      const partition = value(evaluateRoundedClosingBirth(family, p));
      window.weightedProofProgress.current = { fixture: fixture.name, p, partition };
      const plan = value(weightedStrokeCoveragePlan(partition, shape.strokeWidth));
      const svg = await raster(plan, 'svg', fixture.options), canvas = await raster(plan, 'canvas', fixture.options);
      if (fixture.name === 'tiny-third' && p === 1) {
        for (const [mode, image] of [['svg', svg], ['canvas', canvas]]) {
          check(alphaAt(image, 130, 40) === 255, `${mode} regression pixel starts opaque`);
          for (const channel of [0, 3]) {
            const tampered = { data: image.data.slice() }, i = (40 * size + 130) * 4 + channel;
            tampered.data[i] = channel === 3 ? 254 : 1;
            let rejected = false;
            try { tinyCapsuleChanges(tampered, image, [partition]); }
            catch (error) { rejected = error.message.includes('EXACT core changed at 130,40'); }
            check(rejected, `${mode} one-byte channel${channel} core mutation must fail`);
            oracleNegatives.push({ mode, x: 130, y: 40, channel, before: image.data[i], after: tampered.data[i], rejected });
          }
        }
      }

      // Expected scalar coverage from independently rasterized opaque layers;
      // analytic algebra, never fractional source-over or a second SVG prototype.
      const expected = { data: new Uint8ClampedArray(size * size * 4) };
      for (const layer of plan.layers) {
        const opaque = await raster({ ...plan, layers: [{ ...layer, weight: 1 }] }, 'canvas', fixture.options);
        for (let i = 3; i < expected.data.length; i += 4) expected.data[i] = Math.max(expected.data[i], Math.round(opaque.data[i] * layer.weight));
      }
      let scalarMismatch = 0;
      for (let i = 3; i < expected.data.length; i += 4) if (canvas.data[i] !== expected.data[i]) scalarMismatch++;
      check(scalarMismatch === 0, `${fixture.name} p${p} Canvas exact maximum`);
      const parity = compare(svg, canvas);
      check(parity.flatMismatch === 0, `${fixture.name} p${p} SVG/Canvas flat 3x3 mismatch ${JSON.stringify(parity)}`);
      if (previous && Math.abs(p - previous.p) < 3e-8) {
        for (const [mode, image, before] of [['svg', svg, previous.image], ['canvas', canvas, previous.canvas]]) {
          let max = 0;
          for (let i = 3; i < image.data.length; i += 4) max = Math.max(max, Math.abs(image.data[i] - before.data[i]));
          maxAdjacentDelta = Math.max(maxAdjacentDelta, max);
          const continuity = compare(image, before);
          check(continuity.flatMismatch === 0, `${fixture.name} ${mode} threshold flat interior jumped ${JSON.stringify(continuity)}`);
          const geometry = fixture.name === 'tiny-third' ? tinyCapsuleChanges(image, before, [partition, previous.partition]) : undefined;
          if (geometry) check(max <= (p === 1 ? 62 : 8), `tiny-third ${mode} bounded edge error exceeded at ${p}: ${max}`);
          if (max > 1) {
            records.push({ fixture: fixture.name, mode, thresholdAA: { from: previous.p, to: p, max, ...continuity, ...geometry } });
            images.push({ name: `${fixture.name}-${mode}-${p}-before`, png: before.png }, { name: `${fixture.name}-${mode}-${p}-after`, png: image.png });
          }
        }
      }
      previous = { p, image: svg, canvas, partition };
      records.push({ fixture: fixture.name, p, weights: partition.cohorts.map(c => c.weight), fullClock: plan.length, scalarMismatch, ...parity });
      if (p === fixture.threshold || p === 1) images.push({ name: `${fixture.name}-${p === 1 ? 'final' : 'threshold'}-svg`, png: svg.png }, { name: `${fixture.name}-${p === 1 ? 'final' : 'threshold'}-canvas`, png: canvas.png });
    }
    records.push({ fixture: fixture.name, maxAdjacentThresholdDelta: maxAdjacentDelta, samples: phases.length });
    // Dash and Create reveal use the FULL clock, including consumed intervals.
    const partition = value(evaluateRoundedClosingBirth(family, .05));
    const plan = value(weightedStrokeCoveragePlan(partition, shape.strokeWidth));
    for (const dash of [[12, 8], [plan.length, plan.length]]) {
      const offset = dash[0] === plan.length ? plan.length * .45 : 7;
      const svg = await raster(plan, 'svg', { ...fixture.options, dash, offset }), canvas = await raster(plan, 'canvas', { ...fixture.options, dash, offset });
      const parity = compare(svg, canvas);
      check(parity.flatMismatch === 0, `${fixture.name} dash/Create phase flat mismatch ${JSON.stringify(parity)}`);
      records.push({ fixture: fixture.name, dash, offset, ...parity });
    }
    // Same fixed family, reversed and repeated p: exact pixels, no history.
    const again = value(weightedStrokeCoveragePlan(value(evaluateRoundedClosingBirth(family, .05)), shape.strokeWidth));
    const a = await raster(again, 'canvas', fixture.options), b = await raster(plan, 'canvas', fixture.options);
    check(a.data.every((v, i) => v === b.data[i]), `${fixture.name} reverse/const pixels`);
  }
  const far = synthetic([{ points: [[-1e8, 0], [1e8, 0]], cohort: 'far', weight: .5 }]);
  const bounds = strokeCoverageDeviceBounds(far, { a: 1, b: .2, c: .3, d: 1, e: 10, f: 20 }, size, size);
  check(bounds.width <= size && bounds.height <= size, 'world-size geometry bounded by device viewport');
  const unsupported = [
    roundedClosingBirthFamily({ points: [0, 0, 100, 0, 10, 0], cornerRadius: 25, strokeWidth: 20, startHead: 'triangle', endHead: 'triangle' }, { geometry: 'fixed' }),
    roundedClosingBirthFamily({ points: fixtures[0].points, cornerRadius: 25, strokeWidth: 20 }, { geometry: 'animated' }),
  ];
  check(unsupported.every(r => r.kind === 'unsupported'), 'unsupported families not silently selected');
  return { records, images, oracleNegatives, deviceBounds: bounds, unsupported: unsupported.map(r => r.reason), note: 'Native/static selection, animated geometry and inward rays intentionally NOT integrated. Heads/fill remain separate native consumers.' };
}
