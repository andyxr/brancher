import type { Branch } from '@brancher/core/browser';
import type { PlaybackClock } from '../timeline/playback.ts';

/** Tunnel length in world units; z = playback progress × LENGTH, so the camera flies at constant speed. */
export const LENGTH = 500;
/** Radial distance per level of branch depth. */
export const RADIUS = 6;
/** How far along z a fork eases out from its parent to its own radial position. */
export const FORK_Z = 6;
const ARC_STEPS = 10;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A point in the tunnel; `t` is the history time (unix seconds) it stands for. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
  t: number;
}

export interface Branch3d {
  id: string;
  /** Fork arc from the parent, then straight along z to where the branch stops. */
  path: Point3[];
}

export interface Commit3d extends Point3 {
  branchId: string;
  hash: string;
}

export interface Merge3d {
  branchId: string;
  into: string;
  /** Arc from the merged commit to the target branch at merge time. */
  path: Point3[];
}

export interface Event3d {
  x: number;
  y: number;
  z: number;
  branchId: string;
}

export interface Layout3d {
  branches: Branch3d[];
  /** Sorted by z. */
  commits: Commit3d[];
  merges: Merge3d[];
  /** Anything a branch did (fork, commit, merge), sorted by z; drives flashes and labels near the playhead. */
  events: Event3d[];
  maxRadius: number;
}

type Source = Pick<
  Branch,
  'id' | 'parentId' | 'forkTime' | 'createdAt' | 'lastActivity' | 'commits' | 'merges' | 'status' | 'depth' | 'lane'
>;

const smooth = (f: number) => f * f * (3 - 2 * f);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export function buildLayout3d(branches: Source[], trunkId: string, clock: PlaybackClock): Layout3d {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const zOf = (t: number) => clock.progressAt(t) * LENGTH;
  const point = (x: number, y: number, z: number): Point3 => ({ x, y, z, t: clock.timeAt(z / LENGTH) });

  const home = (b: Source) => {
    if (b.id === trunkId) return { x: 0, y: 0 };
    const r = b.depth * RADIUS;
    const a = b.lane * GOLDEN_ANGLE;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  };
  const parentOf = (b: Source) => (b.id !== trunkId && b.parentId ? byId.get(b.parentId) : undefined);

  /** Radial position of a branch at depth z, easing out from its parent just after the fork. */
  const posAt = (b: Source, z: number): { x: number; y: number } => {
    const own = home(b);
    const parent = parentOf(b);
    if (!parent || b.forkTime === null) return own;
    const zf = zOf(b.forkTime);
    if (z >= zf + FORK_Z) return own;
    const from = posAt(parent, zf);
    const f = smooth(Math.min(Math.max((z - zf) / FORK_Z, 0), 1));
    return { x: lerp(from.x, own.x, f), y: lerp(from.y, own.y, f) };
  };

  const out: Layout3d = { branches: [], commits: [], merges: [], events: [], maxRadius: 0 };

  for (const b of branches) {
    const own = home(b);
    out.maxRadius = Math.max(out.maxRadius, Math.hypot(own.x, own.y));
    const parent = parentOf(b);
    const live = b.id === trunkId || b.status === 'open';
    const commitTime = new Map(b.commits.map((c) => [c.hash, c.time]));

    const merges = b.merges
      .filter((m) => byId.has(m.into))
      .map((m) => {
        const zm = zOf(m.at);
        const headTime = m.head ? (commitTime.get(m.head) ?? b.lastActivity) : m.at;
        return { m, zm, zh: Math.min(zOf(headTime), zm) };
      });

    const path: Point3[] = [];
    let zStart: number;
    if (parent && b.forkTime !== null) {
      zStart = zOf(b.forkTime);
      for (let i = 0; i <= ARC_STEPS; i++) {
        const z = zStart + (FORK_Z * i) / ARC_STEPS;
        const p = posAt(b, z);
        path.push(point(p.x, p.y, z));
      }
      out.events.push({ ...path[0], branchId: b.id });
    } else {
      zStart = b.id === trunkId ? 0 : zOf(b.createdAt);
      path.push(point(own.x, own.y, zStart));
    }
    const zEnd = live ? LENGTH : Math.max(zOf(b.lastActivity), ...merges.map((m) => m.zh));
    if (zEnd > path[path.length - 1].z) path.push(point(own.x, own.y, zEnd));
    out.branches.push({ id: b.id, path });

    for (const c of b.commits) {
      const z = zOf(c.time);
      const p = posAt(b, z);
      out.commits.push({ x: p.x, y: p.y, z, t: c.time, branchId: b.id, hash: c.hash });
      out.events.push({ x: p.x, y: p.y, z, branchId: b.id });
    }

    for (const { m, zm, zh } of merges) {
      const from = posAt(b, zh);
      const to = posAt(byId.get(m.into)!, zm);
      const arc: Point3[] = [];
      for (let i = 0; i <= ARC_STEPS; i++) {
        const f = i / ARC_STEPS;
        const s = smooth(f);
        arc.push(point(lerp(from.x, to.x, s), lerp(from.y, to.y, s), lerp(zh, zm, f)));
      }
      out.merges.push({ branchId: b.id, into: m.into, path: arc });
      out.events.push({ ...arc[arc.length - 1], branchId: b.id });
    }
  }

  out.commits.sort((a, b) => a.z - b.z);
  out.events.sort((a, b) => a.z - b.z);
  return out;
}

/** Where a path is at depth z, clamped to its ends. */
export function pointAt(path: Point3[], z: number): Point3 {
  if (z <= path[0].z) return path[0];
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    if (z <= b.z) {
      const f = b.z === a.z ? 1 : (z - a.z) / (b.z - a.z);
      return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z, t: lerp(a.t, b.t, f) };
    }
  }
  return path[path.length - 1];
}

/** First index in a z-sorted list whose z is ≥ `z`. */
export function lowerBound(xs: { z: number }[], z: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid].z < z) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
