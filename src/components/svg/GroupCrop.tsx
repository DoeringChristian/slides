import { useId, type ReactNode } from 'react';
import type { SlideElement } from '../../types/presentation';
import { groupCropRegions, type GroupCropElement } from '../../utils/model/groupCrop';

/** Nest clips to intersect nested crop groups; all coordinates stay in slide
 * space, so image and boundary can move/rotate independently inside a group. */
export function GroupCrop({ element, children }: { element: SlideElement; children: ReactNode }) {
  const prefix = useId().replace(/:/g, '');
  const clips = (element as GroupCropElement)._groupClips ?? [];
  return clips.reduce<ReactNode>((content, shape, i) => {
    const id = `group-crop-${prefix}-${i}`;
    return <g key={id} data-group-crop={shape.cropGroupId}>
      <defs><clipPath id={id} clipPathUnits="userSpaceOnUse">
        {groupCropRegions(shape).map((region, j) => <path key={j} d={region.d} transform={region.transform} clipRule={region.rule} />)}
      </clipPath></defs>
      <g clipPath={`url(#${id})`}>{content}</g>
    </g>;
  }, children);
}
