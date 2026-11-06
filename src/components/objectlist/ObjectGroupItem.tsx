import { attachGroupCrops } from '../../utils/model/groupCrop';
import { useEditorStore } from '../../store/editorStore';
import { useId } from 'react';
import { ChevronDown, ChevronRight, Group, Crop, Eye, EyeOff } from 'lucide-react';
import type { SlideElement } from '../../types/presentation';
import { usePresentationStore } from '../../store/presentationStore';
import { RenderElement } from '../svg/ElementRenderer';
import { selectionResizeBounds } from '../../utils/geometry/resizeGeometry';
import { attachLabelMasks } from '../../utils/model/syncDependents';

interface Props {
  id: string;
  elements: SlideElement[];
  memberIds: string[];
  selected: boolean;
  hovered: boolean;
  expanded: boolean;
  onExpand: () => void;
  onToggleVisibility: () => void;
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onEnter: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}
export function ObjectGroupItem({ id, elements, memberIds, selected, hovered, expanded, onExpand, onToggleVisibility, onSelect, onEnter, onHover, onHoverEnd }: Props) {
  const resources = usePresentationStore(s => s.presentation.resources);
  const prefix = useId();
  const bounds = selectionResizeBounds(elements);
  const pad = Math.max(bounds.width, bounds.height) * .08 + 1;
  const visible = elements.some(el => el.visible);
  const cropped = elements.some(el => el.type === 'shape' && el.cropGroupId === id);
  const GroupIcon = cropped ? Crop : Group;
  const preview = attachGroupCrops(attachLabelMasks(elements.map(el => ({ ...el, visible: true })), '#f9fafb'));
  return <div role="option" aria-selected={selected} aria-label={`Group (${memberIds.length} objects)`}
    data-object-group-id={id} data-member-ids={JSON.stringify(memberIds)} tabIndex={0}
    className={`rounded-md border overflow-hidden cursor-pointer ${selected ? 'border-blue-500 bg-blue-50' : hovered ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white'} ${visible ? '' : 'opacity-50'}`}
    onClick={onSelect} onDoubleClick={onEnter} onMouseEnter={onHover} onMouseLeave={onHoverEnd}
    onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onSelect(e); } if ((e.key === 'ArrowRight' && !expanded) || (e.key === 'ArrowLeft' && expanded)) { e.preventDefault(); e.stopPropagation(); onExpand(); } }}
    draggable onDragStart={e => { e.dataTransfer.setData('application/x-object-group-id', id); e.dataTransfer.setData('application/x-object-slide', useEditorStore.getState().activeSlideId); e.dataTransfer.setData('application/x-object-ids', JSON.stringify(memberIds)); e.dataTransfer.setData('application/x-object-id', memberIds[0]); e.dataTransfer.effectAllowed = 'move'; }}>
    <div className="relative aspect-square bg-gray-50 pointer-events-none">
      <svg width="100%" height="100%" viewBox={`${bounds.x-pad} ${bounds.y-pad} ${Math.max(1,bounds.width+2*pad)} ${Math.max(1,bounds.height+2*pad)}`} preserveAspectRatio="xMidYMid meet">
        {preview.map(el => <RenderElement key={el.id} element={el} resource={el.type === 'image' && el.resourceId ? resources[el.resourceId] : undefined} clipIdPrefix={`group-preview-${prefix}`} />)}
      </svg>
    </div>
    <div className="flex items-center gap-1 px-1 py-1 text-xs">
      <button aria-label={expanded ? 'Collapse group' : 'Expand group'} aria-expanded={expanded} className="p-1 rounded hover:bg-gray-100"
        onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onExpand(); }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
      <button title={visible ? 'Hide group on this slide' : 'Show group on this slide'} className="p-1 rounded hover:bg-gray-100" onDoubleClick={e => e.stopPropagation()}
        onClick={e => {e.stopPropagation(); onToggleVisibility();}}>{visible ? <Eye size={12}/> : <EyeOff size={12}/>}</button>
      <GroupIcon size={12} /><span>{cropped ? 'Crop group' : 'Group'} ({memberIds.length})</span>
    </div>
  </div>;
}
