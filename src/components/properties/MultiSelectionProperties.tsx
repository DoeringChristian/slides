import { canJoinPaths } from '../../utils/paths/joinPaths';
import { Crop, Merge } from 'lucide-react';
import { IconButtonRow } from '../controls/IconButtonRow';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { groupCropBoundary } from '../../utils/model/groupCrop';
import type { SlideElement } from '../../types/presentation';
import { SelectionPropertiesContext } from './SelectionPropertiesContext';
import { PanelHeader } from './PanelHeader';
import { ShapeProperties } from './ShapeProperties';
import { TextProperties } from './TextProperties';
import { ImageProperties } from './ImageProperties';
import { ArrangePanel } from './ArrangePanel';

export function MultiSelectionProperties({ elements }: { elements: SlideElement[] }) {
  const ids = elements.map(el => el.id);
  const slideId = useEditorStore(s => s.activeSlideId);
  const joinPaths = usePresentationStore(s => s.joinPaths);
  const setCrop = usePresentationStore(s => s.setGroupCrop);
  const names = usePresentationStore(s => s.presentation.objects);
  const boundaries = elements.filter(groupCropBoundary);
  const shapes = elements.filter(el => el.type === 'shape');
  return <SelectionPropertiesContext.Provider value={ids}>
    <div className="space-y-4" data-multi-properties="">
      <PanelHeader label={`${elements.length} objects`} elementId={ids[0]} groups={['visibility']} />
      {canJoinPaths(elements) && <IconButtonRow items={[{ icon: <Merge size={14} />, label: 'Join paths',
        title: 'Join nearest ends on this slide; keep the first selected path’s style and outer arrowheads', active: false,
        onClick: () => {
          const id = joinPaths(slideId, ids);
          if (id) useEditorStore.getState().setSelectedElements([id]);
        } }]} />}
      {elements.some(el => el.type === 'image') && shapes.length > 0 && <IconButtonRow className="flex-wrap" items={[
        ...shapes.map(shape => ({ icon: <Crop size={14} />, label: shapes.length === 1 ? 'Crop to shape' : `Crop to ${names[shape.id]?.name ?? shape.shapeType}`,
          title: 'Use this shape as the group crop boundary', active: groupCropBoundary(shape),
          onClick: () => setCrop(slideId, ids, shape.id) })),
        ...(boundaries.length ? [{ icon: <Crop size={14} />, label: 'Remove crop', title: 'Remove crop and keep the group', active: false,
          onClick: () => setCrop(slideId, ids, null) }] : []),
      ]} />}
      {(['shape', 'text', 'image'] as const).map(type => {
        const members = elements.filter(el => el.type === type);
        const first = members[0];
        if (!first) return null;
        return <SelectionPropertiesContext.Provider key={type} value={members.map(el => el.id)}>
          {first.type === 'shape' && <ShapeProperties element={first} />}
          {first.type === 'text' && <TextProperties element={first} />}
          {first.type === 'image' && <ImageProperties element={first} />}
        </SelectionPropertiesContext.Provider>;
      })}
      <ArrangePanel element={elements[0]} />
    </div>
  </SelectionPropertiesContext.Provider>;
}
