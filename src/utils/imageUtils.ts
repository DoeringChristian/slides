import type { ImageElement, Resource } from '../types/presentation';

/**
 * Compute the updates needed when changing an image element's resource.
 * Resets crop to full image and resizes element to fit while maintaining aspect ratio.
 */
export function computeResourceUpdate(
  resourceId: string | null,
  resource: Resource | undefined,
  element: ImageElement
): Partial<ImageElement> {
  const updates: Partial<ImageElement> = { resourceId };

  if (resource) {
    // Reset crop to full image
    updates.cropX = 0;
    updates.cropY = 0;
    updates.cropWidth = resource.originalWidth;
    updates.cropHeight = resource.originalHeight;

    // Fit new image within current element bounds while keeping aspect ratio
    const imageAspect = resource.originalWidth / resource.originalHeight;
    const elementAspect = element.width / element.height;

    if (imageAspect > elementAspect) {
      // Image is wider - fit to width, adjust height
      updates.width = element.width;
      updates.height = element.width / imageAspect;
    } else {
      // Image is taller - fit to height, adjust width
      updates.height = element.height;
      updates.width = element.height * imageAspect;
    }
  }

  return updates;
}
