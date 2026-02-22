/**
 * Compute a SHA-256 hash of file content for deduplication.
 * Uses the Web Crypto API for efficient hashing.
 */
export async function computeFileHash(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Compute a hash from a data URL string.
 * Extracts the base64 content and hashes it.
 */
export async function computeDataUrlHash(dataUrl: string): Promise<string> {
  // Extract the base64 part after the comma
  const base64 = dataUrl.split(',')[1] || '';
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
