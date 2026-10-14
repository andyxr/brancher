import { useEffect, useState } from 'react';
import { useStore } from '../store.ts';
import type { PlaybackClock } from './playback.ts';

/** Advances the playhead every animation frame while playing; exits animate at the end, leaving the full static view. */
export function usePlayback(clock: PlaybackClock) {
  const playing = useStore((s) => s.playback?.playing ?? false);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { playback, speed, seek, stopAnimate } = useStore.getState();
      if (!playback?.playing) return;
      const progress = Math.min(clock.progressAt(playback.t) + (dt * speed) / clock.duration, 1);
      if (progress >= 1) return stopAnimate();
      seek(clock.timeAt(progress));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clock]);
}

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
