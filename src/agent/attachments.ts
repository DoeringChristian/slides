import type { DocumentBlock, ImageBlock } from './providers/types';

/**
 * Media the user adds to the chat: images (to look at, or to place on a
 * slide) and PDFs (source material). The original file is kept so an image
 * can go into the deck at full resolution; the model gets a copy no larger
 * than it can use.
 */

export interface ChatAttachment {
  /** Short id the model refers to, e.g. "a3". */
  id: string;
  name: string;
  kind: 'image' | 'pdf';
  /** Original file, for placing on a slide. */
  file: Blob;
  /** What the model receives. */
  block: ImageBlock | DocumentBlock;
  /** Object URL for the chat thumbnail (images only). */
  previewUrl?: string;
  width?: number;
  height?: number;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Longest side the models use; larger images are downscaled before sending. */
const MAX_IMAGE_SIDE = 1568;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

let counter = 0;
const nextId = () => `a${++counter}`;

export function isSupportedAttachment(file: Blob): boolean {
  return IMAGE_TYPES.has(file.type) || file.type === 'application/pdf';
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Image → a copy within the model's limits (PNG keeps transparency for
 *  small images; large ones become JPEG). */
async function modelImage(file: Blob): Promise<{ block: ImageBlock; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  const fits = scale === 1 && file.size <= MAX_IMAGE_BYTES && (file.type === 'image/png' || file.type === 'image/jpeg');
  if (fits) {
    bitmap.close();
    return { block: { type: 'image', mediaType: file.type as ImageBlock['mediaType'], data: await toBase64(file) }, width, height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const asPng = canvas.toDataURL('image/png');
  const dataUrl = asPng.length * 0.75 <= MAX_IMAGE_BYTES ? asPng : canvas.toDataURL('image/jpeg', 0.88);
  const mediaType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  return { block: { type: 'image', mediaType, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }, width, height };
}

export async function prepareAttachment(file: File): Promise<ChatAttachment> {
  const name = file.name || (file.type === 'application/pdf' ? 'document.pdf' : 'image');
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error(`${name} is larger than 20 MB.`);
    return { id: nextId(), name, kind: 'pdf', file, block: { type: 'document', mediaType: 'application/pdf', data: await toBase64(file), name } };
  }
  if (!IMAGE_TYPES.has(file.type)) throw new Error(`${name}: only PNG, JPEG, GIF, WebP and PDF can be attached.`);
  const { block, width, height } = await modelImage(file);
  return { id: nextId(), name, kind: 'image', file, block, width, height, previewUrl: URL.createObjectURL(file) };
}

/** How the model learns what it was given and how to refer to it. */
export function describeAttachments(attachments: ChatAttachment[]): string {
  if (!attachments.length) return '';
  const lines = attachments.map(a => a.kind === 'image'
    ? `- ${a.id}: image "${a.name}" (${a.width}×${a.height}) — can be placed on a slide with insert_attachment`
    : `- ${a.id}: PDF "${a.name}" — source material`);
  return `Attached:\n${lines.join('\n')}`;
}
