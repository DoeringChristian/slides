import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { usePresentationStore } from '../store/presentationStore';

export interface PresenterMessage {
  type: 'slide-change' | 'animation-state' | 'exit' | 'sync-request' | 'sync-response' | 'video-command' | 'settings';
  slideIndex?: number;
  isAnimating?: boolean;
  animProgress?: number;
  /** The transition's length (ms): the audience times it itself. */
  animDuration?: number;
  targetIndex?: number;
  videoCommand?: { action: 'play' | 'pause' | 'seek'; currentTime?: number };
  showSlideNumbers?: boolean;
}

const CHANNEL_NAME = 'slides-presenter';
const DATA_CHANNEL_NAME = 'slides-presenter-data';

// Singleton channel and window reference
let channel: BroadcastChannel | null = null;
let dataChannel: BroadcastChannel | null = null;
let audienceWindow: Window | null = null;

/** The open audience window (same origin, so its document is reachable). */
export function getAudienceWindow(): Window | null {
  return audienceWindow && !audienceWindow.closed ? audienceWindow : null;
}

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

function getDataChannel(): BroadcastChannel {
  if (!dataChannel) {
    dataChannel = new BroadcastChannel(DATA_CHANNEL_NAME);
  }
  return dataChannel;
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
        const editorState = useEditorStore.getState();
        getChannel().postMessage({
          type: 'sync-response',
          slideIndex: editorState.presentingSlideIndex,
          showSlideNumbers: editorState.showSlideNumbers,
        } as PresenterMessage);
      }, 1000);
    }
  }, [setPresenterMode, setPresenting]);

  // Listen for presentation data requests from audience window
  useEffect(() => {
    const dc = getDataChannel();
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'request-presentation') {
        // Send presentation data to audience window
        dc.postMessage({
          type: 'presentation-data',
          presentation: usePresentationStore.getState().presentation,
        });
      }
    };
    dc.addEventListener('message', handler);
    return () => dc.removeEventListener('message', handler);
  }, []);

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
  const sendAnimationState = useCallback((isAnimating: boolean, progress: number, targetIndex: number, duration?: number) => {
    getChannel().postMessage({
      type: 'animation-state',
      isAnimating,
      animProgress: progress,
      animDuration: duration,
      targetIndex,
    } as PresenterMessage);
  }, []);

  // Send video command to audience
  const sendVideoCommand = useCallback((action: 'play' | 'pause' | 'seek', currentTime?: number) => {
    getChannel().postMessage({
      type: 'video-command',
      videoCommand: { action, currentTime },
    } as PresenterMessage);
  }, []);

  // Send settings update to audience
  const sendSettings = useCallback((settings: { showSlideNumbers: boolean }) => {
    getChannel().postMessage({
      type: 'settings',
      showSlideNumbers: settings.showSlideNumbers,
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
        const editorState = useEditorStore.getState();
        ch.postMessage({
          type: 'sync-response',
          slideIndex: editorState.presentingSlideIndex,
          showSlideNumbers: editorState.showSlideNumbers,
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
    sendVideoCommand,
    sendSettings,
    resetTimer: resetPresenterTimer,
  };
}

// Hook for audience window to receive messages
export interface VideoCommand {
  action: 'play' | 'pause' | 'seek';
  currentTime?: number;
}

export function useAudienceReceiver() {
  const [state, setState] = useState({
    slideIndex: 0,
    isAnimating: false,
    animProgress: 0,
    targetIndex: 0,
    shouldExit: false,
    showSlideNumbers: false,
  });
  const [videoCommand, setVideoCommand] = useState<VideoCommand | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    let local: { target: number; frame: number } | null = null;
    let landed: number | null = null;
    const stopLocal = () => { if (local) cancelAnimationFrame(local.frame); local = null; };

    // Request sync on load
    ch.postMessage({ type: 'sync-request' } as PresenterMessage);

    ch.onmessage = (event: MessageEvent<PresenterMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'slide-change':
          if (msg.slideIndex !== undefined) {
            stopLocal();
            landed = null;
            setState(s => ({ ...s, slideIndex: msg.slideIndex!, isAnimating: false }));
          }
          break;
        case 'animation-state': {
          const target = msg.targetIndex ?? 0;
          if (msg.isAnimating && msg.animDuration) {
            // The audience plays the transition on its own clock from the
            // moment it started: the presenter's window may get few or no
            // frames (hidden behind this one), and its per-frame progress
            // would arrive late and uneven.
            // (Already playing it, or already landed: later progress
            // messages of the same transition change nothing.)
            if (local?.target === target || landed === target) break;
            stopLocal();
            const duration = msg.animDuration;
            const t0 = performance.now() - (msg.animProgress ?? 0) * duration;
            local = { target, frame: 0 };
            const step = () => {
              if (!local || local.target !== target) return;
              const p = Math.min(1, (performance.now() - t0) / duration);
              if (p < 1) {
                setState(s => ({ ...s, isAnimating: true, animProgress: p, targetIndex: target }));
                local.frame = requestAnimationFrame(step);
              } else {
                local = null;
                landed = target;
                setState(s => ({ ...s, isAnimating: false, animProgress: 1, targetIndex: target, slideIndex: target }));
              }
            };
            step();
            break;
          }
          if (!msg.isAnimating) { if (local?.target === target) stopLocal(); landed = null; }
          setState(s => ({
            ...s,
            isAnimating: msg.isAnimating ?? false,
            animProgress: msg.animProgress ?? 0,
            targetIndex: target,
            slideIndex: !msg.isAnimating && msg.targetIndex !== undefined ? msg.targetIndex : s.slideIndex,
          }));
          break;
        }
        case 'sync-response':
          if (msg.slideIndex !== undefined) {
            setState(s => ({
              ...s,
              slideIndex: msg.slideIndex!,
              ...(msg.showSlideNumbers !== undefined ? { showSlideNumbers: msg.showSlideNumbers } : {}),
            }));
          }
          break;
        case 'settings':
          setState(s => ({
            ...s,
            ...(msg.showSlideNumbers !== undefined ? { showSlideNumbers: msg.showSlideNumbers } : {}),
          }));
          break;
        case 'video-command':
          if (msg.videoCommand) {
            setVideoCommand({ ...msg.videoCommand });
          }
          break;
        case 'exit':
          setState(s => ({ ...s, shouldExit: true }));
          break;
      }
    };

    return () => {
      stopLocal();
      ch.close();
    };
  }, []);

  return { ...state, videoCommand };
}
