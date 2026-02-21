let _ctrlHeld = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') _ctrlHeld = true;
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') _ctrlHeld = false;
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => { _ctrlHeld = false; });

export function isCtrlHeld(): boolean {
  return _ctrlHeld;
}
