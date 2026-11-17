import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { RenderImage } from './ElementRenderer';
import { CONTROL_THEME } from './controlTheme';
import { useCropLayouts } from './useCropLayouts';
import { groupCropBoundary, groupCropRegions, type CropShape } from '../../utils/model/groupCrop';
import type { ImageElement, SlideElement } from '../../types/presentation';

/** Crop mode's view of the image being cropped: the whole picture, greyed
 *  and faint, under the normal (cropped) rendering — so what is cut away
 *  stays visible as context and the cropped-in area reads at full strength.
 *  Drawn by the shared RenderImage on an element without its crop. */
export const CropGhost: React.FC<{ element: ImageElement }> = ({ element }) => {
  const resource = usePresentationStore(s => element.resourceId ? s.presentation.resources[element.resourceId] : undefined);
  return <g data-crop-ghost="" opacity={0.35} style={{ filter: 'grayscale(1)', pointerEvents: 'none' }}>
    <RenderImage element={{ ...element, _groupClips: undefined } as ImageElement} resource={resource} videoAutoplay={false} />
  </g>;
};

/** Dashed outlines of the crop shapes, which are otherwise invisible. */
export const CropOutlines: React.FC<{ elements: SlideElement[]; group: string | undefined; zoom: number }> = ({ elements, group, zoom }) => {
  const shapes = elements.filter((el): el is CropShape => el.visible && groupCropBoundary(el) && el.cropGroupId === group);
  useCropLayouts(shapes.some(shape => shape.type === 'text'));
  if (!group) return null;
  return <g data-crop-outlines="" style={{ pointerEvents: 'none' }}>
    {shapes.flatMap(shape => groupCropRegions(shape).map((region, i) =>
      <path key={`${shape.id}-${i}`} d={region.d} transform={region.transform} fill="none"
        stroke={CONTROL_THEME.color} strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />))}
  </g>;
};

/** Crop mode's spotlight: everything outside the image's box is darkened
 *  and its box is outlined, so the mode reads at a glance — even before any
 *  crop shape exists, or when the crop shows the whole picture. */
export const CropSpotlight: React.FC<{ image: SlideElement; zoom: number }> = ({ image, zoom }) => {
  const { x, y, width: w, height: h } = image;
  const cx = x + w / 2, cy = y + h / 2, r = (image.rotation || 0) * Math.PI / 180;
  const corner = (px: number, py: number) => {
    const dx = px - cx, dy = py - cy;
    return `${cx + dx * Math.cos(r) - dy * Math.sin(r)},${cy + dx * Math.sin(r) + dy * Math.cos(r)}`;
  };
  const box = `M ${corner(x, y)} L ${corner(x + w, y)} L ${corner(x + w, y + h)} L ${corner(x, y + h)} Z`;
  const far = 100000;
  return <g data-crop-spotlight="" style={{ pointerEvents: 'none' }}>
    <path d={`M ${-far},${-far} H ${far} V ${far} H ${-far} Z ${box}`} fillRule="evenodd" fill="rgba(15, 23, 42, 0.5)" />
    <path d={box} fill="none" stroke="#ffffff" strokeWidth={3 / zoom} />
    <path d={box} fill="none" stroke={CONTROL_THEME.color} strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
  </g>;
};
