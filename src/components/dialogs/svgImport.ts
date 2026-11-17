import { create } from 'zustand';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { loadImageFile } from '../../utils/model/slideFactory';

/**
 * Inserting an SVG asks how: as editable shapes (every path, shape and text
 * becomes an object you can restyle and animate, grouped like the SVG) or as
 * one image, as before. The dialog is SvgImportDialog.
 */

interface PendingSvg {
  file: File;
  slideId: string;
  /** Where to centre it (a drop point); default the slide's centre. */
  center?: [number, number];
}

export const useSvgImport = create<{ pending: PendingSvg | null; ask: (p: PendingSvg) => void; close: () => void }>((set) => ({
  pending: null,
  ask: (pending) => set({ pending }),
  close: () => set({ pending: null }),
}));

export const isSvgFile = (file: File) => file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

export async function insertAsImage({ file, slideId, center }: PendingSvg) {
  const store = usePresentationStore.getState();
  const { resource, element, isExisting } = await loadImageFile(file, undefined, store.presentation.resources);
  if (!isExisting) store.addResource(resource);
  const placed = center ? { ...element, x: center[0] - element.width / 2, y: center[1] - element.height / 2 } : element;
  store.addElement(slideId, placed);
  useEditorStore.getState().setSelectedElements([placed.id]);
}

export async function insertAsShapes({ file, slideId, center }: PendingSvg): Promise<string[]> {
  // Loaded on demand: the importer is only needed when someone uses it.
  const { importSvg } = await import('../../utils/io/importSvg');
  const store = usePresentationStore.getState();
  const result = await importSvg(await file.text(), { center, existing: store.presentation.resources });
  for (const resource of result.resources) store.addResource(resource);
  store.addElements(slideId, result.elements);
  useEditorStore.getState().setSelectedElements(result.elements.map(el => el.id));
  return result.warnings;
}

