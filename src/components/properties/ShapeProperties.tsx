import React, { useContext } from 'react';
import { CreationDraftContext } from './CreationDraftContext';
import { PropertyList } from './PropertyList';
import {
  Property,
  ColorProperty,
  NumberProperty,
  CheckboxProperty,
  PreviewSelectProperty,
  ReadoutProperty,
  type PropertyContext,
} from './Property';
import type { ShapeElement, ConnectorBinding, PathCurve, StrokeStyle, FillStyle, ArrowheadType, TransitionGroup } from '../../types/presentation';
import { bindingFor, resolveBinding, isPinnedBinding } from '../../utils/connectorUtils';
import { pathGeometryUpdate, pathPointsInSlide, slidePointToPath } from '../../utils/pathEditing';
import { catmullTangents, arrowheadGeometry, strokeDashFor, pathD } from '../../utils/pathShapes';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { IconSelect, type IconSelectOption } from '../controls/IconSelect';
import { PreviewSelect } from '../controls/PreviewSelect';
import { createShapeElement } from '../../utils/slideFactory';
import { RenderShape, RenderArrowhead } from '../svg/ElementRenderer';

const isRect = (el: ShapeElement) => el.shapeType === 'rect';
const isPath = (el: ShapeElement) => el.shapeType === 'path';
// Rounded-corner row applies to rects and to linear polylines (≥3 verts).
// B-splines are already smooth, so the property is hidden there.
const supportsCornerRadius = (el: ShapeElement) =>
  isRect(el)
  || (isPath(el)
      && (el.curve ?? 'linear') === 'linear'
      && (el.points?.length ?? 0) >= 6);

// ---------------------------------------------------------------------------
// Per-end binding "pin" toggle (binding v2)
// ---------------------------------------------------------------------------

/**
 * Checkbox that converts a connector-end binding between aim mode
 * (Excalidraw default: endpoint re-aims at the target's silhouette) and
 * pinned mode (endpoint sticks to a fixed [u,v] point on the target).
 * Toggling derives the new binding FROM THE CURRENTLY RESOLVED endpoint, so
 * the arrow doesn't jump — it needs the slide's elements for the target's
 * geometry, hence the store reads here rather than in the Property class.
 */
const BindingPinToggle: React.FC<{
  element: ShapeElement;
  end: 'start' | 'end';
  update: (changes: Partial<ShapeElement>) => void;
}> = ({ element, end, update }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slide = usePresentationStore((s) => s.presentation.slides[activeSlideId]);
  const binding = end === 'start' ? element.startBinding : element.endBinding;
  if (!binding) return null;
  const target = slide?.elements[binding.elementId];
  const pts = element.points ?? [];
  const canToggle = !!target && pts.length >= 4;
  const pinned = isPinnedBinding(binding);

  const toggle = (checked: boolean) => {
    if (!target || pts.length < 4) return;
    const last = pts.length - 2;
    const idx = end === 'start' ? 0 : last;
    const adjIdx = end === 'start' ? 2 : last - 2;
    const abs = pathPointsInSlide(element);
    const point = { x: abs[idx], y: abs[idx + 1] };
    const adj = { x: abs[adjIdx], y: abs[adjIdx + 1] };
    const next: ConnectorBinding = bindingFor(point, target, checked ? 'pinned' : 'aim');
    // Bake the re-solved endpoint alongside the binding so the stored
    // geometry and the binding always agree (mutation-time baking).
    const resolved = resolveBinding(next, target, adj);
    abs[idx] = resolved.x;
    abs[idx + 1] = resolved.y;
    const local = abs.flatMap((_, i) => {
      if (i % 2) return [];
      const p = slidePointToPath(element, abs[i], abs[i + 1]);
      return [p.x, p.y];
    });
    const b = pathGeometryUpdate(element, local, element.tangents);
    update({
      [end === 'start' ? 'startBinding' : 'endBinding']: next,
      ...b,
    } as Partial<ShapeElement>);
  };

  return (
    <label className={`text-xs flex items-center gap-2 ${canToggle ? 'text-gray-500' : 'text-gray-300'}`}>
      <input
        type="checkbox"
        checked={pinned}
        disabled={!canToggle}
        onChange={(e) => toggle(e.target.checked)}
        className="accent-blue-500 disabled:opacity-50"
      />
      Pinned
    </label>
  );
};

/** Header-driven row for one connector end's pin toggle. Visible only while
 *  that end is bound. syncFields = the binding itself, so SlideSync /
 *  keyframe buttons act on the binding payload. */
class BindingPinProperty extends Property<ShapeElement> {
  readonly key: string;
  readonly label: string;
  private readonly end: 'start' | 'end';
  private readonly _groupWithPrevious: boolean;

  constructor(end: 'start' | 'end', groupWithPrevious = false) {
    super();
    this.end = end;
    this.key = end === 'start' ? 'startBinding' : 'endBinding';
    this.label = end === 'start' ? 'Start pin' : 'End pin';
    this._groupWithPrevious = groupWithPrevious;
  }

  override get groupWithPrevious(): boolean { return this._groupWithPrevious; }

  override visibleFor(el: ShapeElement): boolean {
    return isPath(el) && !!(this.end === 'start' ? el.startBinding : el.endBinding);
  }

  renderEditor({ element, update }: PropertyContext<ShapeElement>) {
    return <BindingPinToggle element={element} end={this.end} update={update} />;
  }
}

/** Normal modes are straight, automatic through-point curvature, and manual
 * Bézier. B-splines stay selected and render unchanged until an explicit
 * conversion; dormant manual tangents survive mode switches. */
class CurveProperty extends Property<ShapeElement> {
  readonly key = 'curve';
  readonly label = 'Curve';
  override get groupWithPrevious(): boolean { return true; }
  override get transitionGroup(): TransitionGroup { return 'controlPoints'; }
  override get syncFields(): string[] { return ['curve', 'tangents', 'points', 'x', 'y', 'width', 'height']; }
  override visibleFor(el: ShapeElement): boolean { return isPath(el); }

  renderEditor({ element, update }: PropertyContext<ShapeElement>) {
    const mode = element.curve ?? 'linear';
    const options: Array<{ value: PathCurve; label: string }> = [
      { value: 'linear', label: 'Straight' },
      { value: 'smooth', label: 'Curved through points' },
      { value: 'bezier', label: 'Bezier' },
    ];
    if (mode === 'bspline2' || mode === 'bspline3') {
      options.push({ value: mode, label: `B-spline (${mode === 'bspline2' ? 'quadratic' : 'cubic'})` });
    }
    return <PreviewSelect<PathCurve>
      label={this.label}
      iconOnly
      value={mode}
      options={options.map((o) => ({ ...o, preview: curvePreview(o.value) }))}
      onChange={(curve) => {
        const points = element.points ?? [];
        const tangents = curve === 'bezier' && element.tangents?.length !== points.length * 2
          ? catmullTangents(points, !!element.closed) : element.tangents;
        update({ curve, ...pathGeometryUpdate({ ...element, curve }, points, tangents) });
      }}
    />;
  }
}

function curvePreview(curve: PathCurve): React.ReactNode {
  const points = [3, 23, 22, 6, 43, 23, 62, 6];
  return <svg width={65} height={30} viewBox="0 0 65 30" aria-hidden="true">
    <path d={pathD(points, curve, false)} fill="none" stroke="currentColor" strokeWidth={1.5} />
    {points.filter((_, i) => i % 2 === 0).map((x, i) =>
      <circle key={i} cx={x} cy={points[2 * i + 1]} r={2} fill="currentColor" />)}
    {curve === 'bezier' && <path d="M 12 6 H 32 M 33 23 H 53" stroke="currentColor" strokeWidth={0.7} />}
  </svg>;
}

// ---------------------------------------------------------------------------
// Typed arrowhead selector (WS-2 Phase 3)
// ---------------------------------------------------------------------------

const ARROWHEAD_TYPES: Array<{ value: ArrowheadType; title: string }> = [
  { value: 'none', title: 'None' },
  { value: 'arrow', title: 'Arrow' },
  { value: 'triangle', title: 'Triangle' },
  { value: 'triangle-outline', title: 'Triangle (outline)' },
  { value: 'bar', title: 'Bar' },
  { value: 'dot', title: 'Dot' },
  { value: 'circle', title: 'Circle' },
  { value: 'circle-outline', title: 'Circle (outline)' },
  { value: 'diamond', title: 'Diamond' },
  { value: 'diamond-outline', title: 'Diamond (outline)' },
  { value: 'crowfoot-one', title: 'Crowfoot (one)' },
  { value: 'crowfoot-many', title: 'Crowfoot (many)' },
  { value: 'crowfoot-one-many', title: 'Crowfoot (one or many)' },
];

/** Preview icon: a stub shaft plus the head drawn by LITERALLY calling the
 *  production `arrowheadGeometry` + `RenderArrowhead` at a fixed size —
 *  previews can never drift from what the canvas renders. Start-head
 *  previews point left, end-head previews point right. */
function headPreview(type: ArrowheadType, end: 'start' | 'end'): React.ReactNode {
  const W = 26, H = 14, PAD = 3, SIZE = 6, SW = 1.5;
  const midY = H / 2;
  const tipX = end === 'end' ? W - PAD : PAD;
  const tailX = end === 'end' ? PAD : W - PAD;
  const dirX = end === 'end' ? 1 : -1;
  const geo = arrowheadGeometry(type, tipX, midY, dirX, 0, SIZE, SW);
  const shaftEndX = tipX - dirX * geo.shaftInset;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line
        x1={tailX} y1={midY} x2={shaftEndX} y2={midY}
        stroke="currentColor" strokeWidth={SW} strokeLinecap="round"
      />
      <RenderArrowhead geo={geo} color="currentColor" strokeWidth={SW} />
    </svg>
  );
}

/** Tile preview for one stroke style: a real line sample drawn with the
 *  SAME `strokeDashFor` helper the canvas renderer applies (round caps too,
 *  matching RenderPaths) — the preview can't drift from what a pick does.
 *  Fixed 2px sample width keeps every tile legible regardless of the
 *  element's own stroke width. */
function strokeStylePreview(style: StrokeStyle): React.ReactNode {
  const SW = 2;
  return (
    <svg width={44} height={8} viewBox="0 0 44 8" aria-hidden="true">
      <line
        x1={3} y1={4} x2={41} y2={4}
        stroke="currentColor" strokeWidth={SW} strokeLinecap="round"
        strokeDasharray={strokeDashFor(style, SW)}
      />
    </svg>
  );
}

interface ArrowheadOpts {
  key: 'startHead' | 'endHead';
  label: string;
  transitionGroup: TransitionGroup;
}

/** IconSelect-backed exclusive choice row for one path end's arrowhead.
 *  Value semantics: absent = 'none'. Picking 'none' writes the explicit
 *  'none' value (never `undefined` — the Y path skips undefined changes,
 *  so an undefined-as-delete write would silently diverge from JSON). */
class ArrowheadProperty extends Property<ShapeElement> {
  readonly key: 'startHead' | 'endHead';
  readonly label: string;
  private readonly _transitionGroup: TransitionGroup;
  private readonly options: Array<IconSelectOption<ArrowheadType>>;

  constructor(opts: ArrowheadOpts) {
    super();
    this.key = opts.key;
    this.label = opts.label;
    this._transitionGroup = opts.transitionGroup;
    const end = opts.key === 'startHead' ? 'start' : 'end';
    this.options = ARROWHEAD_TYPES.map(({ value, title }) => ({
      value, title, preview: headPreview(value, end),
    }));
  }

  override get groupWithPrevious(): boolean { return this.key === 'endHead'; }
  override get transitionGroup(): TransitionGroup { return this._transitionGroup; }
  override visibleFor(el: ShapeElement): boolean { return isPath(el); }
  override disabledFor(el: ShapeElement): boolean { return !!el.closed; }

  renderEditor({ element, update }: PropertyContext<ShapeElement>) {
    return (
      <IconSelect<ArrowheadType>
        label={this.label}
        options={this.options}
        value={element[this.key] ?? 'none'}
        onChange={(v) => update({ [this.key]: v } as Partial<ShapeElement>)}
        columns={3}
        disabled={this.disabledFor(element)}
      />
    );
  }
}

/**
 * Property list for shape elements. Each entry is the SINGLE place that
 * defines a property — label, editor type, animation hook-up, sync set,
 * visibility. PropertyRow draws the standard header (label + SlideSync +
 * TransitionIn/Out + KeyframeButtons) automatically from this metadata.
 */
class FillStyleProperty extends PreviewSelectProperty<ShapeElement, FillStyle> {
  override copyFromKeyframe(target: ShapeElement): Partial<ShapeElement> {
    // Explicit default: Yjs intentionally ignores undefined mutation values.
    return { fillStyle: target.fillStyle ?? 'solid' };
  }
  override differsFromKeyframe(target: ShapeElement, current: ShapeElement): boolean {
    return (target.fillStyle ?? 'solid') !== (current.fillStyle ?? 'solid');
  }
}

const SHAPE_PROPERTIES: Property<ShapeElement>[] = [
  new ColorProperty<ShapeElement>({ key: 'fill', label: 'Fill', transitionGroup: 'fill', alpha: true }),
  new ColorProperty<ShapeElement>({
    key: 'stroke', label: 'Stroke', transitionGroup: 'stroke', alpha: true,
  }),
  new FillStyleProperty({
    key: 'fillStyle', label: 'Fill Style', iconOnly: true, defaultValue: 'solid', columns: 3,
    options: (['solid', 'hachure', 'crosshatch'] as const).map(value => ({ value,
      label: value === 'solid' ? 'Solid' : value === 'hachure' ? 'Hachure' : 'Crosshatch',
      preview: () => <svg width={44} height={30} viewBox="0 0 44 30" aria-hidden="true">
        <RenderShape element={createShapeElement('rect', { id: `fill-preview-${value}`, x: 2, y: 2, width: 40, height: 26,
          cornerRadius: 4, fill: '#555555', fillStyle: value, stroke: '#333333', strokeWidth: 1 })} />
      </svg>,
    })),
  }),
  new NumberProperty<ShapeElement>({
    key: 'strokeWidth', label: 'Stroke Width',
    // Gentle drag (0.2/px → a full drag spans the whole 0–20 range) with
    // one-decimal commits; arrow keys still step by 1.
    transitionGroup: 'strokeWidth', min: 0, max: 20,
    step: 1, scrubStep: 0.2, precision: 1,
  }),
  new PreviewSelectProperty<ShapeElement, StrokeStyle>({
    key: 'strokeStyle', label: 'Stroke Style', iconOnly: true,
    // Lines / arrows / polylines / polygons get the dash control. Filled
    // rect / ellipse / triangle / star don't usually need it; keeping it
    // path-only avoids cluttering the rect panel.
    visibleFor: el => isPath(el) || el.shapeType === 'vector',
    defaultValue: 'solid',
    columns: 3,
    options: [
      { value: 'solid', label: 'Solid', preview: () => strokeStylePreview('solid') },
      { value: 'dashed', label: 'Dashed', preview: () => strokeStylePreview('dashed') },
      { value: 'dotted', label: 'Dotted', preview: () => strokeStylePreview('dotted') },
    ],
  }),
  new CurveProperty(),
  new NumberProperty<ShapeElement>({
    key: 'cornerRadius', label: 'Corner Radius',
    transitionGroup: 'cornerRadius', min: 0, max: 100, step: 1,
    visibleFor: supportsCornerRadius,
  }),
  new CheckboxProperty<ShapeElement>({ key: 'closed', label: 'Closed path', visibleFor: isPath }),
  // Typed arrowheads. The transition groups keep their historical
  // 'startArrow'/'endArrow' names (persisted in decks).
  new ArrowheadProperty({ key: 'startHead', label: 'Start head', transitionGroup: 'startArrow' }),
  new ArrowheadProperty({ key: 'endHead', label: 'End head', transitionGroup: 'endArrow' }),
  new ReadoutProperty<ShapeElement>({
    key: 'geometry', label: 'Vector geometry', transitionGroup: 'controlPoints',
    syncFields: ['geometry'], visibleFor: el => el.shapeType === 'vector',
    readout: el => `${el.geometry?.contours.length ?? 0} contours`,
  }),
  // Binding v2 pin toggles — one per bound end. Not grouped: grouping would
  // leave an empty grid row behind whenever neither end is bound (the
  // wrapper div renders even when every row in the bucket is invisible).
  new BindingPinProperty('start'),
  new BindingPinProperty('end'),
  new ReadoutProperty<ShapeElement>({
    key: 'points', label: 'Control points',
    transitionGroup: 'controlPoints',
    // Resets move the curve mode along with the vertices so the path
    // morphs in one piece.
    syncFields: ['points', 'curve', 'tangents', 'closed', 'x', 'y', 'width', 'height'],
    visibleFor: isPath,
    readout: (el) => String(((el.points?.length ?? 0) / 2) | 0),
  }),
];

interface Props {
  element: ShapeElement;
}

export const ShapeProperties: React.FC<Props> = ({ element }) => {
  const draft = useContext(CreationDraftContext);
  return (
  <div className="space-y-3">
    <PropertyList properties={draft ? SHAPE_PROPERTIES.filter(p => !['points', 'geometry', 'startBinding', 'endBinding'].includes(p.key)) : SHAPE_PROPERTIES} element={element} />

  </div>
);
};
