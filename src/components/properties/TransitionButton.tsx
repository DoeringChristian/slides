import React from 'react';
import { PreviewSelect } from '../controls/PreviewSelect';
import {
  ChevronLeft, ChevronRight, Minus, TrendingUp, Spline, Layers,
  Type, ArrowRightLeft, PenLine, Pencil, MoveHorizontal,
  ArrowRightFromLine, Maximize, Circle, Sparkles, MoveRight,
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type {
  EasingType,
  PropertyTransitions,
  SlideElement,
  TransitionGroup,
  TransitionOptions,
} from '../../types/presentation';
import { TransitionPreview } from './TransitionPreview';
import { isVisibilityFadeOut, optionsKeyFor } from './transitionSide';
import { defaultVisibilityEasing } from '../../utils/interpolation';
import { DEFAULT_TYPES, RESOURCE_TYPES, CONTENT_TYPES, MORPH_TYPES, visibilityTypesFor } from '../../utils/easingCatalog';
import { EASING_LABELS, easingHasOptions, transitionPropertiesDiffer } from '../../utils/transitionProperties';

interface Props {
  elementId: string;
  group: TransitionGroup;
  direction: 'in' | 'out';
}

const ICON_SIZE = 14;

const EASING_ICONS: Record<EasingType, React.ReactNode> = {
  const: <Minus size={ICON_SIZE} />,
  linear: <TrendingUp size={ICON_SIZE} />,
  ease: <Spline size={ICON_SIZE} />,
  dissolve: <Layers size={ICON_SIZE} />,
  fadeinout: <ArrowRightLeft size={ICON_SIZE} />,
  typewriter: <Type size={ICON_SIZE} />,
  write: <PenLine size={ICON_SIZE} />,
  create: <Pencil size={ICON_SIZE} />,
  extend: <MoveRight size={ICON_SIZE} />,
  wipe: <MoveHorizontal size={ICON_SIZE} />,
  slidein: <ArrowRightFromLine size={ICON_SIZE} />,
  grow: <Maximize size={ICON_SIZE} />,
  iris: <Circle size={ICON_SIZE} />,
  fadebyglyph: <Sparkles size={ICON_SIZE} />,
};

export const TransitionButton: React.FC<Props> = ({
  elementId,
  group,
  direction,
}) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const updateElement = usePresentationStore((s) => s.updateElement);
  // Read this hook unconditionally — it MUST be above the `if (!canEdit)
  // early return below, or the hook count varies between renders and React
  // aborts mid-reconcile. That abort leaves fibers half-attached and shows
  // up downstream as a `removeChild NotFoundError`. `canEdit` flips
  // transiently while the multi-slide mirror runs (mirror updates the
  // sibling slide first, so `propertiesDiffer` returns true for one render,
  // then false the next).
  const rememberEasing = useEditorStore((s) => s.rememberEasing);

  const currentSlideIndex = slideOrder.indexOf(activeSlideId);
  const sourceSlideIndex = direction === 'in' ? currentSlideIndex - 1 : currentSlideIndex;
  const targetSlideIndex = direction === 'in' ? currentSlideIndex : currentSlideIndex + 1;
  const sourceSlideId = slideOrder[sourceSlideIndex];
  const targetSlideId = slideOrder[targetSlideIndex];
  const sourceSlide = sourceSlideId ? slides[sourceSlideId] : undefined;
  const targetSlide = targetSlideId ? slides[targetSlideId] : undefined;
  const sourceElement = sourceSlide?.elements[elementId];

  const targetElement = targetSlide?.elements[elementId];

  // Visibility options depend on the element type (shapes get Create, text
  // gets glyph effects, etc.). The element exists on at least one side of
  // the transition.
  const elementType = (sourceElement ?? targetElement)?.type;
  const types =
    group === 'content' ? CONTENT_TYPES :
    group === 'resource' ? RESOURCE_TYPES :
    group === 'visibility' ? visibilityTypesFor(elementType) :
    group === 'morph' ? MORPH_TYPES :
    DEFAULT_TYPES;

  const differs = transitionPropertiesDiffer(sourceElement, targetElement, group);

  // Where the transition lives: target by default, source for fade-out
  // visibility changes (because target doesn't exist).
  const isFadeOut = isVisibilityFadeOut(sourceElement, targetElement, group);
  const transitionElement = isFadeOut ? sourceElement : targetElement;
  const transitionSlideId = isFadeOut ? sourceSlideId : targetSlideId;

  const defaultEasing: EasingType =
    group === 'resource' ? 'dissolve' :
    group === 'content' ? 'const' :
    // Unset morph = the historical hard cut, which 'const' reproduces.
    group === 'morph' ? 'const' :
    group === 'visibility' ? defaultVisibilityEasing(transitionElement) :
    'linear';
  const currentEasing: EasingType = transitionElement?.transitions?.[group] || defaultEasing;
  const optKey = optionsKeyFor(group);
  const currentOptions: TransitionOptions | undefined = optKey
    ? transitionElement?.transitions?.[optKey]
    : undefined;

  const canEdit = !!transitionElement && differs;

  if (!canEdit) return null;

  const writeNewTransitions = (mutate: (t: PropertyTransitions) => void) => {
    const next: PropertyTransitions = { ...(transitionElement!.transitions || {}) };
    mutate(next);
    updateElement(transitionSlideId!, elementId, { transitions: next } as Partial<SlideElement>);
  };

  const handleSelect = (easing: EasingType) => {
    writeNewTransitions((t) => { t[group] = easing; });
    if (elementType) rememberEasing(elementType, group, easing, currentOptions);
  };

  const handleOptionChange = (nextOptions: TransitionOptions) => {
    if (!optKey) return;
    writeNewTransitions((t) => { t[optKey] = nextOptions; });
    if (elementType) rememberEasing(elementType, group, currentEasing, nextOptions);
  };

  return (
    <PreviewSelect<EasingType>
      label={`${direction === 'in' ? 'Incoming' : 'Outgoing'} transition`}
      value={currentEasing}
      onChange={handleSelect}
      closeOnSelect={false}
      previewHeight={80}
      trigger={<>
        {direction === 'in' ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        {EASING_ICONS[currentEasing]}
      </>}
      triggerClassName="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
      options={types.map((easing) => ({
        value: easing,
        label: EASING_LABELS[easing],
        preview: <TransitionPreview
          sourceElement={sourceElement}
          targetElement={targetElement}
          group={group}
          easing={easing}
          options={easing === currentEasing ? currentOptions : undefined}
          width={120}
          height={80}
          active
        />,
      }))}
      footer={easingHasOptions(group, currentEasing) ? (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs font-medium text-gray-500 mb-2 px-1">
            {EASING_LABELS[currentEasing]} options
          </div>
          <EasingOptionsPanel value={currentOptions ?? {}} onChange={handleOptionChange} easing={currentEasing} />
        </div>
      ) : undefined}
    />
  );
};

/** Per-easing settings panel. Dispatches on the currently-selected easing
 *  and renders the right sub-panel. */
const EasingOptionsPanel: React.FC<{
  value: TransitionOptions;
  onChange: (next: TransitionOptions) => void;
  easing: EasingType;
}> = ({ value, onChange, easing }) => {
  if (easing === 'write' || easing === 'typewriter') {
    const sub = value[easing] ?? {};
    const undoFirstDefault = easing === 'typewriter';
    const undoFirst = sub.undoFirst ?? undoFirstDefault;
    return (
      <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer px-1">
        <input
          type="checkbox"
          checked={undoFirst}
          onChange={(e) => onChange({ ...value, [easing]: { ...sub, undoFirst: e.target.checked } })}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Undo source before revealing target</span>
          <br />
          <span className="text-gray-500">
            First half un-reveals the source text, second half reveals the target.
            Off: source vanishes instantly and the full duration is spent
            revealing the target.
          </span>
        </span>
      </label>
    );
  }

  if (easing === 'wipe' || easing === 'slidein') {
    const sub = value[easing] ?? {};
    const from = sub.from ?? 'left';
    const setFrom = (next: 'left' | 'right' | 'top' | 'bottom') =>
      onChange({ ...value, [easing]: { ...sub, from: next } });
    return (
      <div className="text-xs text-gray-700 px-1 space-y-2">
        <div className="font-medium">From</div>
        <div className="grid grid-cols-4 gap-1">
          {(['left', 'right', 'top', 'bottom'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setFrom(d)}
              className={`py-1 rounded border text-xs ${
                from === d ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-200 hover:border-gray-400 text-gray-600'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (easing === 'create') {
    const sub = value.create ?? {};
    const tipDraw = sub.tipDraw ?? false;
    return (
      <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer px-1">
        <input
          type="checkbox"
          checked={tipDraw}
          onChange={(e) => onChange({ ...value, create: { ...sub, tipDraw: e.target.checked } })}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Arrowhead rides the tip</span>
          <br />
          <span className="text-gray-500">
            For paths with an end arrow: the arrowhead moves along with the
            growing tip of the line instead of materialising last. Off:
            the shaft draws first, then the arrowhead appears.
          </span>
        </span>
      </label>
    );
  }

  if (easing === 'grow') {
    const sub = value.grow ?? {};
    const anchor = sub.anchor ?? 'center';
    const setAnchor = (next: typeof anchor) =>
      onChange({ ...value, grow: { ...sub, anchor: next } });
    const cells: Array<typeof anchor> = [
      'top-left', 'top', 'top-right',
      'left', 'center', 'right',
      'bottom-left', 'bottom', 'bottom-right',
    ];
    return (
      <div className="text-xs text-gray-700 px-1 space-y-2">
        <div className="font-medium">Anchor</div>
        <div className="grid grid-cols-3 gap-1 w-32">
          {cells.map((c) => (
            <button
              key={c}
              onClick={() => setAnchor(c)}
              className={`aspect-square rounded border ${
                anchor === c ? 'bg-blue-500 border-blue-700' : 'bg-white border-gray-300 hover:border-gray-500'
              }`}
              title={c}
            />
          ))}
        </div>
        <div className="text-gray-500">Element grows from this point.</div>
      </div>
    );
  }

  return null;
};
