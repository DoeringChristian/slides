import { PresenterView } from './components/presenter/PresenterView';
import { readStandaloneBoot, applyStandaloneBoot } from './utils/standaloneBoot';

// Thin viewer-only shell. Reuses the editor's PresenterView, presenterUtils, and
// presentation/editor stores — there is no separate slide renderer here.
const boot = readStandaloneBoot();
// Apply synchronously, before React renders. We force mode='viewer' because the
// viewer build doesn't include the editor UI; respecting boot.mode would be a lie.
if (boot) applyStandaloneBoot(boot, 'viewer');

export function ViewerApp() {
  if (!boot) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black text-white/70">
        No presentation payload found.
      </div>
    );
  }
  return <PresenterView />;
}
