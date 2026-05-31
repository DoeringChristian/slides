import { useEffect, useState } from 'react';

// Chrome/Edge/Android fire `beforeinstallprompt` when the PWA criteria are met
// (manifest + service worker + visited a few times). iOS Safari has no such
// event — users must use Share → Add to Home Screen. This hook surfaces the
// install action for the browsers that support it; for iOS, callers can show
// a different hint based on `isStandalone` + user-agent if they want to.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(
    () =>
      typeof window !== 'undefined' &&
      // Already running as an installed PWA (any platform).
      (window.matchMedia('(display-mode: standalone)').matches ||
        // iOS-specific signal.
        (window.navigator as { standalone?: boolean }).standalone === true),
  );

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return null;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return choice.outcome;
  };

  return {
    canInstall: !!deferredPrompt && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
