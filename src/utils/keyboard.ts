let _ctrlHeld = false;
let _shiftHeld = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') _ctrlHeld = true;
  if (e.key === 'Shift') _shiftHeld = true;
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') _ctrlHeld = false;
  if (e.key === 'Shift') _shiftHeld = false;
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => { _ctrlHeld = false; _shiftHeld = false; });

export function isCtrlHeld(): boolean {
  return _ctrlHeld;
}

export function isShiftHeld(): boolean {
  return _shiftHeld;
}
