let _ctrlHeld = false;
let _shiftHeld = false;
let _metaHeld = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') _ctrlHeld = true;
  if (e.key === 'Shift') _shiftHeld = true;
  if (e.key === 'Meta') _metaHeld = true;
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') _ctrlHeld = false;
  if (e.key === 'Shift') _shiftHeld = false;
  if (e.key === 'Meta') _metaHeld = false;
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => { _ctrlHeld = false; _shiftHeld = false; _metaHeld = false; });

export function isCtrlHeld(): boolean {
  return _ctrlHeld;
}

export function isShiftHeld(): boolean {
  return _shiftHeld;
}

/** Meta/Cmd specifically (isCtrlHeld treats Ctrl and Meta as one modifier).
 *  Used to suppress connector-binding target search while drawing. */
export function isMetaHeld(): boolean {
  return _metaHeld;
}
