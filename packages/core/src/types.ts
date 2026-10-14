/** A commit as read from `git log`. Times are unix seconds. */
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authorTime: number;
  commitTime: number;
  subject: string;
}

export interface Ref {
  /** Full ref name, e.g. `refs/heads/main` or `refs/remotes/origin/feature/x`. */
  ref: string;
  /** Short display name with any remote prefix stripped, e.g. `feature/x`. */
  name: string;
  hash: string;
  kind: 'local' | 'remote';
  remote?: string;
}

export interface ReflogCreation {
  /** Unix seconds when the branch was created, per the reflog. */
  time: number;
  /** The start point named in `branch: Created from <x>`, if any. */
  from?: string;
}

/** A `merge <source>: Fast-forward` reflog entry: `target` slid from `old` to `new`. */
export interface FastForward {
  target: string;
  source: string;
  old: string;
  new: string;
  time: number;
}

/** Everything inference needs, extracted from a repository in one pass. */
export interface RepoSnapshot {
  commits: Map<string, Commit>;
  refs: Ref[];
  /** Full ref name of the default branch (the trunk). */
  trunkRef: string;
  /** Keyed by short branch name; only available for local repos with reflogs. */
  reflogCreations: Map<string, ReflogCreation>;
  /** Fast-forward merges recorded in local reflogs. They leave no trace in the commit graph. */
  fastForwards: FastForward[];
}

export type BranchStatus = 'merged' | 'squashed' | 'open' | 'abandoned' | 'trunk';
export type NameSource = 'ref' | 'merge-msg' | 'pr' | 'synthetic';
export type CreatedAtSource = 'reflog' | 'first-commit' | 'pr' | 'root';

export interface CommitRef {
  hash: string;
  time: number;
  author: string;
  subject: string;
}

export interface MergeEvent {
  /** The merge commit (or squash commit) on the target branch. */
  commit: string;
  /** The branch commit that was merged, or null for squash merges. */
  head: string | null;
  into: string;
  at: number;
}

export interface PullRequestInfo {
  number: number;
  url?: string;
  title?: string;
  author?: string;
  createdAt?: number;
  mergedAt?: number;
}

export interface Branch {
  id: string;
  name: string;
  nameSource: NameSource;
  parentId: string | null;
  /** Commit on the parent branch this branch forked from. */
  forkCommit: string | null;
  forkTime: number | null;
  createdAt: number;
  createdAtSource: CreatedAtSource;
  /** Time of the last merge back, if any. */
  mergedAt: number | null;
  mergedInto: string | null;
  merges: MergeEvent[];
  status: BranchStatus;
  /** Commits unique to this branch, oldest first. */
  commits: CommitRef[];
  /** Time of the newest commit on the branch (or createdAt if none). */
  lastActivity: number;
  depth: number;
  lane: number;
  pr?: PullRequestInfo;
}

export interface Timeline {
  branches: Branch[];
  trunkId: string;
  range: { start: number; end: number };
  stats: { commits: number; branches: number; merged: number; open: number };
  generatedAt: number;
}
