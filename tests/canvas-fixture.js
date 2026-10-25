import { Toolbar } from '/src/components/toolbar/Toolbar.tsx';
import { MobileToolPalette } from '/src/components/toolbar/MobileToolPalette.tsx';
import { PropertiesPanel } from '/src/components/properties/PropertiesPanel.tsx';
import { useCreationPreferences } from '/src/store/creationPreferences.ts';
// Browser-only regression fixture: actual React controls, stores and pointer hooks.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { drawShapeElement } from '/src/utils/exportPdf.ts';
import { renderSlideToSVG } from '/src/utils/svgRenderer.ts';
import { createRoot } from 'react-dom/client';
import '/src/index.css';
import { usePresentationStore as store } from '/src/store/presentationStore.ts';
import { useEditorStore as editor } from '/src/store/editorStore.ts';
import { createPresentation, createShapeElement, createTextElement } from '/src/utils/slideFactory.ts';
import { SVGSlideCanvas } from '/src/components/svg/SVGSlideCanvas.tsx';
import { SVGShapeNode } from '/src/components/svg/SVGShapeNode.tsx';
import { SVGPathHandles } from '/src/components/svg/SVGPathHandles.tsx';
import { SVGCornerRadiusHandle } from '/src/components/svg/SVGCornerRadiusHandle.tsx';
import { SVGSelectionTransformer } from '/src/components/svg/SVGSelectionTransformer.tsx';
import { SVGDrawingPreview, SVGPolyDraftPreview } from '/src/components/svg/SVGDrawingPreview.tsx';
import { SVGAlignmentGuides } from '/src/components/svg/SVGAlignmentGuides.tsx';
import { ShapeProperties } from '/src/components/properties/ShapeProperties.tsx';
import { TextFormatBar } from '/src/components/toolbar/TextFormatBar.tsx';
import { TextProperties } from '/src/components/properties/TextProperties.tsx';
import { ArrangePanel } from '/src/components/properties/ArrangePanel.tsx';
import { useSVGDrawing } from '/src/components/svg/useSVGDrawing.ts';
import { useSVGDrag } from '/src/components/svg/useSVGDrag.ts';
import { useKeyboardShortcuts } from '/src/hooks/useKeyboardShortcuts.ts';
import { RenderShape } from '/src/components/svg/ElementRenderer.tsx';
import { renderPresenterElement } from '/src/components/presenter/presenterUtils.tsx';

import { SlidePanel } from '/src/components/sidebar/SlidePanel.tsx';
import { ObjectListDrawer } from '/src/components/objectlist/ObjectListDrawer.tsx';
import { createUndoManagerFor, setActiveUndoManager, getActiveUndoManager } from '/src/collab/activeUndo.ts';
import { setActiveDoc } from '/src/collab/yDocAdapter.ts';
import { jsonToYDoc } from '/src/collab/ySchema.ts';
import { useYToStoreSync } from '/src/collab/yToStoreSync.ts';
import { pathArrowGeometry } from '/src/utils/pathShapes.ts';
import { interpolateElement } from '/src/utils/interpolation.ts';
import { pathPointsInSlide, pathExtensionUpdate } from '/src/utils/pathEditing.ts';

const h = React.createElement;
let root;
let config;
let sid;
let doc;
function ProductionFixture() {
  useKeyboardShortcuts();
  useYToStoreSync(doc);
  return h(React.Fragment, null,
    h('div', { className: 'canvas-scroll-parent', style: { width: 1100, height: 850, overflow: 'auto' } }, h(SVGSlideCanvas)),
    config.creationProperties && h('div', { id: 'creation-properties', style: { position: 'absolute', left: 1120, top: 0, width: 260, height: 950, overflow: 'auto' } }, h(PropertiesPanel)));

}
function Fixture() {
  useKeyboardShortcuts();
  useYToStoreSync(doc);
  const presentation = store(s => s.presentation);
  const tool = editor(s => s.tool);
  const selected = editor(s => s.selectedElementIds);
  const slide = presentation.slides[editor.getState().activeSlideId];
  const el = slide.elements.subject;
  const zoom = editor(s => s.zoom);
  const svgRef = React.useRef(null);
  const [guides, setGuides] = React.useState([]);
  const [preview, setPreview] = React.useState(null);
  const drawing = useSVGDrawing();
  React.useEffect(() => { window.canvasTest.drawing = drawing; });
  const update = changes => store.getState().updateElement(editor.getState().activeSlideId, 'subject', changes);
  const drag = useSVGDrag({ zoom, onDragEnd: (id, x, y) => store.getState().updateElement(sid, id, { x, y }) });
  if (config.mode === 'properties') return h('div', { style: { width: 232, margin: 10 }, id: 'properties' },
    el.type === 'text' ? h(TextProperties, { element: el }) : h(ShapeProperties, { element: el }), h(ArrangePanel, { element: el }),
    config.formatBar && h('div', { id: 'text-format-bar' }, h(TextFormatBar)));
  const screen = (x, y) => ({ x: x / zoom, y: y / zoom });
  const nodes = slide.elementOrder.filter(id => id !== drawing.polyDraft?.extension?.source.id).map(id => {
    const shape = slide.elements[id];
    if (shape.visible === false) return null;
    return shape.type === 'shape' ? h(SVGShapeNode, { key: id, element: shape, disableInteraction: tool !== 'select',
      onPointerDown: e => { editor.getState().setSelectedElements([id]); drag.handlePointerDown(id, shape.x, shape.y, e); } }) : null;
  });
  const controls = tool === 'select' && selected.includes('subject') && el?.visible && !el.locked;
  return h('div', { style: { position: 'relative', width: 1100, height: 850, overflow: 'hidden' } },
    config.mode === 'icons' && h('div', { style: { position: 'absolute', left: 0, top: 0, width: 800, zIndex: 10 } }, h(config.mobile ? MobileToolPalette : Toolbar)),
    config.mode === 'icons' && h('div', { id: 'creation-properties', style: { position: 'absolute', left: 820, top: 0, width: 260, height: 850, overflow: 'auto', zIndex: 10 } }, h(PropertiesPanel)),
    config.mode === 'slides' && h('div', { style: { position: 'absolute', left: 820, width: 240, height: 650, zIndex: 10 } }, h(SlidePanel)),
    config.mode === 'merge' && h('div', { style: { position: 'absolute', left: 450, top: 300, width: 500, zIndex: 10 } }, h(ObjectListDrawer)),
    h('svg', { ref: svgRef, width: 2880 * zoom, height: 2460 * zoom, viewBox: '0 0 2880 2460',
      style: { position: 'absolute', left: -960 * zoom, top: -960 * zoom, touchAction: 'none' },
      onPointerDown: e => { if (tool !== 'select') drawing.handlePointerDown(e, screen); },
      onPointerMove: e => { if (tool !== 'select') drawing.handlePointerMove(e, screen); },
      onPointerUp: () => { if (tool !== 'select') drawing.handlePointerUp(); },
      onPointerCancel: () => { if (tool !== 'select') drawing.cancelPolyDraft(); },
      onDoubleClick: () => { if (tool !== 'select') drawing.commitPolyDraft(); },
    }, h('g', { transform: 'translate(960 960)' },
      h('rect', { width: 1920, height: 1080, fill: 'white' }), nodes,
      preview && h(RenderShape, { element: { ...el, ...preview } }),
      controls && (el.shapeType === 'path'
        ? h(SVGPathHandles, { element: el, elements: Object.values(slide.elements), zoom, svgRef, onUpdate: update, onGuidesChange: setGuides })
        : h(SVGSelectionTransformer, { elements: Object.values(slide.elements), selectedIds: ['subject'], zoom, svgRef,
            onTransform: (_, attrs) => setPreview(attrs), onTransformEnd: (_, attrs) => { update(attrs); setPreview(null); } })),
      controls && h(SVGCornerRadiusHandle, { element: el, zoom, svgRef, onUpdate: update }),
      h(SVGDrawingPreview, { drawState: drawing.drawState, tool, zoom }),
      h(SVGPolyDraftPreview, { polyDraft: drawing.polyDraft, zoom }),
      h(SVGAlignmentGuides, { guides: tool === 'select' ? guides : drawing.guides, zoom }),
    )));
}

window.canvasTest = {
  preferences: () => useCreationPreferences.getState().styles,
  resetPreferences: () => { useCreationPreferences.setState({ styles: {}, iconId: 'house' }); localStorage.removeItem('slides.creation-preferences.v1'); },
  arrowMarkup(element, mode = 'static', t = 1) {
    if (mode === 'export') return renderSlideToSVG({ elements: { [element.id]: element }, elementOrder: [element.id], background: { type: 'solid', color: '#fff' } }, {});
    const node = mode === 'static' ? h(RenderShape, { element }) : renderPresenterElement(mode === 'presenter' ? element : { ...element, _writeFx: { mode: 'create', t, tipDraw: mode === 'tipDraw' } }, {});
    return renderToStaticMarkup(h('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 400, height: 400 }, node));
  },
  drawShapeElement,

  store, editor, get doc() { return doc; }, getActiveUndoManager, drawing: null, pathArrowGeometry, interpolateElement, pathPointsInSlide, pathExtensionUpdate,
  setup(next = {}) {
    root?.unmount();
    setActiveUndoManager(null); setActiveDoc(null); doc?.destroy(); doc = null;
    config = next;
    const presentation = createPresentation();
    sid = presentation.slideOrder[0];
    const makeElement = props => props.type === 'text' ? createTextElement(props) : createShapeElement(props.shapeType ?? 'rect', props);
    const subject = makeElement({ id: 'subject', x: 100, y: 100, width: 100, height: 80, ...next.subject });
    const elements = next.empty ? [] : [subject];
    for (const target of next.targets ?? []) elements.push(makeElement(target));
    const slide = presentation.slides[sid];
    slide.elements = Object.fromEntries(elements.map(el => [el.id, el]));
    slide.elementOrder = elements.map(el => el.id);
    presentation.objects = Object.fromEntries(elements.map(el => [el.id, { id: el.id, name: el.id, type: el.type }]));
    if (next.secondSlide) {
      presentation.slides.other = { ...structuredClone(slide), id: 'other' };
      presentation.slideOrder.push('other');
      if (next.nextStyle) presentation.slides.other.elements.subject.style = { ...subject.style, ...next.nextStyle };
    }
    store.setState({ presentation });
    if (next.collab) { doc = jsonToYDoc(presentation); setActiveDoc(doc); setActiveUndoManager(createUndoManagerFor(doc)); }
    store.temporal.getState().clear();
    editor.setState({ activeSlideId: sid, tool: next.tool ?? 'select', zoom: next.zoom ?? 1, snapToGrid: !!next.snap,
      objectDrawerOpen: true, selectedElementIds: next.empty ? [] : ['subject'], editingTextId: null, selectedSlideIds: [], pathExtension: null });
    root = createRoot(document.getElementById('fixture'));
    root.render(h(React.StrictMode, null, h(next.mode === 'production' ? ProductionFixture : Fixture)));
  },
  snapshot() { return { slide: store.getState().presentation.slides[editor.getState().activeSlideId], editor: { tool: editor.getState().tool,
    selected: editor.getState().selectedElementIds, editing: editor.getState().editingTextId },
    undo: getActiveUndoManager()?.undoStack.length ?? store.temporal.getState().pastStates.length }; },
  renderPresenterElement,
};
