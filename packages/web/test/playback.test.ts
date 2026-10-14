import { describe, expect, it } from 'vitest';
import { buildClock } from '../src/timeline/playback.ts';

const DAY = 86400;

const branch = (createdAt: number, commits: number[] = [], merges: number[] = [], forkTime: number | null = null) => ({
  forkTime,
  createdAt,
  commits: commits.map((time, i) => ({ hash: `c${createdAt}-${i}`, time, author: 'a', subject: 's' })),
  merges: merges.map((at, i) => ({ commit: `m${i}`, head: null, into: 'trunk', at })),
});

describe('buildClock', () => {
  it('collects sorted, deduped event times including the range ends', () => {
    const clock = buildClock([branch(0, [30, 10, 10]), branch(20, [], [40], 5)], { start: 0, end: 50 });
    expect(clock.events).toEqual([0, 5, 10, 20, 30, 40, 50]);
    expect([clock.start, clock.end]).toEqual([0, 50]);
  });

  it('keeps evenly spaced events proportional', () => {
    const clock = buildClock([branch(0, [DAY, 2 * DAY, 3 * DAY])], { start: 0, end: 4 * DAY });
    expect(clock.progressAt(DAY)).toBeCloseTo(0.25);
    expect(clock.progressAt(2.5 * DAY)).toBeCloseTo(0.625);
  });

  it('squashes a long idle gap to the same beat as a busy day', () => {
    // A commit every day for 10 days, then a year of nothing, then one more commit.
    const days = Array.from({ length: 11 }, (_, i) => i * DAY);
    const clock = buildClock([branch(0, [...days, 375 * DAY])], { start: 0, end: 375 * DAY });
    // Without compression the first 10 days would be ~3% of playback.
    expect(clock.progressAt(10 * DAY)).toBeGreaterThan(0.6);
    const busyStep = clock.progressAt(DAY) - clock.progressAt(0);
    const idleStep = clock.progressAt(375 * DAY) - clock.progressAt(10 * DAY);
    expect(idleStep).toBeLessThan(busyStep * 5);
  });

  it('round-trips progress and time', () => {
    const clock = buildClock([branch(0, [100, 150, 9000, 9100]), branch(120, [], [9500])], { start: 0, end: 10000 });
    for (const p of [0, 0.1, 0.33, 0.5, 0.77, 1]) expect(clock.progressAt(clock.timeAt(p))).toBeCloseTo(p, 9);
  });

  it('maps progress 0 and 1 to the range ends', () => {
    const clock = buildClock([branch(10, [20])], { start: 0, end: 1000 });
    expect(clock.timeAt(0)).toBe(0);
    expect(clock.timeAt(1)).toBe(1000);
    expect(clock.progressAt(-5)).toBe(0);
    expect(clock.progressAt(5000)).toBe(1);
  });

  it('handles a single-instant history', () => {
    const clock = buildClock([branch(7)], { start: 7, end: 7 });
    expect(clock.timeAt(0.5)).toBe(7);
    expect(clock.progressAt(7)).toBe(1);
  });
});
