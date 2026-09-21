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
 * Load-time repair for decks corrupted before `deleteSlide` learned to GC:
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

/**
 * Remove an object element from every slide and report the image resource that
 * became unreferenced, if any. The object registry itself is owned by callers.
 */
export function purgeObjectFromSlides(
  slides: Record<string, Slide>,
  objectId: string,
): { slides: Record<string, Slide>; resourceIdToRemove: string | null } {
  const cleanedSlides: Record<string, Slide> = {};
  let resourceIdToCheck: string | null = null;

  for (const [sid, slide] of Object.entries(slides)) {
    const element = slide.elements[objectId];
    if (!element) {
      cleanedSlides[sid] = slide;
      continue;
    }

    if (element.type === 'image' && element.resourceId) {
      resourceIdToCheck = element.resourceId;
    }

    const { [objectId]: _removed, ...remainingElements } = slide.elements;
    cleanedSlides[sid] = {
      ...slide,
      elements: remainingElements,
      elementOrder: slide.elementOrder.filter((id) => id !== objectId),
    };
  }

  const resourceIdToRemove =
    resourceIdToCheck && !isResourceReferencedInSlides(cleanedSlides, resourceIdToCheck)
      ? resourceIdToCheck
      : null;

  return { slides: cleanedSlides, resourceIdToRemove };
}
