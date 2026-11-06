import { objectListElements } from '../../utils/model/groupTransfer';
import { objectListTree, flattenObjectList, type ObjectListNode } from '../../utils/model/objectListTree';
import { ObjectGroupItem } from './ObjectGroupItem';
import { expandObjectGroups, planObjectGrouping } from '../../utils/model/objectGroups';
import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Layers, Group, Ungroup } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useAllObjects, useActiveSlide, useObjectElements } from '../../store/selectors';
import { ObjectListItem } from './ObjectListItem';
import { selectObjectRange } from '../../utils/model/objectSelection';

export const ObjectListDrawer: React.FC = () => {
  const activeGroup = useEditorStore(s => s.activeObjectGroupId);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const objectDrawerOpen = useEditorStore((s) => s.objectDrawerOpen);
  const setObjectDrawerOpen = useEditorStore((s) => s.setObjectDrawerOpen);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const previousGroup = useRef(activeGroup);
  useEffect(() => {
    if (previousGroup.current && !activeGroup && selectedElementIds.length === 0) setExpandedGroups(new Set());
    previousGroup.current = activeGroup;
  }, [activeGroup, selectedElementIds]);
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const setHoveredObjectId = useEditorStore((s) => s.setHoveredObjectId);
  const renameObject = usePresentationStore((s) => s.renameObject);
  const hideElement = usePresentationStore((s) => s.hideElement);
  const unhideElement = usePresentationStore((s) => s.unhideElement);
  const removeObject = usePresentationStore((s) => s.removeObject);
  const groupObjects = usePresentationStore((s) => s.groupObjects);
  const ungroupObjects = usePresentationStore((s) => s.ungroupObjects);
  const mergeObjects = usePresentationStore((s) => s.mergeObjects);

  const presentation = usePresentationStore(s => s.presentation);
  const listElements = useMemo(() => objectListElements(presentation.slides, presentation.slideOrder, activeSlideId), [presentation, activeSlideId]);
  const objects = useAllObjects();
  const slide = useActiveSlide();
  const objectElements = useObjectElements();
  const selectionAnchor = useRef<{ slideId: string; id: string } | null>(null);

  // Bound-text labels don't get their own rows — their container's row shows
  // a small label badge instead (the label's lifecycle is chained to the
  // container everywhere else, so a standalone row would only confuse).
  const { boundLabelIds, labelledContainerIds } = useMemo(() => {
    const labels = new Set<string>();
    const containers = new Set<string>();
    for (const [id, el] of Object.entries(objectElements)) {
      if (el?.type === 'text' && el.containerId) {
        labels.add(id);
        containers.add(el.containerId);
      }
    }
    return { boundLabelIds: labels, labelledContainerIds: containers };
  }, [objectElements]);

  const listedObjects = useMemo(
    () => objects.filter((obj) => !boundLabelIds.has(obj.id)),
    [objects, boundLabelIds],
  );

  const sortedObjects = useMemo(() => {
    if (!slide) return listedObjects;
    return [...listedObjects].sort((a, b) => {
      const aVisible = !!(slide.elements[a.id]?.visible);
      const bVisible = !!(slide.elements[b.id]?.visible);
      if (aVisible === bVisible) return 0;
      return aVisible ? -1 : 1;
    });
  }, [listedObjects, slide]);

  const tree = useMemo(() => objectListTree(sortedObjects, listElements), [sortedObjects, listElements]);
  const expanded = new Set(expandedGroups);
  // Entering a group on the canvas reveals the matching branch here too.
  if (activeGroup) for (const el of Object.values(slide?.elements ?? {})) {
    const path = el.objectGroupIds ?? [];
    const index = path.indexOf(activeGroup);
    if (index >= 0) path.slice(0, index + 1).forEach(id => expanded.add(id));
  }
  const rows = flattenObjectList(tree, expanded);
  const selectRow = (memberIds: string[], event: React.MouseEvent | React.KeyboardEvent) => {
    const visible = expandObjectGroups(slide?.elements ?? {}, memberIds, activeGroup).filter(id => slide?.elements[id]?.visible);
    if (!visible.length) return;
    const order = rows.flatMap(({ node }) => node.kind === 'group' ? node.memberIds : [node.id]).filter((id, index, all) => slide?.elements[id]?.visible && all.indexOf(id) === index);
    const id = visible[0];
    const anchor = selectionAnchor.current?.slideId === activeSlideId ? selectionAnchor.current.id : null;
    const current = useEditorStore.getState().selectedElementIds;
    if (!event.shiftKey && (event.ctrlKey || event.metaKey)) {
      const next = visible.every(id => current.includes(id)) ? current.filter(id => !visible.includes(id)) : [...new Set([...current, ...visible])];
      setSelectedElements(next);
    } else setSelectedElements(event.shiftKey ? selectObjectRange(order, current, id, anchor, event) : visible);
    if (!event.shiftKey || !anchor || !order.includes(anchor)) selectionAnchor.current = { slideId: activeSlideId, id };
  };

  const handleToggleVisibility = useCallback(
    (objectId: string, isCurrentlyVisible: boolean) => {
      if (isCurrentlyVisible) {
        hideElement(activeSlideId, objectId);
        // Deselect the element when hiding it
        if (selectedElementIds.includes(objectId)) {
          setSelectedElements(selectedElementIds.filter((id) => id !== objectId));
        }
      } else {
        unhideElement(activeSlideId, objectId);
      }
    },
    [activeSlideId, hideElement, unhideElement, selectedElementIds, setSelectedElements],
  );

  // Transient notice for target-wins conflict resolution during a merge.
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  // Merge SOURCE (the row the picker was opened from) INTO the picked TARGET.
  const handleMergeInto = useCallback(
    (sourceId: string, targetId: string) => {
      const target = objects.find((o) => o.id === targetId);
      const result = mergeObjects(targetId, sourceId);
      if (!result.merged) return;
      // The two objects are one identity now — select the survivor.
      setSelectedElements([targetId]);
      if (result.droppedOnSlides.length > 0) {
        const n = result.droppedOnSlides.length;
        setMergeNotice(
          `Kept “${target?.name ?? 'target'}” on ${n} conflicting slide${n === 1 ? '' : 's'}`,
        );
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setMergeNotice(null), 5000);
      }
    },
    [mergeObjects, objects, setSelectedElements],
  );

  const handleDelete = useCallback(
    (objectId: string) => {
      // Deselect the element before removing
      if (selectedElementIds.includes(objectId)) {
        setSelectedElements(selectedElementIds.filter((id) => id !== objectId));
      }
      removeObject(objectId);
    },
    [removeObject, selectedElementIds, setSelectedElements],
  );

  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropProps = (target: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('application/x-object-ids')) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(target ?? '__loose');
    },
    onDragLeave: (event: React.DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault(); event.stopPropagation(); setDropTarget(null);
      const origin = event.dataTransfer.getData('application/x-object-slide');
      if (origin && origin !== activeSlideId) return;
      try {
        const ids: unknown = JSON.parse(event.dataTransfer.getData('application/x-object-ids'));
        if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return;
        const sourceGroup = event.dataTransfer.getData('application/x-object-group-id') || undefined;
        usePresentationStore.getState().moveObjectsToGroup(activeSlideId, ids, target, sourceGroup);
        if (target) setExpandedGroups(previous => new Set([...previous, target]));
        setSelectedElements(ids);
      } catch { /* unrelated or malformed external drag */ }
    },
  });

  const toggleExpanded = (node: Extract<ObjectListNode, { kind: 'group' }>) => {
    if (expanded.has(node.id)) {
      const path = slide?.elements[node.memberIds[0]]?.objectGroupIds ?? [];
      while (useEditorStore.getState().activeObjectGroupId && path.indexOf(useEditorStore.getState().activeObjectGroupId!) >= path.indexOf(node.id)) {
        useEditorStore.getState().exitObjectGroup();
      }
    }
    setExpandedGroups(previous => { const next = new Set(previous); if (expanded.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
  };
  const renderNode = (node: ObjectListNode, depth = 0): React.ReactNode => {

                if (node.kind === 'group') {
                  const members = new Set(node.memberIds);
                  const preview = Object.values(listElements).filter(el => members.has(el.id) || (el.type === 'text' && !!el.containerId && members.has(el.containerId)));
                  const representative = node.memberIds.find(id => slide?.elements[id]?.visible) ?? node.memberIds[0];
                  return <div key={`group:${node.id}`} className={expanded.has(node.id) ? 'col-span-full rounded-lg border-2 border-blue-200 bg-blue-50/40 p-2' : ''} data-object-depth={depth} data-group-container={node.id} {...dropProps(node.id)} style={dropTarget === node.id ? { outline: '2px solid #3b82f6' } : undefined}>
                    <div className={expanded.has(node.id) ? 'w-28' : ''}><ObjectGroupItem id={node.id} elements={preview} memberIds={node.memberIds}
                      selected={node.memberIds.every(id => selectedElementIds.includes(id))} hovered={!!hoveredObjectId && members.has(hoveredObjectId)}
                      onToggleVisibility={() => {
                        if (preview.some(el => el.visible)) usePresentationStore.getState().hideElements(activeSlideId, node.memberIds);
                        else unhideElement(activeSlideId, representative);
                      }}
                      expanded={expanded.has(node.id)} onExpand={() => toggleExpanded(node)}
                      onSelect={event => selectRow(node.memberIds, event)}
                      onEnter={() => useEditorStore.getState().enterObjectGroup(representative, node.id)}
                      onHover={() => setHoveredObjectId(representative, 'object-list')} onHoverEnd={() => setHoveredObjectId(null)} /></div>
                    {expanded.has(node.id) && <div role="group" aria-label="Group members" data-group-members={node.id} className="ml-3 mt-2 border-l-2 border-blue-300 pl-3">
                      <div className="mb-1 text-xs font-medium text-blue-700">Members of this group</div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2">{node.children.map(child => renderNode(child, depth + 1))}</div>
                    </div>}
                  </div>;
                }
                const obj = node.object;
                const isVisibleOnSlide = !!(slide?.elements[obj.id]?.visible);
                const isSelected = selectedElementIds.includes(obj.id);
                const isHovered = hoveredObjectId === obj.id;
                return (
                  <ObjectListItem
                    key={obj.id}
                    object={obj}
                    element={slide?.elements[obj.id] ?? objectElements[obj.id]}
                    hasBoundLabel={labelledContainerIds.has(obj.id)}
                    isVisibleOnSlide={isVisibleOnSlide}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    mergeCandidates={listedObjects.filter((o) => o.id !== obj.id)}
                    onMergeInto={(targetId) => handleMergeInto(obj.id, targetId)}
                    onSelect={event => selectRow([obj.id], event)}
                    onRename={(name) => renameObject(obj.id, name)}
                    onToggleVisibility={() => handleToggleVisibility(obj.id, isVisibleOnSlide)}
                    onDelete={() => handleDelete(obj.id)}
                    onHover={() => setHoveredObjectId(obj.id, 'object-list')}
                    onHoverEnd={() => setHoveredObjectId(null)}
                  />
                );
  };

  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      {/* Header bar */}
      <button
        onClick={() => setObjectDrawerOpen(!objectDrawerOpen)}
        className="w-full flex items-center gap-2 px-3 h-7 text-xs font-medium text-gray-500 uppercase hover:bg-gray-50"
      >
        <Layers size={12} />
        <span>Objects ({listedObjects.length})</span>
        <span className="ml-auto">
          {objectDrawerOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>

      {objectDrawerOpen && selectedElementIds.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs text-gray-600 border-t border-gray-100">
          <span>{selectedElementIds.length} selected</span>
          <button title="Group objects (Ctrl/Cmd+G)" aria-label="Group objects"
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40"
            disabled={!planObjectGrouping(slide?.elements ?? {}, selectedElementIds, 'group', () => 'preview', useEditorStore.getState().activeObjectGroupId).size}
            onClick={() => groupObjects(activeSlideId, selectedElementIds)}><Group size={14} />Group</button>
          <button title="Ungroup objects (Ctrl/Cmd+Shift+G)" aria-label="Ungroup objects"
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40"
            disabled={!selectedElementIds.some(id => slide?.elements[id]?.objectGroupIds?.length)}
            onClick={() => ungroupObjects(activeSlideId, selectedElementIds)}><Ungroup size={14} />Ungroup</button>
        </div>
      )}

      {/* Transient merge-conflict notice */}
      {mergeNotice && (
        <div className="px-3 py-1 text-xs text-amber-700 bg-amber-50 border-t border-amber-200">
          {mergeNotice}
        </div>
      )}

      {/* Collapsible content */}
      {objectDrawerOpen && (
        <div className="max-h-[220px] overflow-y-auto border-t border-gray-100">
          <div data-ungrouped-drop="" {...dropProps(null)} className={`m-2 rounded border border-dashed px-3 py-2 text-xs ${dropTarget === '__loose' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 text-gray-500'}`}>
            Drop here to remove from a group. Drop onto a group to move objects or merge groups.
          </div>
          {listedObjects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No objects yet</div>
          ) : (
            <div role="listbox" aria-label="Objects" aria-multiselectable="true" className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2 p-2">
              {tree.map(node => renderNode(node))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
