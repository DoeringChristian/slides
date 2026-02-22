import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditorStore } from '../store/editorStore';

export interface PresenterMessage {
  type: 'slide-change' | 'animation-state' | 'exit' | 'sync-request' | 'sync-response';
  slideIndex?: number;
  isAnimating?: boolean;
  animProgress?: number;
  targetIndex?: number;
}

const CHANNEL_NAME = 'slides-presenter';

// Singleton channel and window reference
let channel: BroadcastChannel | null = null;
let audienceWindow: Window | null = null;

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

export function usePresenterMode() {
  const isPresenterMode = useEditorStore((s) => s.isPresenterMode);
  const setPresenterMode = useEditorStore((s) => s.setPresenterMode);
  const resetPresenterTimer = useEditorStore((s) => s.resetPresenterTimer);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const setPresenting = useEditorStore((s) => s.setPresenting);

  const checkWindowRef = useRef<number | null>(null);

  // Start presenter mode
  const startPresenterMode = useCallback(() => {
    // Open audience window
    const win = window.open(
      `${window.location.origin}${window.location.pathname}?audience=true`,
      'audience-view',
      'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
    );

    if (win) {
      audienceWindow = win;
      setPresenterMode(true);
      setPresenting(true);

      // Send initial sync after window loads
      setTimeout(() => {
        getChannel().postMessage({
          type: 'sync-response',
          slideIndex: useEditorStore.getState().presentingSlideIndex,
        } as PresenterMessage);
      }, 1000);
    }
  }, [setPresenterMode, setPresenting]);

  // Exit presenter mode
  const exitPresenterMode = useCallback(() => {
    getChannel().postMessage({ type: 'exit' } as PresenterMessage);

    if (audienceWindow && !audienceWindow.closed) {
      audienceWindow.close();
    }
    audienceWindow = null;

    setPresenterMode(false);
    setPresenting(false);
  }, [setPresenterMode, setPresenting]);

  // Navigate to slide and sync with audience window
  const goToSlide = useCallback((index: number) => {
    setPresentingSlideIndex(index);
    getChannel().postMessage({
      type: 'slide-change',
      slideIndex: index,
    } as PresenterMessage);
  }, [setPresentingSlideIndex]);

  // Send animation state to audience
  const sendAnimationState = useCallback((isAnimating: boolean, progress: number, targetIndex: number) => {
    getChannel().postMessage({
      type: 'animation-state',
      isAnimating,
      animProgress: progress,
      targetIndex,
    } as PresenterMessage);
  }, []);

  // Check if audience window is still open
  useEffect(() => {
    if (!isPresenterMode) {
      if (checkWindowRef.current) {
        clearInterval(checkWindowRef.current);
        checkWindowRef.current = null;
      }
      return;
    }

    checkWindowRef.current = window.setInterval(() => {
      if (audienceWindow && audienceWindow.closed) {
        exitPresenterMode();
      }
    }, 1000);

    return () => {
      if (checkWindowRef.current) {
        clearInterval(checkWindowRef.current);
      }
    };
  }, [isPresenterMode, exitPresenterMode]);

  // Handle sync requests from audience window
  useEffect(() => {
    const ch = getChannel();
    const handler = (event: MessageEvent<PresenterMessage>) => {
      if (event.data.type === 'sync-request') {
        ch.postMessage({
          type: 'sync-response',
          slideIndex: useEditorStore.getState().presentingSlideIndex,
        } as PresenterMessage);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }, []);

  return {
    isPresenterMode,
    startPresenterMode,
    exitPresenterMode,
    goToSlide,
    sendAnimationState,
    resetTimer: resetPresenterTimer,
  };
}

// Hook for audience window to receive messages
export function useAudienceReceiver() {
  const [state, setState] = useState({
    slideIndex: 0,
    isAnimating: false,
    animProgress: 0,
    targetIndex: 0,
    shouldExit: false,
  });

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME);

    // Request sync on load
    ch.postMessage({ type: 'sync-request' } as PresenterMessage);

    ch.onmessage = (event: MessageEvent<PresenterMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'slide-change':
          if (msg.slideIndex !== undefined) {
            setState(s => ({ ...s, slideIndex: msg.slideIndex!, isAnimating: false }));
          }
          break;
        case 'animation-state':
          setState(s => ({
            ...s,
            isAnimating: msg.isAnimating ?? false,
            animProgress: msg.animProgress ?? 0,
            targetIndex: msg.targetIndex ?? 0,
            slideIndex: !msg.isAnimating && msg.targetIndex !== undefined ? msg.targetIndex : s.slideIndex,
          }));
          break;
        case 'sync-response':
          if (msg.slideIndex !== undefined) {
            setState(s => ({ ...s, slideIndex: msg.slideIndex! }));
          }
          break;
        case 'exit':
          setState(s => ({ ...s, shouldExit: true }));
          break;
      }
    };

    return () => {
      ch.close();
    };
  }, []);

  return state;
}
