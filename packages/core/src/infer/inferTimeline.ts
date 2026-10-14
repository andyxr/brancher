import type { Branch, Commit, MergeEvent, Ref, RepoSnapshot, Timeline } from '../types.ts';
import { assignLanes } from './lanes.ts';
import { parseMergeMessage } from './mergeMessage.ts';

export interface InferOptions {
  /** Unix seconds treated as "now". Defaults to the current time. */
  now?: number;
  /** Open branches with no commits for this long are marked abandoned. */
  abandonedAfterDays?: number;
}

/** Min-heap of merge commits, ordered by commit time (oldest first). */
class MergeQueue {
  private items: Commit[] = [];
  push(c: Commit) {
    const a = this.items;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].commitTime <= a[i].commitTime) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Commit | undefined {
    const a = this.items;
    if (a.length <= 1) return a.pop();
    const top = a[0];
    a[0] = a.pop()!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < a.length && a[l].commitTime < a[m].commitTime) m = l;
      if (r < a.length && a[r].commitTime < a[m].commitTime) m = r;
      if (m === i) break;
      [a[m], a[i]] = [a[i], a[m]];
      i = m;
    }
    return top;
  }
}

/**
 * Reconstructs branch history from the commit graph.
 *
 * Every commit is assigned to exactly one branch. The trunk claims its
 * first-parent chain; then merge commits are processed oldest first, and each
 * merged-in parent claims its own first-parent chain until it reaches a commit
 * that's already claimed. That commit is the fork point and its owner is the
 * parent branch. Finally, live refs claim whatever is left as open branches.
 */
export function inferTimeline(snap: RepoSnapshot, opts: InferOptions = {}): Timeline {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const abandonedAfter = (opts.abandonedAfterDays ?? 90) * 86400;
  const { commits } = snap;

  const owner = new Map<string, Branch>();
  const branches: Branch[] = [];
  const byId = new Map<string, Branch>();
  const queue = new MergeQueue();
  const hasLiveRef = new Set<Branch>();
  const tipOf = (b: Branch) => b.commits.at(-1)?.hash ?? b.forkCommit;

  const newBranch = (name: string, nameSource: Branch['nameSource'], fork: string | null): Branch => {
    const parent = fork ? owner.get(fork) : undefined;
    const b: Branch = {
      id: `b${branches.length}`,
      name,
      nameSource,
      parentId: parent?.id ?? null,
      forkCommit: fork,
      forkTime: fork ? commits.get(fork)!.commitTime : null,
      createdAt: 0,
      createdAtSource: 'first-commit',
      mergedAt: null,
      mergedInto: null,
      merges: [],
      status: 'open',
      commits: [],
      lastActivity: 0,
      depth: parent ? parent.depth + 1 : 0,
      lane: 0,
    };
    branches.push(b);
    byId.set(b.id, b);
    return b;
  };

  /** Walks the first-parent chain from `tip` over unclaimed commits. */
  const walk = (tip: string) => {
    const chain: string[] = [];
    let c: string | undefined = tip;
    while (c && commits.has(c) && !owner.has(c)) {
      chain.push(c);
      c = commits.get(c)!.parents[0];
    }
    const stop = c && owner.has(c) ? c : null;
    return { chain: chain.reverse(), stop };
  };

  const claim = (b: Branch, chain: string[]) => {
    for (const h of chain) {
      const c = commits.get(h)!;
      owner.set(h, b);
      b.commits.push({ hash: h, time: c.commitTime, author: c.author, subject: c.subject });
      if (c.parents.length > 1) queue.push(c);
    }
  };

  /**
   * Claims the chain ending at `tip` either as a continuation of the branch it
   * stops on (a long-lived branch merged repeatedly) or as a new branch.
   */
  const attach = (tip: string, name: string | undefined, nameSource: Branch['nameSource'], into: Branch | null) => {
    const { chain, stop } = walk(tip);
    const stopOwner = stop ? owner.get(stop)! : null;
    const continues =
      stopOwner &&
      stopOwner.status !== 'trunk' &&
      stopOwner !== into &&
      tipOf(stopOwner) === stop &&
      (name === undefined || stopOwner.nameSource === 'synthetic' || stopOwner.name === name);
    let b: Branch;
    if (continues) {
      b = stopOwner;
      if (name && b.nameSource === 'synthetic') {
        b.name = name;
        b.nameSource = nameSource;
      }
    } else {
      b = name
        ? newBranch(name, nameSource, stop)
        : newBranch(`branch@${tip.slice(0, 7)}`, 'synthetic', stop);
    }
    claim(b, chain);
    return b;
  };

  const refsByTip = new Map<string, Ref[]>();
  for (const r of snap.refs) {
    const list = refsByTip.get(r.hash) ?? [];
    list.push(r);
    refsByTip.set(r.hash, list);
  }

  const recordMerge = (b: Branch, m: Commit, head: string, into: Branch) => {
    const ev: MergeEvent = { commit: m.hash, head, into: into.id, at: m.commitTime };
    b.merges.push(ev);
  };

  const drain = () => {
    let m: Commit | undefined;
    while ((m = queue.pop())) {
      const into = owner.get(m.hash)!;
      const parsed = parseMergeMessage(m.subject);
      for (let i = 1; i < m.parents.length; i++) {
        const p = m.parents[i];
        if (!commits.has(p)) continue;
        const existing = owner.get(p);
        if (existing) {
          // Syncing a parent (e.g. trunk) into a child isn't a merge of the parent.
          if (existing !== into && !isAncestorBranch(existing, into)) recordMerge(existing, m, p, into);
          continue;
        }
        let name = parsed?.names[i - 1];
        let source: Branch['nameSource'] = 'merge-msg';
        // `git pull` merges someone else's copy of the same branch.
        if (name && name === into.name) name = `${name} (pull)`;
        if (!name) {
          const ref = refsByTip.get(p)?.[0];
          if (ref) {
            name = ref.name;
            source = 'ref';
          }
        }
        const b = attach(p, name, source, into);
        recordMerge(b, m, p, into);
        if (parsed?.prNumber && i === 1 && !b.pr) b.pr = { number: parsed.prNumber };
      }
    }
  };

  const isAncestorBranch = (a: Branch, b: Branch) => {
    for (let cur = b.parentId ? byId.get(b.parentId) : undefined; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur === a) return true;
    }
    return false;
  };

  /** Moves everything owned by `from` into `into` and deletes `from`. */
  const absorb = (into: Branch, from: Branch) => {
    for (const c of from.commits) owner.set(c.hash, into);
    into.commits.push(...from.commits);
    into.commits.sort((a, b) => a.time - b.time);
    into.merges.push(...from.merges);
    if (hasLiveRef.has(from)) hasLiveRef.add(into);
    branches.splice(branches.indexOf(from), 1);
    byId.delete(from.id);
    for (const b of branches) {
      if (b.parentId === from.id) b.parentId = into.id;
      for (const m of b.merges) if (m.into === from.id) m.into = into.id;
    }
  };

  const recomputeDepths = () => {
    const depthOf = (b: Branch): number => {
      const p = b.parentId ? byId.get(b.parentId) : undefined;
      return p ? depthOf(p) + 1 : 0;
    };
    for (const b of branches) b.depth = depthOf(b);
  };

  const carveFastForwards = () => {
    // Newest first: a branch fast-forwarded into a feature that was itself later
    // fast-forwarded into main can only be carved once the feature has been.
    for (const ff of [...snap.fastForwards].reverse()) {
      const source = ff.source.replace(/^(?:origin|upstream)\//, '');
      if (source === ff.target) continue; // syncing a branch with its own remote copy
      const target = owner.get(ff.new);
      // Skip if history was rewritten since, or the commits now belong elsewhere.
      if (!target || target.name !== ff.target) continue;
      const seg: string[] = [];
      let c: string | undefined = ff.new;
      while (c && c !== ff.old && owner.get(c) === target) {
        seg.push(c);
        c = commits.get(c)!.parents[0];
      }
      if (c !== ff.old || !seg.length) continue;
      const segSet = new Set(seg);

      // A branch merged by fast-forward more than once continues where it left off.
      const prev = owner.get(ff.old);
      const b =
        prev && prev !== target && prev.name === source && tipOf(prev) === ff.old
          ? prev
          : newBranch(source, 'merge-msg', ff.old);
      target.commits = target.commits.filter((x) => {
        if (!segSet.has(x.hash)) return true;
        b.commits.push(x);
        owner.set(x.hash, b);
        return false;
      });
      b.commits.sort((x, y) => x.time - y.time);
      b.merges.push({ commit: ff.new, head: ff.new, into: target.id, at: ff.time });
      // If the target's own later merge carried these commits onward, it now ends at its own last commit.
      for (const m of target.merges) if (m.head && segSet.has(m.head) && owner.get(ff.old) === target) m.head = ff.old;

      // Things that happened on the carved commits now belong to the carved branch.
      for (const other of branches) {
        if (other === b) continue;
        if (other.parentId === target.id && other.forkCommit && segSet.has(other.forkCommit)) other.parentId = b.id;
        for (const m of other.merges) {
          if (m.into !== target.id || !segSet.has(m.commit)) continue;
          m.into = b.id;
          // A `git pull` into this branch merged its own remote copy.
          if (other.nameSource === 'merge-msg' && other.name === b.name) other.name = `${b.name} (pull)`;
        }
      }
      // Work continued on the same branch after the merge: one branch, not two.
      const continuation = branches.find((x) => x !== b && x.name === source && x.forkCommit === ff.new);
      if (continuation) absorb(b, continuation);
      // The branch may still exist; its reflog then gives the exact creation time.
      if (snap.refs.some((r) => r.kind === 'local' && r.name === source && r.hash === tipOf(b))) hasLiveRef.add(b);
    }
    recomputeDepths();
  };

  // 1. Trunk.
  const trunkRef = snap.refs.find((r) => r.ref === snap.trunkRef)!;
  const trunk = newBranch(trunkRef.name, 'ref', null);
  trunk.status = 'trunk';
  hasLiveRef.add(trunk);
  claim(trunk, walk(trunkRef.hash).chain);

  // 2. Everything merged into the trunk, recursively.
  drain();

  // 3. Live refs that still have unclaimed commits. Local refs win over remote
  // copies of the same name; a remote ahead of its local copy extends it.
  const refs = [...snap.refs]
    .filter((r) => r.ref !== snap.trunkRef && !(r.kind === 'remote' && r.name === trunkRef.name))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'local' ? -1 : 1));
  const pending: { ref: Ref; key: number; tipTime: number }[] = [];
  for (const r of refs) {
    const owned = owner.get(r.hash);
    if (owned) {
      // An existing branch pointer whose commits were merged: adopt its real name.
      if (tipOf(owned) === r.hash && owned !== trunk && owned.nameSource !== 'ref') {
        owned.name = r.name;
        owned.nameSource = 'ref';
      }
      if (tipOf(owned) === r.hash && owned.name === r.name) hasLiveRef.add(owned);
      continue;
    }
    if (!commits.has(r.hash)) continue;
    const reflog = r.kind === 'local' ? snap.reflogCreations.get(r.name) : undefined;
    const { chain } = walk(r.hash);
    const oldest = commits.get(chain[0])!.commitTime;
    pending.push({ ref: r, key: reflog?.time ?? oldest, tipTime: commits.get(r.hash)!.commitTime });
  }
  // Earliest-started branches claim shared history first; when two branches
  // share a base, the one with more recent work is treated as the parent.
  pending.sort((a, b) => a.key - b.key || b.tipTime - a.tipTime);
  for (const { ref } of pending) {
    const owned = owner.get(ref.hash);
    if (owned) {
      if (tipOf(owned) === ref.hash && owned.name === ref.name) hasLiveRef.add(owned);
      continue;
    }
    const b = attach(ref.hash, ref.name, 'ref', null);
    if (b.nameSource !== 'ref') {
      b.name = ref.name;
      b.nameSource = 'ref';
    }
    hasLiveRef.add(b);
    drain();
  }

  // 3b. Fast-forward merges. Git leaves no merge commit, so the branch's commits
  // were claimed by the branch it was merged into; the reflog says otherwise.
  carveFastForwards();

  // Local branches created from a commit but with no commits of their own yet.
  for (const r of snap.refs) {
    if (r.kind !== 'local' || r.ref === snap.trunkRef) continue;
    const reflog = snap.reflogCreations.get(r.name);
    const owned = owner.get(r.hash);
    if (!reflog || !owned || branches.some((b) => b.name === r.name)) continue;
    const b = newBranch(r.name, 'ref', r.hash);
    hasLiveRef.add(b);
  }

  // 4. Times and status.
  for (const b of branches) {
    const reflog = hasLiveRef.has(b) ? snap.reflogCreations.get(b.name) : undefined;
    if (b === trunk) {
      b.createdAt = b.commits[0]?.time ?? now;
      b.createdAtSource = 'root';
    } else if (reflog) {
      b.createdAt = reflog.time;
      b.createdAtSource = 'reflog';
    } else if (b.commits.length) {
      const firstAuthored = Math.min(...b.commits.map((c) => commits.get(c.hash)!.authorTime));
      b.createdAt = Math.max(firstAuthored, b.forkTime ?? firstAuthored);
      b.createdAtSource = 'first-commit';
    } else {
      b.createdAt = b.forkTime ?? now;
    }
    if (b.forkTime === null && b !== trunk) b.createdAtSource = 'root';
    b.lastActivity = b.commits.length ? Math.max(...b.commits.map((c) => c.time)) : b.createdAt;

    b.merges.sort((x, y) => x.at - y.at);
    const last = b.merges.at(-1);
    if (last) {
      b.mergedAt = last.at;
      b.mergedInto = last.into;
    }
    if (b === trunk) continue;
    const tip = tipOf(b);
    const fullyMerged = !!last && b.merges.some((m) => m.head === tip);
    if (fullyMerged) b.status = 'merged';
    else if (now - b.lastActivity > abandonedAfter) b.status = 'abandoned';
    else b.status = 'open';
  }

  // A branch started from a commit after it was fast-forwarded into another
  // branch was really created from that other branch (e.g. main), not the old feature.
  for (const b of branches) {
    const p = b.parentId ? byId.get(b.parentId) : undefined;
    const ff = p?.merges.find((m) => m.commit === m.head && m.head === b.forkCommit && m.at <= b.createdAt);
    if (ff) b.parentId = ff.into;
  }
  recomputeDepths();

  return finalizeTimeline(branches, trunk.id, now);
}

/** Computes range, stats and lanes. Call again after adding branches. */
export function finalizeTimeline(branches: Branch[], trunkId: string, now: number): Timeline {
  let start = Infinity;
  let end = -Infinity;
  let commitCount = 0;
  for (const b of branches) {
    start = Math.min(start, b.forkTime ?? b.createdAt, b.createdAt);
    end = Math.max(end, b.lastActivity, b.mergedAt ?? -Infinity);
    commitCount += b.commits.length;
  }
  if (!isFinite(start)) start = end = now;
  const range = { start, end };
  assignLanes(branches, trunkId, range);
  return {
    branches,
    trunkId,
    range,
    stats: {
      commits: commitCount,
      branches: branches.length,
      merged: branches.filter((b) => b.status === 'merged' || b.status === 'squashed').length,
      open: branches.filter((b) => b.status === 'open').length,
    },
    generatedAt: now,
  };
}
