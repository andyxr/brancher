import type { Branch } from '../types.ts';

/** The time interval a branch occupies on screen. */
export function branchSpan(b: Branch, end: number): [number, number] {
  const start = b.forkTime ?? b.createdAt;
  const stop = b.status === 'open' || b.status === 'trunk' ? end : (b.mergedAt ?? b.lastActivity);
  return [start, Math.max(stop, start)];
}

/**
 * Greedy interval packing. Branches are visited depth-first from the trunk,
 * children in creation order, and each takes the first free lane below its
 * parent, so nested branches stay visually grouped under the branch they came from.
 */
export function assignLanes(branches: Branch[], trunkId: string, range: { start: number; end: number }): void {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const children = new Map<string, Branch[]>();
  const roots: Branch[] = [];
  for (const b of branches) {
    if (b.parentId && byId.has(b.parentId)) {
      const list = children.get(b.parentId) ?? [];
      list.push(b);
      children.set(b.parentId, list);
    } else if (b.id !== trunkId) {
      roots.push(b);
    }
  }
  const startOf = (b: Branch) => b.forkTime ?? b.createdAt;
  for (const list of children.values()) list.sort((a, b) => startOf(a) - startOf(b));
  roots.sort((a, b) => startOf(a) - startOf(b));

  const pad = Math.max((range.end - range.start) * 0.004, 60);
  const lanes: [number, number][][] = [];
  const fits = (lane: number, s: number, e: number) =>
    !(lanes[lane] ?? []).some(([a, b]) => s < b + pad && a < e + pad);

  const place = (b: Branch, minLane: number) => {
    const [s, e] = branchSpan(b, range.end);
    let lane = minLane;
    while (!fits(lane, s, e)) lane++;
    (lanes[lane] ??= []).push([s, e]);
    b.lane = lane;
    for (const c of children.get(b.id) ?? []) place(c, lane + 1);
  };

  const trunk = byId.get(trunkId);
  if (trunk) place(trunk, 0);
  // Orphan histories (unrelated roots) go below everything else.
  for (const r of roots) place(r, 1);
}
