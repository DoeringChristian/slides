import { canJoinPaths } from '../../utils/paths/joinPaths';
import { Merge } from 'lucide-react';
import { IconButtonRow } from '../controls/IconButtonRow';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { CropRow } from './CropRow';
import { VideoTimeline } from './VideoTimeline';
import type { ImageElement, SlideElement } from '../../types/presentation';
import { SelectionPropertiesContext } from './SelectionPropertiesContext';
import { PanelHeader } from './PanelHeader';
import { ShapeProperties } from './ShapeProperties';
import { TextProperties } from './TextProperties';
import { ImageProperties } from './ImageProperties';
import { ArrangePanel } from './ArrangePanel';

export function MultiSelectionProperties({ elements }: { elements: SlideElement[] }) {
  const ids = elements.map(el => el.id);
  const resources = usePresentationStore(s => s.presentation.resources);
  const videos = elements.filter((el): el is ImageElement => el.type === 'image' && !!el.resourceId && resources[el.resourceId]?.type === 'video');
  const slideId = useEditorStore(s => s.activeSlideId);
  const joinPaths = usePresentationStore(s => s.joinPaths);
  return <SelectionPropertiesContext.Provider value={ids}>
    <div className="space-y-4" data-multi-properties="">
      <PanelHeader label={`${elements.length} objects`} elementId={ids[0]} />
      {canJoinPaths(elements) && <IconButtonRow items={[{ icon: <Merge size={14} />, label: 'Join paths',
        title: 'Join nearest ends on this slide; keep the first selected path’s style and outer arrowheads', active: false,
        onClick: () => {
          const id = joinPaths(slideId, ids);
          if (id) useEditorStore.getState().setSelectedElements([id]);
        } }]} />}
      <CropRow />
      {/* A cropped video (or any group around one video): its timeline. */}
      {videos.length === 1 && <VideoTimeline element={videos[0]} />}
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
