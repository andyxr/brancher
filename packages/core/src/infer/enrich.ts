import type { Branch, RepoSnapshot, Timeline } from '../types.ts';
import { finalizeTimeline } from './inferTimeline.ts';

/** A pull request, normalized from the GitHub API. Times are unix seconds. */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author?: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  createdAt: number;
  mergedAt?: number;
  headRefName: string;
  baseRefName: string;
  mergeCommit?: string;
  /** Authored time of the PR's first commit, if known. */
  firstCommitAt?: number;
}

/**
 * Layers pull request data onto an inferred timeline: names and links for
 * merge commits we already found, and synthetic branches for squash and rebase
 * merges, which leave no trace in the commit graph.
 */
export function enrichWithPullRequests(timeline: Timeline, snap: RepoSnapshot, prs: PullRequest[]): Timeline {
  const branches = [...timeline.branches];
  const owner = new Map<string, Branch>();
  const byMergeCommit = new Map<string, Branch[]>();
  const byPrNumber = new Map<number, Branch>();
  for (const b of branches) {
    for (const c of b.commits) owner.set(c.hash, b);
    for (const m of b.merges) {
      const list = byMergeCommit.get(m.commit) ?? [];
      list.push(b);
      byMergeCommit.set(m.commit, list);
    }
    if (b.pr) byPrNumber.set(b.pr.number, b);
  }

  const attachPr = (b: Branch, pr: PullRequest) => {
    b.pr = {
      number: pr.number,
      url: pr.url,
      title: pr.title,
      author: pr.author,
      createdAt: pr.createdAt,
      mergedAt: pr.mergedAt,
    };
    if (b.nameSource === 'synthetic') {
      b.name = pr.headRefName;
      b.nameSource = 'pr';
    }
  };

  for (const pr of prs) {
    let match = byPrNumber.get(pr.number);
    if (!match && pr.mergeCommit) {
      const candidates = byMergeCommit.get(pr.mergeCommit) ?? [];
      match = candidates.find((b) => b.name === pr.headRefName) ?? candidates[0];
    }
    if (!match && pr.state === 'OPEN') {
      match = branches.find((b) => b.name === pr.headRefName && (b.status === 'open' || b.status === 'abandoned'));
    }
    if (match) {
      attachPr(match, pr);
      continue;
    }

    // Squash or rebase merge: the merge commit is an ordinary commit on the target.
    if (pr.state !== 'MERGED' || !pr.mergeCommit || !pr.mergedAt) continue;
    const mc = snap.commits.get(pr.mergeCommit);
    const target = mc && owner.get(mc.hash);
    if (!mc || !target || mc.parents.length !== 1) continue;

    // Fork from the last target commit before work on the PR began.
    const startedAt = Math.min(pr.firstCommitAt ?? pr.createdAt, pr.createdAt);
    let fork: string | null = null;
    let forkTime: number | null = null;
    for (const c of target.commits) {
      if (c.time > startedAt || c.hash === mc.hash) break;
      fork = c.hash;
      forkTime = c.time;
    }
    if (!fork) {
      fork = mc.parents[0] && owner.has(mc.parents[0]) ? mc.parents[0] : null;
      forkTime = fork ? snap.commits.get(fork)!.commitTime : null;
    }

    const b: Branch = {
      id: `pr${pr.number}`,
      name: pr.headRefName,
      nameSource: 'pr',
      parentId: target.id,
      forkCommit: fork,
      forkTime,
      createdAt: Math.max(startedAt, forkTime ?? startedAt),
      createdAtSource: 'pr',
      mergedAt: pr.mergedAt,
      mergedInto: target.id,
      merges: [{ commit: mc.hash, head: null, into: target.id, at: mc.commitTime }],
      status: 'squashed',
      commits: [],
      lastActivity: mc.commitTime,
      depth: target.depth + 1,
      lane: 0,
    };
    attachPr(b, pr);
    branches.push(b);
  }

  return finalizeTimeline(branches, timeline.trunkId, timeline.generatedAt);
}
