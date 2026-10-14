// Browser-safe subset of core (no node:child_process / fs imports).
export * from './types.ts';
export { assignLanes, branchSpan } from './infer/lanes.ts';
