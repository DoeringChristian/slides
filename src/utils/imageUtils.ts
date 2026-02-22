import type { ImageElement, Resource } from '../types/presentation';

/**
 * Compute the updates needed when changing an image element's resource.
 * Resets crop to full image and resizes element to fit while maintaining aspect ratio.
 * Resizes with respect to the center point (not top-left).
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

    // Calculate current center point
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;

    // Fit new image within current element bounds while keeping aspect ratio
    const imageAspect = resource.originalWidth / resource.originalHeight;
    const elementAspect = element.width / element.height;

    let newWidth: number;
    let newHeight: number;

    if (imageAspect > elementAspect) {
      // Image is wider - fit to width, adjust height
      newWidth = element.width;
      newHeight = element.width / imageAspect;
    } else {
      // Image is taller - fit to height, adjust width
      newHeight = element.height;
      newWidth = element.height * imageAspect;
    }

    updates.width = newWidth;
    updates.height = newHeight;

    // Adjust position to keep center point fixed
    updates.x = centerX - newWidth / 2;
    updates.y = centerY - newHeight / 2;
  }

  return updates;
}
