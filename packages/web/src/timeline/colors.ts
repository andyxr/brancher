import type { Branch } from '@brancher/core/browser';
import type { Palette } from '../theme.ts';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable color per branch name; deeper branches are slightly lighter. */
export function branchColor(b: Pick<Branch, 'name' | 'status' | 'depth'>, p: Palette): string {
  if (b.status === 'trunk') return p.trunk;
  const { saturation, lightness, lightnessMax, swatches } = p.branch;
  if (swatches) {
    const sw = swatches[hash(b.name) % swatches.length];
    return `hsl(${sw.h} ${sw.s}% ${Math.min(sw.l + b.depth * 4, lightnessMax)}%)`;
  }
  // Skip the cyan band so feature branches never look like the trunk.
  let hue = hash(b.name) % 300;
  if (hue > 165) hue += 60;
  const light = Math.min(lightness + b.depth * 4, lightnessMax);
  return `hsl(${hue} ${saturation}% ${light}%)`;
}

export const STATUS_LABEL: Record<Branch['status'], string> = {
  trunk: 'Trunk',
  merged: 'Merged',
  squashed: 'Squash-merged',
  open: 'Open',
  abandoned: 'Abandoned',
};

export const STATUS_CLASS: Record<Branch['status'], string> = {
  trunk: 'bg-cyan-400/15 text-cyan-300 ring-cyan-400/30',
  merged: 'bg-violet-400/15 text-violet-300 ring-violet-400/30',
  squashed: 'bg-fuchsia-400/15 text-fuchsia-300 ring-fuchsia-400/30',
  open: 'bg-lime-400/15 text-lime-300 ring-lime-400/30',
  abandoned: 'bg-slate-400/10 text-slate-400 ring-slate-400/20',
};
