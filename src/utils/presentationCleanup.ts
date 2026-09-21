import type { ImageElement, ObjectMeta, ShapeElement, Slide, SlideElement } from '../types/presentation';

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
