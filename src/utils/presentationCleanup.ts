import type {
  ImageElement,
  ObjectMeta,
  Presentation,
  ShapeElement,
  Slide,
  SlideElement,
  SlideTemplate,
} from '../types/presentation';

export function objectTypeForElement(el: SlideElement): ObjectMeta['type'] {
  if (el.type === 'text') return 'text';
  if (el.type === 'image') return 'image';
  return 'shape';
}

export function objectSubtypeForElement(el: SlideElement): string {
  if (el.type === 'shape') return (el as ShapeElement).shapeType;
  return el.type;
}

export function isResourceReferencedInSlides(slides: Record<string, Slide>, resourceId: string): boolean {
  return Object.values(slides).some((slide) =>
    Object.values(slide.elements).some((element) =>
      element.type === 'image' && (element as ImageElement).resourceId === resourceId,
    ),
  );
}

export function isObjectVisibleAnywhere(slides: Record<string, Slide>, objectId: string): boolean {
  return Object.values(slides).some((slide) => slide.elements[objectId]?.visible === true);
}

/** Presence, NOT visibility: true when any slide's `elements` contains the id,
 *  even if the element is hidden on every slide it appears on. */
export function objectExistsAnywhere(slides: Record<string, Slide>, objectId: string): boolean {
  return Object.values(slides).some((slide) => slide.elements[objectId] !== undefined);
}

/** Registry ids with zero element occurrences on any slide — "ghost" objects
 *  that show up in the objects bar but cannot be unhidden or hovered. */
export function collectGhostObjectIds(
  slides: Record<string, Slide>,
  objects: Record<string, ObjectMeta>,
): string[] {
  return Object.keys(objects).filter((objectId) => !objectExistsAnywhere(slides, objectId));
}

function isResourceReferencedInTemplates(
  templates: Record<string, SlideTemplate>,
  resourceId: string,
): boolean {
  return Object.values(templates).some((template) =>
    Object.values(template.elements).some(
      (element) => element.type === 'image' && (element as ImageElement).resourceId === resourceId,
    ),
  );
}

/**
 * Load-time registry integrity repair:
 * drops object-registry entries with zero element occurrences on any slide
 * (ghost objects) and resources referenced by no slide (and no template).
 * Idempotent — a clean deck is returned as the same object, unchanged.
 *
 * Deliberately does NOT touch the other orphan direction (elements present in
 * `elements` but missing from `elementOrder`) — that repair is a pending
 * product decision.
 */
export function repairPresentation(presentation: Presentation): Presentation {
  const ghostIds = collectGhostObjectIds(presentation.slides, presentation.objects);
  const orphanResourceIds = Object.keys(presentation.resources).filter(
    (resourceId) =>
      !isResourceReferencedInSlides(presentation.slides, resourceId) &&
      !isResourceReferencedInTemplates(presentation.templates, resourceId),
  );
  if (ghostIds.length === 0 && orphanResourceIds.length === 0) return presentation;

  const objects = { ...presentation.objects };
  for (const id of ghostIds) delete objects[id];
  const resources = { ...presentation.resources };
  for (const id of orphanResourceIds) delete resources[id];
  return { ...presentation, objects, resources };
}

/** Text elements bound to `containerId` anywhere in the deck (bound-text
 *  labels). Deterministic order: slides in Object.entries order is NOT
 *  stable across the two store paths, so ids are collected per-slide in
 *  elementOrder order and de-duplicated. */
function collectBoundTextIdsInSlides(
  slides: Record<string, Slide>,
  containerId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slide of Object.values(slides)) {
    for (const elId of slide.elementOrder) {
      const el = slide.elements[elId];
      if (!el || el.type !== 'text' || seen.has(elId)) continue;
      if ((el as { containerId?: string | null }).containerId === containerId) {
        seen.add(elId);
        out.push(elId);
      }
    }
  }
  return out;
}

function removeElementFromSlides(
  slides: Record<string, Slide>,
  elementId: string,
): Record<string, Slide> {
  const cleaned: Record<string, Slide> = {};
  for (const [sid, slide] of Object.entries(slides)) {
    if (!slide.elements[elementId]) {
      cleaned[sid] = slide;
      continue;
    }
    const { [elementId]: _removed, ...remainingElements } = slide.elements;
    // Purging (unlike hiding) removes the target permanently. Detach only
    // references, leaving the stored world geometry of connectors unchanged.
    for (const [id, element] of Object.entries(remainingElements)) {
      if (element.type === 'shape') {
        const start = element.startBinding?.elementId === elementId;
        const end = element.endBinding?.elementId === elementId;
        if (start || end) remainingElements[id] = {
          ...element,
          ...(start ? { startBinding: null } : {}),
          ...(end ? { endBinding: null } : {}),
        };
      } else if (element.type === 'group' && element.childIds.includes(elementId)) {
        remainingElements[id] = { ...element, childIds: element.childIds.filter(id => id !== elementId) };
      }
    }
    cleaned[sid] = {
      ...slide,
      elements: remainingElements,
      elementOrder: slide.elementOrder.filter((id) => id !== elementId),
    };
  }
  return cleaned;
}

/**
 * Remove an object element from every slide and report the image resource that
 * became unreferenced, if any. Cascades to bound-text labels: text elements
 * whose `containerId` is the purged object are orphans and are purged too;
 * their ids come back in `purgedBoundTextIds` so callers can drop their
 * object-registry entries (the registry itself is owned by callers).
 */
export function purgeObjectFromSlides(
  slides: Record<string, Slide>,
  objectId: string,
): { slides: Record<string, Slide>; resourceIdToRemove: string | null; purgedBoundTextIds: string[] } {
  let resourceIdToCheck: string | null = null;
  for (const slide of Object.values(slides)) {
    const element = slide.elements[objectId];
    if (element && element.type === 'image' && element.resourceId) {
      resourceIdToCheck = element.resourceId;
    }
  }

  let cleanedSlides = removeElementFromSlides(slides, objectId);

  // Cascade: labels bound to the purged object would be orphans.
  const purgedBoundTextIds = collectBoundTextIdsInSlides(cleanedSlides, objectId);
  for (const labelId of purgedBoundTextIds) {
    cleanedSlides = removeElementFromSlides(cleanedSlides, labelId);
  }

  const resourceIdToRemove =
    resourceIdToCheck && !isResourceReferencedInSlides(cleanedSlides, resourceIdToCheck)
      ? resourceIdToCheck
      : null;

  return { slides: cleanedSlides, resourceIdToRemove, purgedBoundTextIds };
}
