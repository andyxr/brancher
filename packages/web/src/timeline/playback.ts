import type { Branch } from '@brancher/core/browser';

/** Wall-clock seconds to replay the whole history at 1×. */
export const BASE_DURATION = 30;

export interface PlaybackClock {
  /** Every event time (unix seconds), sorted and deduped, including the range ends. */
  events: number[];
  start: number;
  end: number;
  duration: number;
  /** Playback progress (0..1) → history time. */
  timeAt(progress: number): number;
  /** History time → playback progress (0..1). */
  progressAt(time: number): number;
}

type EventSource = Pick<Branch, 'forkTime' | 'createdAt' | 'commits' | 'merges'>;

/**
 * Maps playback progress to history time so busy stretches play in real proportion
 * while long idle gaps are squashed to a short beat: each gap between consecutive
 * events counts for at most `cap` seconds of history.
 */
export function buildClock(branches: EventSource[], range: { start: number; end: number }, duration = BASE_DURATION): PlaybackClock {
  const inRange = (t: number) => Math.min(Math.max(t, range.start), range.end);
  const raw = [range.start, range.end];
  for (const b of branches) {
    if (b.forkTime !== null) raw.push(b.forkTime);
    raw.push(b.createdAt);
    for (const c of b.commits) raw.push(c.time);
    for (const m of b.merges) raw.push(m.at);
  }
  const events = [...new Set(raw.map(inRange))].sort((a, b) => a - b);

  const gaps = events.slice(1).map((t, i) => t - events[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const span = range.end - range.start;
  // Long enough that ordinary gaps keep their rhythm, short enough that a quiet month doesn't stall playback.
  const cap = Math.max(median * 4, span / 200);
  const weights = gaps.map((g) => Math.min(g, cap));

  // cum[i] = weighted distance from the first event to events[i].
  const cum = [0];
  for (const w of weights) cum.push(cum[cum.length - 1] + w);
  const total = cum[cum.length - 1];

  const timeAt = (progress: number) => {
    if (total === 0) return events[0];
    const w = Math.min(Math.max(progress, 0), 1) * total;
    const i = segment(cum, w);
    const f = weights[i] === 0 ? 0 : (w - cum[i]) / weights[i];
    return events[i] + f * gaps[i];
  };

  const progressAt = (time: number) => {
    if (total === 0) return time >= events[0] ? 1 : 0;
    const t = inRange(time);
    const i = segment(events, t);
    const f = gaps[i] === 0 ? 0 : (t - events[i]) / gaps[i];
    return (cum[i] + f * weights[i]) / total;
  };

  return { events, start: events[0], end: events[events.length - 1], duration, timeAt, progressAt };
}

/** Index i of the segment [xs[i], xs[i+1]] containing v; xs is ascending with length ≥ 2. */
function segment(xs: number[], v: number): number {
  let lo = 0;
  let hi = xs.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
