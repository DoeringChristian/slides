import { canJoinPaths } from '../../utils/paths/joinPaths';
import { Merge } from 'lucide-react';
import { IconButtonRow } from '../controls/IconButtonRow';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { CropRow } from './CropRow';
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
