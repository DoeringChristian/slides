const KEY = 'slides.editor-location.v1';
export interface EditorLocation { projectId: string; slideId: string; storageMode: string; serverUrl: string | null }
export function readEditorLocation(): EditorLocation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return value && typeof value.projectId === 'string' && typeof value.slideId === 'string' && typeof value.storageMode === 'string' && (value.serverUrl === null || typeof value.serverUrl === 'string') ? value : null;
  } catch { return null; }
}
export function rememberEditorLocation(location: EditorLocation) {
  try { sessionStorage.setItem(KEY, JSON.stringify(location)); } catch { /* Storage may be disabled. */ }
}
export function clearEditorLocation() {
  try { sessionStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
}
