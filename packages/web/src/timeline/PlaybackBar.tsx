import { fmtDate } from '../format.ts';
import { SPEEDS, useStore } from '../store.ts';
import type { PlaybackClock } from './playback.ts';

/** Range input resolution; progress is continuous, the slider just needs enough steps to scrub smoothly. */
const STEPS = 1000;

/** Floating transport for animate mode, sitting just above the minimap. */
export function PlaybackBar({ clock }: { clock: PlaybackClock }) {
  const playback = useStore((s) => s.playback);
  const speed = useStore((s) => s.speed);
  const { togglePlay, seek, setSpeed, setFollow, stopAnimate } = useStore();
  if (!playback) return null;

  const btn = 'btn rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10';
  return (
    <div
      className="glass playback-bar absolute bottom-[92px] left-4 z-30 flex items-center gap-2 rounded-xl px-2 py-1.5 shadow-2xl shadow-black/50"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button onClick={togglePlay} className={`${btn} w-8`} title={playback.playing ? 'Pause (space)' : 'Play (space)'}>
        {playback.playing ? '❚❚' : '▶'}
      </button>
      <button onClick={() => seek(clock.start)} className={btn} title="Back to the start">
        ⏮
      </button>
      <input
        type="range"
        min={0}
        max={STEPS}
        value={Math.round(clock.progressAt(playback.t) * STEPS)}
        onChange={(e) => seek(clock.timeAt(Number(e.target.value) / STEPS))}
        className="playback-scrub w-56"
        aria-label="Playback position"
      />
      <span className="w-28 text-center font-mono text-[11px] tabular-nums text-slate-300">{fmtDate(playback.t)}</span>
      <div className="segmented flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] transition ${
              s === speed ? 'on bg-white/15 text-white' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <button
        onClick={() => setFollow(!playback.follow)}
        className={`${btn} ${playback.follow ? 'lit' : ''}`}
        title={playback.follow ? 'Camera follows the playhead' : 'Follow the playhead again'}
      >
        Follow
      </button>
      <button onClick={stopAnimate} className={btn} title="Exit animate (esc)">
        ✕
      </button>
    </div>
  );
}
