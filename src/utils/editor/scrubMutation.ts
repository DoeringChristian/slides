/** One preview gesture may own history at a time. Unrelated local mutations
 * cancel it BEFORE reading state; rollback writes are explicitly owned and
 * cannot recursively cancel themselves. Remote synchronization bypasses this
 * local-action boundary. */
let cancelActive: (() => void) | null = null;
let ownedDepth = 0;
let foreignTransactionDepth = 0;

export function inForeignTransaction<T>(run: () => T): T {
  foreignTransactionDepth++;
  try { return run(); } finally { foreignTransactionDepth--; }
}

export function isOwnedScrubMutation() { return ownedDepth > 0; }

export function beforeLocalMutation() {
  if (ownedDepth) return;
  if (cancelActive && foreignTransactionDepth) throw new Error('Local write during a remote transaction while scrubbing');
  const cancel = cancelActive;
  cancelActive = null;
  cancel?.();
}

export function ownScrubMutation<T>(write: () => T): T {
  ownedDepth++;
  try { return write(); } finally { ownedDepth--; }
}

export function registerScrubMutation(cancel: () => void): () => void {
  if (foreignTransactionDepth) throw new Error('Cannot begin scrub inside a remote transaction');
  beforeLocalMutation();
  cancelActive = cancel;
  return () => { if (cancelActive === cancel) cancelActive = null; };
}

/** PresentationStore's function fields are exclusively local mutating actions.
 * Guard at entry, not at set(), because an action may read state first. */
export function guardLocalActions<T extends object>(state: T): T {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key,
    typeof value === 'function' ? (...args: unknown[]) => {
      beforeLocalMutation();
      return value(...args);
    } : value,
  ])) as T;
}
