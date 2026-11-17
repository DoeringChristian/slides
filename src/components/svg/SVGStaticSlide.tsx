import React from 'react';
import { expandObjectGroups } from '../../utils/model/objectGroups';
import { selectionResizeBounds } from '../../utils/geometry/resizeGeometry';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { SVGBackground } from './SVGBackground';
import { MediaStillContext } from './mediaSources';
import { RenderElement } from './ElementRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { attachLabelMasks } from '../../utils/model/syncDependents';
import { getElementBounds, getElementCenter } from '../../utils/geometry/geometry';
import type { Slide, SlideElement } from '../../types/presentation';

interface Props {
  slide: Slide;
  width: number;
  height: number;
  selectedElementIds?: string[];
  showHighlights?: boolean;
}

const HighlightRect: React.FC<{ members: SlideElement[]; scale: number }> = ({ members, scale }) => {
  const element = members[0];
  const grouped = members.length > 1;
  const pad = 4 / scale;
  const bounds = grouped ? selectionResizeBounds(members) : getElementBounds(element);
  const center = getElementCenter(element);
  const transform = !grouped && element.rotation ? `rotate(${element.rotation}, ${center.x}, ${center.y})` : undefined;

  return (
    <g data-selection-highlight="" transform={transform}>
      <rect
        x={bounds.x - pad}
        y={bounds.y - pad}
        width={bounds.width + pad * 2}
        height={bounds.height + pad * 2}
        fill="rgba(59, 130, 246, 0.08)"
        stroke="#3b82f6"
        strokeWidth={3 / scale}
        strokeDasharray={`${6 / scale} ${3 / scale}`}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const StaticElement: React.FC<{
  element: SlideElement;
  slideId: string;
}> = ({ element, slideId }) => {
  const resource = usePresentationStore((s) => {
    if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
      return s.presentation.resources[element.resourceId];
    }
    return undefined;
  });

  if (!element.visible) return null;

  return (
    <>
      <RenderElement
        element={element}
        resource={resource}
        clipIdPrefix={`static-${slideId}`}
      />
    </>
  );
};

/** The slide's content: depends on the slide alone, so a selection or slide
 *  switch (which every thumbnail sees) does not redraw any thumbnail. */
const StaticContent: React.FC<{ slide: Slide }> = React.memo(({ slide }) => {
  const elements = attachLabelMasks(
    slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean),
    slide.background.type === 'solid' ? slide.background.color : '#ffffff',
  );
  return <>
    <SVGBackground background={slide.background} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} />
    {elements.map((el) => <StaticElement key={el.id} element={el} slideId={slide.id} />)}
  </>;
});

/** The selected objects' frames on this slide (elements keep their id
 *  across keyframes, so a selection shows on every keyframe it is on). */
const StaticHighlights: React.FC<{ slide: Slide; scale: number; selectedElementIds?: string[] }> = ({ slide, scale, selectedElementIds: prop }) => {
  const stored = useEditorStore((s) => s.selectedElementIds);
  const scope = useEditorStore(s => s.activeObjectGroupId);
  const selectedElementIds = prop ?? stored;
  const highlights: SlideElement[][] = [];
  const seen = new Set<string>();
  for (const id of selectedElementIds) {
    if (seen.has(id) || !slide.elements[id]?.visible) continue;
    const ids = expandObjectGroups(slide.elements, [id], scope);
    ids.forEach(member => seen.add(member));
    highlights.push(ids.map(member => slide.elements[member]).filter(el => el?.visible));
  }
  return <>{highlights.map(members => <HighlightRect key={members[0].id} members={members} scale={scale} />)}</>;
};

export const SVGStaticSlide: React.FC<Props> = React.memo(({
  slide,
  width,
  height,
  selectedElementIds,
  showHighlights = false,
}) => {
  const scale = width / SLIDE_WIDTH;
  return (
    <MediaStillContext.Provider value={true}><svg
      width={width}
      height={height}
      viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
      style={{ display: 'block' }}
    >
      <StaticContent slide={slide} />
      {showHighlights && <StaticHighlights slide={slide} scale={scale} selectedElementIds={selectedElementIds} />}
    </svg></MediaStillContext.Provider>
  );
});
