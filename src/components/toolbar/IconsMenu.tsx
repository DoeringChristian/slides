import { Shapes } from 'lucide-react';
import { PreviewSelect } from '../controls/PreviewSelect';
import { RenderShape } from '../svg/ElementRenderer';
import { CURATED_ICONS } from '../../utils/curatedIcons';
import { createShapeElement } from '../../utils/slideFactory';
import { useCreationPreferences } from '../../store/creationPreferences';
import { useEditorStore } from '../../store/editorStore';

const options = CURATED_ICONS.map(icon => ({ value: icon.id, label: icon.label,
  preview: <svg width={32} height={32} viewBox="0 0 24 24" aria-hidden="true">
    <RenderShape element={createShapeElement('vector', { id: `icon-preview-${icon.id}`, x: 0, y: 0, width: 24, height: 24,
      geometry: icon.geometry, fill: '', stroke: '#374151', strokeWidth: 2 })} />
  </svg>,
}));
export function IconsMenu() {
  const iconId = useCreationPreferences(s => s.iconId);
  const tool = useEditorStore(s => s.tool);
  return <PreviewSelect label="Icons" value={iconId} options={options} searchable alwaysChoose columns={4}
    trigger={<><Shapes size={16} /><span>Icons</span></>}
    triggerClassName={`px-2 py-1.5 rounded flex items-center gap-1 text-xs ${tool === 'icon' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
    onChange={id => {
      useCreationPreferences.getState().chooseIcon(id);
      useEditorStore.getState().setTool('icon');
      useEditorStore.getState().setSelectedElements([]);
    }} footer={<p className="mt-2 text-xs text-gray-400">Lucide · ISC license · native vectors</p>} />;
}
