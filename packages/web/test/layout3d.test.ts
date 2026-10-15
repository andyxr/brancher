import { describe, expect, it } from 'vitest';
import { buildClock } from '../src/timeline/playback.ts';
import { buildLayout3d, FORK_Z, LENGTH, RADIUS } from '../src/timeline3d/layout3d.ts';

type Status = 'trunk' | 'merged' | 'open' | 'abandoned' | 'squashed';

const branch = (
  id: string,
  o: { parentId?: string; forkTime?: number; createdAt: number; commits?: number[]; merges?: { into: string; at: number; head?: number }[]; status: Status; depth: number; lane: number },
) => ({
  id,
  parentId: o.parentId ?? null,
  forkTime: o.forkTime ?? null,
  createdAt: o.createdAt,
  lastActivity: Math.max(o.createdAt, ...(o.commits ?? [])),
  commits: (o.commits ?? []).map((time, i) => ({ hash: `${id}-${i}`, time, author: 'a', subject: 's' })),
  merges: (o.merges ?? []).map((m, i) => ({ commit: `${id}-m${i}`, head: m.head === undefined ? null : `${id}-${m.head}`, into: m.into, at: m.at })),
  status: o.status,
  depth: o.depth,
  lane: o.lane,
});

const range = { start: 0, end: 1000 };
const trunk = branch('trunk', { createdAt: 0, commits: [100, 500, 900], status: 'trunk', depth: 0, lane: 0 });
const feature = branch('feature', {
  parentId: 'trunk',
  forkTime: 100,
  createdAt: 100,
  commits: [200, 300],
  merges: [{ into: 'trunk', at: 400, head: 1 }],
  status: 'merged',
  depth: 1,
  lane: 1,
});
const nested = branch('nested', { parentId: 'feature', forkTime: 250, createdAt: 250, commits: [260], status: 'open', depth: 2, lane: 2 });
const all = [trunk, feature, nested];
const clock = buildClock(all, range);
const layout = buildLayout3d(all, 'trunk', clock);
const pathOf = (id: string) => layout.branches.find((b) => b.id === id)!.path;
const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

describe('buildLayout3d', () => {
  it('puts the trunk on the axis for the whole history', () => {
    const path = pathOf('trunk');
    expect(path.every((p) => p.x === 0 && p.y === 0)).toBe(true);
    expect([path[0].z, path.at(-1)!.z]).toEqual([0, LENGTH]);
  });

  it('places each branch at depth × RADIUS once its fork has eased out', () => {
    expect(radius(pathOf('feature').at(-1)!)).toBeCloseTo(RADIUS);
    expect(radius(pathOf('nested').at(-1)!)).toBeCloseTo(2 * RADIUS);
  });

  it('starts a fork at the parent position at fork time', () => {
    const fork = pathOf('nested')[0];
    const parentEnd = pathOf('feature').at(-1)!;
    expect(fork.z).toBeCloseTo(clock.progressAt(250) * LENGTH);
    expect(fork.x).toBeCloseTo(parentEnd.x);
    expect(fork.y).toBeCloseTo(parentEnd.y);
    expect(radius(pathOf('feature')[0])).toBe(0);
  });

  it('lands a merge on the target branch at merge time', () => {
    const merge = layout.merges.find((m) => m.branchId === 'feature')!;
    const end = merge.path.at(-1)!;
    expect(merge.into).toBe('trunk');
    expect([end.x, end.y]).toEqual([0, 0]);
    expect(end.z).toBeCloseTo(clock.progressAt(400) * LENGTH);
    expect(merge.path[0].z).toBeCloseTo(clock.progressAt(300) * LENGTH);
  });

  it('keeps z monotonic in time along every path', () => {
    for (const path of [...layout.branches, ...layout.merges].map((b) => b.path)) {
      for (let i = 1; i < path.length; i++) {
        expect(path[i].z).toBeGreaterThanOrEqual(path[i - 1].z);
        expect(path[i].t).toBeGreaterThanOrEqual(path[i - 1].t);
      }
    }
  });

  it('runs an open branch to the end of the range and stops a merged one at its last commit', () => {
    expect(pathOf('nested').at(-1)!.z).toBe(LENGTH);
    expect(pathOf('nested').at(-1)!.t).toBe(range.end);
    expect(pathOf('feature').at(-1)!.z).toBeCloseTo(clock.progressAt(300) * LENGTH);
  });

  it('places commits on their branch, sorted by z', () => {
    expect(layout.commits.map((c) => c.hash)).toEqual(['trunk-0', 'feature-0', 'nested-0', 'feature-1', 'trunk-1', 'trunk-2']);
    const c = layout.commits.find((c) => c.hash === 'feature-0')!;
    expect(c.z).toBeGreaterThan(clock.progressAt(100) * LENGTH + FORK_Z);
    expect(radius(c)).toBeCloseTo(RADIUS);
  });

  it('skips merges into branches that are filtered out', () => {
    const solo = buildLayout3d([feature], 'trunk', buildClock([feature], range));
    expect(solo.merges).toEqual([]);
    expect(radius(solo.branches[0].path[0])).toBeCloseTo(RADIUS);
  });
});
