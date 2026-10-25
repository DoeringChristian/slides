import { autoFitTextGeometry, canAutoFitText } from '../utils/textAutoFit';
import type { SlideElement, TextElement } from '../types/presentation';
import { yDocToJsonSlideOnly } from '../collab/ySchema';
import { getActiveDoc, subscribeActiveDocChange } from '../collab/yDocAdapter';
import { getActiveUndoManager } from '../collab/activeUndo';
import { readElementForMutation, readSlideForMutation } from './currentMutation';
import { usePresentationStore } from './presentationStore';
import { hasContentSizing, measureUserText } from '../utils/userTextSizing';
import { layoutSvgText } from '../utils/textLayout';
import { boundTextBaseline, boundTextMeasurementKey, supportsMeasuredBoundText, type BoundTextFitContext } from '../utils/boundTextLayout';
import type { GesturePatch } from '../utils/gestureProjection';
import { fitLabelToDoc, labelWrapWidthFor } from '../utils/syncDependents';

// An A→B→A document/deck round trip must not resurrect accepted work.
let ownershipRevision = 0;
subscribeActiveDocChange(() => { ownershipRevision++; });
usePresentationStore.subscribe((state, previous) => {
  if (state.presentation.id !== previous.presentation.id) ownershipRevision++;
});

const creations = new Set<string>();
const sessions = new Map<string, object>();
interface AcceptedFinish {
  text: string;
  completion: Promise<void>;
  current: () => TextElement | undefined;
  succeeded: boolean;
}
const acceptedFinishes = new Map<string, AcceptedFinish>();
const finishListeners = new Set<() => void>();
let finishRevision = 0;
export const subscribeTextFinishes = (listener: () => void) => {
  finishListeners.add(listener);
  return () => { finishListeners.delete(listener); };
};
export const textFinishRevision = () => finishRevision;
function notifyTextFinishes() {
  finishRevision++;
  finishListeners.forEach(listener => listener());
}
const keyFor = (slideId: string, id: string) => `${slideId}:${id}`;

/** Only the initial canvas creation gesture may discard an empty free text. */
export function markTextCreation(slideId: string, id: string): void {
  creations.add(keyFor(slideId, id));
}

/** Pure read: the overlay may seed during render, before the Yjs projection
 * catches up. Accepted drafts are visible immediately; their commits stay ordered. */
function readTextElement(slideId: string, id: string): TextElement | undefined {
  const doc = getActiveDoc();
  const slide = doc ? yDocToJsonSlideOnly(doc, slideId)
    : usePresentationStore.getState().presentation.slides[slideId];
  const element = slide?.elements[id];
  return element?.type === 'text' ? element : undefined;
}

function pendingFinish(slideId: string, id: string): AcceptedFinish | undefined {
  const pending = acceptedFinishes.get(keyFor(slideId, id));
  return pending?.current() ? pending : undefined;
}

/** Only the owning label is suppressed. current() also verifies document and
 * presentation identity, so an obsolete pending promise cannot block a new deck. */
export function hasPendingTextFinish(slideId: string, textId: string): boolean {
  return !!pendingFinish(slideId, textId);
}

export function getTextEditInitialText(slideId: string, element: TextElement): string {
  return pendingFinish(slideId, element.id)?.text ?? readTextElement(slideId, element.id)?.text ?? element.text;
}

export function beginTextEditSession(slideId: string, element: TextElement) {
  const key = keyFor(slideId, element.id);
  const token = {};
  sessions.set(key, token);
  const initialCreation = creations.delete(key);
  const doc = getActiveDoc();
  const presentationId = usePresentationStore.getState().presentation.id;
  const revision = ownershipRevision;
  let predecessor = pendingFinish(slideId, element.id);
  const initialText = predecessor?.text ?? readTextElement(slideId, element.id)?.text ?? element.text;
  let expectedText = initialText;
  let completion: Promise<void> | undefined;
  const peekCurrent = () => {
    if (revision !== ownershipRevision || getActiveDoc() !== doc ||
        usePresentationStore.getState().presentation.id !== presentationId) return;
    // While waiting, the authoritative content still belongs to the accepted
    // predecessor. Remote edits invalidate the entire dependent draft chain.
    if (predecessor) return predecessor.current();
    const el = readTextElement(slideId, element.id);
    return el?.text === expectedText && el.visible === element.visible && el.containerId === element.containerId ? el : undefined;
  };
  const current = () => {
    readElementForMutation(slideId, element.id);
    return peekCurrent();
  };
  let previewGeneration = 0;
  let context: BoundTextFitContext | undefined;
  let contextKey = '';
  let edited = false;
  const fittingLabel = (el: TextElement, container: SlideElement, text: string): TextElement =>
    supportsMeasuredBoundText(container)
      ? { ...el, text, boundTextLayout: 'measured', boundTextBaselineHeight: boundTextBaseline(container, el) }
      : { ...el, text };
  const fitMeasured = (el: TextElement, container: SlideElement, text: string, measured: { width: number; height: number }) => {
    const label = fittingLabel(el, container, text);
    const nextKey = JSON.stringify([container.id, container.type === 'shape' ? container.shapeType : container.type, container.width, container.height, label.boundTextBaselineHeight, label.boundTextLayout]);
    if (contextKey !== nextKey) {
      contextKey = nextKey;
      context = { baselineHeight: boundTextBaseline(container, label), currentHeight: container.height };
    }
    const fit = fitLabelToDoc(container, label, measured, context);
    if (fit.fittedHeight !== undefined) context!.currentHeight = fit.fittedHeight;
    const metadata = label.boundTextLayout === 'measured'
      ? { boundTextLayout: label.boundTextLayout, boundTextBaselineHeight: label.boundTextBaselineHeight } : {};
    return { fit, label: { ...label, ...fit.label, ...metadata } };
  };
  return {
    initialText,
    async preview(text: string, rawLines?: Set<number>): Promise<{ slideId: string; label: TextElement; patches: GesturePatch[] } | undefined> {
      const generation = ++previewGeneration;
      edited ||= text !== initialText;
      if (predecessor) await predecessor.completion;
      let el = peekCurrent();
      if (!el || completion || sessions.get(key) !== token) return;
      while (el.containerId) {
        const container = (doc ? yDocToJsonSlideOnly(doc, slideId) : usePresentationStore.getState().presentation.slides[slideId])?.elements[el.containerId];
        if (!container) return;
        const label = fittingLabel(el, container, text);
        const signature = boundTextMeasurementKey(container, label, rawLines);
        const measured = await layoutSvgText(text, label.style, labelWrapWidthFor(container, label), rawLines);
        if (generation !== previewGeneration || completion || sessions.get(key) !== token) return;
        el = peekCurrent();
        if (!el) return;
        const latest = (doc ? yDocToJsonSlideOnly(doc, slideId) : usePresentationStore.getState().presentation.slides[slideId])?.elements[el.containerId ?? ''];
        if (!latest) return;
        if (signature !== boundTextMeasurementKey(latest, fittingLabel(el, latest, text), rawLines)) continue;
        const result = fitMeasured(el, latest, text, measured);
        return { slideId, label: result.label, patches: [
          { elementId: el.id, changes: result.label },
          ...(result.fit.container ? [{ elementId: latest.id, changes: result.fit.container }] : []),
        ] };
      }
    },
    finish(text: string, intent?: 'auto-content'): Promise<void> {
      if (completion) return completion;
      if (sessions.get(key) !== token) return Promise.resolve();
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      completion = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      const accepted: AcceptedFinish = { text, completion, current: peekCurrent, succeeded: false };
      acceptedFinishes.set(key, accepted);
      notifyTextFinishes();
      let stopWatching: (() => void) | undefined;
      let invalidated = false;
      const commit = async () => {
        if (predecessor) {
          await predecessor.completion;
          if (!predecessor.succeeded) return;
          predecessor = undefined;
        }
        let el = current();
        if (!el) return;
        const store = usePresentationStore.getState();
        if (text.trim() === '' && (el.containerId || initialCreation)) {
          getActiveUndoManager()?.stopCapturing();
          if (initialCreation && !el.containerId) store.hideElement(slideId, element.id);
          else store.deleteElements(slideId, [element.id]);
          getActiveUndoManager()?.stopCapturing();
          return;
        }
        const autoFit = intent === 'auto-content' && canAutoFitText(el);
        if (intent && !autoFit && el.textSizing !== 'auto-content') return;
        if (text === el.text && !edited && !autoFit) { accepted.succeeded = true; return; }
        if (autoFit) {
          const check = () => { const latest = peekCurrent(); if (!latest || latest.locked) invalidated = true; };
          const unsubscribe = usePresentationStore.subscribe(check);
          doc?.on('afterTransaction', check);
          stopWatching = () => { unsubscribe(); doc?.off('afterTransaction', check); };
        }
        let size: Partial<TextElement> | undefined;
        let containerUpdate: { elementId: string; changes: Partial<SlideElement> } | undefined;
        while (autoFit || hasContentSizing(el)) {
          const signature = JSON.stringify([el.style, el.width, el.height, el.textSizing, el.containerId]);
          try { size = await measureUserText({ ...el, text, ...(autoFit ? { textSizing: 'auto-content' } : {}) }); }
          catch { size = undefined; break; } // Keep source text and the existing box on font/layout failure.
          el = current();
          if (!el || invalidated) return;
          if (signature === JSON.stringify([el.style, el.width, el.height, el.textSizing, el.containerId])) break;
          size = undefined;
        }
        if (autoFit && size && 'width' in size && 'height' in size) {
          size = { ...autoFitTextGeometry(el, size as { width: number; height: number }), textSizing: 'auto-content' };
        }
        // Preserve the existing bound-label fit policy, but include its finish
        // geometry in the content transaction rather than a second undo entry.
        while (el.containerId) {
          const container = readSlideForMutation(slideId)?.elements[el.containerId];
          if (!container) break;
          const label = fittingLabel(el, container, text);
          const signature = boundTextMeasurementKey(container, label);
          let measured;
          try { measured = await layoutSvgText(text, el.style, labelWrapWidthFor(container, label)); }
          catch { break; }
          el = current();
          if (!el) return;
          const latestContainer = el.containerId ? readSlideForMutation(slideId)?.elements[el.containerId] : undefined;
          if (!latestContainer) break;
          if (signature !== boundTextMeasurementKey(latestContainer, fittingLabel(el, latestContainer, text))) continue;
          const result = fitMeasured(el, latestContainer, text, measured);
          size = { ...result.fit.label, ...(result.label.boundTextLayout === 'measured' ? {
            boundTextLayout: result.label.boundTextLayout, boundTextBaselineHeight: result.label.boundTextBaselineHeight,
          } : {}) };
          if (result.fit.container) containerUpdate = { elementId: latestContainer.id, changes: result.fit.container };
          break;
        }
        if (!current() || invalidated) return;
        stopWatching?.();
        if (text === el.text && !containerUpdate && Object.entries(size ?? {}).every(([k, v]) => el![k as keyof TextElement] === v)) {
          accepted.succeeded = true; return;
        }
        // Content and shared-layout geometry are one logical undo entry.
        getActiveUndoManager()?.stopCapturing();
        store.updateElements(slideId, [
          { elementId: element.id, changes: { text, ...size } },
          ...(containerUpdate ? [containerUpdate] : []),
        ], true);
        getActiveUndoManager()?.stopCapturing();
        expectedText = text;
        accepted.succeeded = true;
      };
      const cleanup = () => {
        stopWatching?.();
        if (acceptedFinishes.get(key) === accepted) acceptedFinishes.delete(key);
        if (sessions.get(key) === token) sessions.delete(key);
        notifyTextFinishes();
      };
      void commit().then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
      return completion;
    },
  };
}

/** Selected-state action also queues behind an accepted edit, never stale stored text. */
export function autoFitText(slideId: string, element: TextElement): Promise<void> {
  if (!canAutoFitText(element)) return Promise.resolve();
  const session = beginTextEditSession(slideId, element);
  return session.finish(session.initialText, 'auto-content');
}
