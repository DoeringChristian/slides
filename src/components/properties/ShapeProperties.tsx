import React from 'react';
import { PropertyList } from './PropertyList';
import {
  Property,
  ColorProperty,
  NumberProperty,
  RangeProperty,
  CheckboxProperty,
  SelectProperty,
  ReadoutProperty,
  type PropertyContext,
} from './Property';
import type { ShapeElement, ConnectorBinding, PathCurve, StrokeStyle, ArrowheadType, TransitionGroup } from '../../types/presentation';
import { bindingFor, resolveBinding, isPinnedBinding } from '../../utils/connectorUtils';
import { pathBounds, catmullTangents, arrowheadGeometry } from '../../utils/pathShapes';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { IconSelect, type IconSelectOption } from '../controls/IconSelect';
import { RenderArrowhead } from '../svg/ElementRenderer';

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
 * Checkbox that converts a connector-end binding between edge mode
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
    const point = { x: element.x + pts[idx], y: element.y + pts[idx + 1] };
    const adj = { x: element.x + pts[adjIdx], y: element.y + pts[adjIdx + 1] };
    const next: ConnectorBinding = bindingFor(point, target, adj, checked ? 'pinned' : 'edge');
    // Bake the re-solved endpoint alongside the binding so the stored
    // geometry and the binding always agree (mutation-time baking).
    const resolved = resolveBinding(next, target, adj);
    const abs = pts.map((v, i) => v + (i % 2 === 0 ? element.x : element.y));
    abs[idx] = resolved.x;
    abs[idx + 1] = resolved.y;
    const b = pathBounds(abs);
    update({
      [end === 'start' ? 'startBinding' : 'endBinding']: next,
      x: b.x, y: b.y, width: b.width, height: b.height, points: b.points,
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

/**
 * Curve-mode select. Subclassed so converting a path TO bezier also writes
 * explicit initialized tangents (Catmull-Rom estimates — the same values
 * the renderer's missing-tangent fallback would use), giving the tangent
 * handles real data to edit from the first frame. Existing tangents (e.g.
 * bezier → linear → bezier round trip) are preserved.
 */
class CurveProperty extends SelectProperty<ShapeElement, PathCurve> {
  protected override set(el: ShapeElement, v: PathCurve): Partial<ShapeElement> {
    const changes: Partial<ShapeElement> = super.set(el, v);
    if (
      v === 'bezier'
      && (el.curve ?? 'linear') !== 'bezier'
      && (el.points?.length ?? 0) >= 4
      && !el.tangents
    ) {
      changes.tangents = catmullTangents(el.points!, !!el.closed);
    }
    return changes;
  }
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

  override get transitionGroup(): TransitionGroup { return this._transitionGroup; }
  override visibleFor(el: ShapeElement): boolean { return isPath(el); }
  override disabledFor(el: ShapeElement): boolean { return !!el.closed; }

  renderEditor({ element, update }: PropertyContext<ShapeElement>) {
    return (
      <IconSelect<ArrowheadType>
        options={this.options}
        value={element[this.key] ?? 'none'}
        onChange={(v) => update({ [this.key]: v } as Partial<ShapeElement>)}
        columns={7}
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
const SHAPE_PROPERTIES: Property<ShapeElement>[] = [
  new ColorProperty<ShapeElement>({ key: 'fill', label: 'Fill', transitionGroup: 'fill' }),
  // Color swatches are narrow — pack stroke onto the same row as fill so the
  // panel doesn't burn two full rows on two small rectangles.
  new ColorProperty<ShapeElement>({
    key: 'stroke', label: 'Stroke', transitionGroup: 'stroke',
    groupWithPrevious: true,
  }),
  new NumberProperty<ShapeElement>({
    key: 'strokeWidth', label: 'Stroke Width',
    transitionGroup: 'strokeWidth', min: 0, max: 20, step: 1,
  }),
  new SelectProperty<ShapeElement, StrokeStyle>({
    key: 'strokeStyle', label: 'Stroke Style',
    // Lines / arrows / polylines / polygons get the dash control. Filled
    // rect / ellipse / triangle / star don't usually need it; keeping it
    // path-only avoids cluttering the rect panel.
    visibleFor: isPath,
    defaultValue: 'solid',
    options: [
      { value: 'solid', label: 'Solid' },
      { value: 'dashed', label: 'Dashed' },
      { value: 'dotted', label: 'Dotted' },
    ],
  }),
  new NumberProperty<ShapeElement>({
    key: 'cornerRadius', label: 'Corner Radius',
    transitionGroup: 'cornerRadius', min: 0, max: 100, step: 1,
    visibleFor: supportsCornerRadius,
  }),
  new CurveProperty({
    key: 'curve', label: 'Curve',
    // Curve mode shares the `controlPoints` transition with the vertex
    // list — interpolation samples both paths into polylines and lerps
    // them when the curves differ. One easing controls the whole morph.
    transitionGroup: 'controlPoints',
    visibleFor: isPath,
    defaultValue: 'linear',
    options: [
      { value: 'linear', label: 'Linear' },
      { value: 'bspline2', label: 'B-spline (quadratic)' },
      { value: 'bspline3', label: 'B-spline (cubic)' },
      { value: 'bezier', label: 'Bezier' },
    ],
  }),
  new CheckboxProperty<ShapeElement>({ key: 'closed', label: 'Closed path', visibleFor: isPath }),
  // Typed arrowheads. The transition groups keep their historical
  // 'startArrow'/'endArrow' names (persisted in decks).
  new ArrowheadProperty({ key: 'startHead', label: 'Start head', transitionGroup: 'startArrow' }),
  new ArrowheadProperty({ key: 'endHead', label: 'End head', transitionGroup: 'endArrow' }),
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
    syncFields: ['points', 'curve', 'closed', 'x', 'y', 'width', 'height'],
    visibleFor: isPath,
    readout: (el) => String(((el.points?.length ?? 0) / 2) | 0),
  }),
  new RangeProperty<ShapeElement>({
    key: 'opacity', label: 'Opacity',
    transitionGroup: 'opacity', min: 0, max: 100, scale: 100,
  }),
];

interface Props {
  element: ShapeElement;
}

export const ShapeProperties: React.FC<Props> = ({ element }) => (
  <div className="space-y-3">
    <PropertyList properties={SHAPE_PROPERTIES} element={element} />
  </div>
);
