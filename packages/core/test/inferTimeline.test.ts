import { afterEach, describe, expect, it } from 'vitest';
import { enrichWithPullRequests } from '../src/infer/enrich.ts';
import { inferTimeline } from '../src/infer/inferTimeline.ts';
import { readSnapshot } from '../src/git.ts';
import type { Timeline } from '../src/types.ts';
import { FixtureRepo, HOUR } from './fixtureRepo.ts';

let repo: FixtureRepo;
afterEach(() => repo?.cleanup());

async function analyze(r: FixtureRepo, now = r.time + HOUR) {
  const snap = await readSnapshot(r.dir);
  const tl = inferTimeline(snap, { now });
  // Every commit belongs to exactly one branch.
  const owned = tl.branches.flatMap((b) => b.commits.map((c) => c.hash));
  expect(new Set(owned).size).toBe(owned.length);
  expect(owned.length).toBe(snap.commits.size);
  return { snap, tl };
}

const byName = (tl: Timeline, name: string) => {
  const b = tl.branches.find((x) => x.name === name);
  if (!b) throw new Error(`no branch ${name}: ${tl.branches.map((x) => x.name).join(', ')}`);
  return b;
};

describe('inferTimeline', () => {
  it('finds a merged feature branch with exact reflog creation time', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    const fork = await repo.commit();
    const created = await repo.branch('feature');
    await repo.commit();
    await repo.commit();
    await repo.checkout('main');
    await repo.commit();
    const merge = await repo.merge('feature');

    const { tl } = await analyze(repo);
    expect(tl.branches).toHaveLength(2);
    const main = byName(tl, 'main');
    const feature = byName(tl, 'feature');
    expect(main.status).toBe('trunk');
    expect(main.lane).toBe(0);
    expect(feature).toMatchObject({
      parentId: main.id,
      forkCommit: fork,
      createdAt: created,
      createdAtSource: 'reflog',
      mergedInto: main.id,
      status: 'merged',
      depth: 1,
    });
    expect(feature.merges).toEqual([expect.objectContaining({ commit: merge, into: main.id })]);
    expect(feature.commits).toHaveLength(2);
    expect(feature.lane).toBeGreaterThan(0);
  });

  it('recovers deleted branches from merge messages', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('feature/login');
    const first = await repo.commit();
    await repo.checkout('main');
    await repo.merge('feature/login');
    await repo.deleteBranch('feature/login');

    const { tl, snap } = await analyze(repo);
    const b = byName(tl, 'feature/login');
    expect(b.nameSource).toBe('merge-msg');
    expect(b.createdAtSource).toBe('first-commit');
    expect(b.createdAt).toBe(snap.commits.get(first)!.authorTime);
    expect(b.status).toBe('merged');
  });

  it('nests a branch created from a feature branch', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('feature');
    const fork = await repo.commit();
    await repo.branch('sub');
    await repo.commit();
    await repo.checkout('feature');
    await repo.commit();
    await repo.merge('sub');
    await repo.checkout('main');
    await repo.merge('feature');

    const { tl } = await analyze(repo);
    const feature = byName(tl, 'feature');
    const sub = byName(tl, 'sub');
    expect(sub).toMatchObject({ parentId: feature.id, forkCommit: fork, mergedInto: feature.id, depth: 2 });
    expect(sub.lane).toBeGreaterThan(feature.lane);
  });

  it('keeps the parent when the parent branch merges first', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('parent');
    const fork = await repo.commit();
    await repo.branch('child');
    await repo.commit();
    await repo.checkout('parent');
    await repo.commit();
    await repo.checkout('main');
    await repo.merge('parent');
    await repo.merge('child');

    const { tl } = await analyze(repo);
    const parent = byName(tl, 'parent');
    const child = byName(tl, 'child');
    expect(child.parentId).toBe(parent.id);
    expect(child.forkCommit).toBe(fork);
    expect(child.commits).toHaveLength(1);
    expect(parent.commits).toHaveLength(2);
  });

  it('does not invent a branch when the trunk is merged into a feature', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('feature');
    await repo.commit();
    await repo.checkout('main');
    await repo.commit();
    await repo.checkout('feature');
    await repo.merge('main');
    await repo.commit();
    await repo.checkout('main');
    await repo.merge('feature');

    const { tl } = await analyze(repo);
    expect(tl.branches.map((b) => b.name).sort()).toEqual(['feature', 'main']);
    expect(byName(tl, 'feature').merges).toHaveLength(1);
  });

  it('handles octopus merges', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('a');
    await repo.commit();
    await repo.checkout('main');
    await repo.branch('b');
    await repo.commit();
    await repo.checkout('main');
    const merge = await repo.merge('a', 'b');

    const { tl } = await analyze(repo);
    for (const name of ['a', 'b']) {
      expect(byName(tl, name)).toMatchObject({ status: 'merged', merges: [expect.objectContaining({ commit: merge })] });
    }
  });

  it('treats a long-lived branch merged repeatedly as one branch', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('develop');
    await repo.commit();
    await repo.checkout('main');
    await repo.merge('develop');
    await repo.checkout('develop');
    await repo.commit();
    await repo.checkout('main');
    await repo.merge('develop');

    const { tl } = await analyze(repo);
    expect(tl.branches).toHaveLength(2);
    const develop = byName(tl, 'develop');
    expect(develop.merges).toHaveLength(2);
    expect(develop.commits).toHaveLength(2);
    expect(develop.status).toBe('merged');
  });

  it('marks unmerged branches open, and stale ones abandoned', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('stale');
    await repo.commit();
    await repo.checkout('main');
    repo.tick(24 * 200);
    await repo.branch('wip');
    await repo.commit();

    const { tl } = await analyze(repo);
    expect(byName(tl, 'wip').status).toBe('open');
    expect(byName(tl, 'stale').status).toBe('abandoned');
  });

  it('survives criss-cross merges', async () => {
    repo = await FixtureRepo.create();
    await repo.commit();
    await repo.branch('x');
    await repo.commit();
    await repo.checkout('main');
    await repo.branch('y');
    await repo.commit();
    await repo.merge('x');
    await repo.checkout('x');
    await repo.merge('y~1');
    await repo.checkout('main');
    await repo.merge('x', 'y');

    const { tl } = await analyze(repo);
    expect(tl.branches.length).toBeGreaterThanOrEqual(3);
  });

  describe('fast-forward merges (recovered from the reflog)', () => {
    it('carves a fast-forwarded branch out of the trunk', async () => {
      repo = await FixtureRepo.create();
      await repo.commit();
      const fork = await repo.commit();
      const created = await repo.branch('midi');
      await repo.commit();
      await repo.commit();
      await repo.checkout('main');
      const mergedAt = await repo.mergeFastForward('midi');
      await repo.commit(); // trunk carries on

      const { tl } = await analyze(repo);
      const main = byName(tl, 'main');
      const midi = byName(tl, 'midi');
      expect(midi).toMatchObject({
        parentId: main.id,
        forkCommit: fork,
        createdAt: created,
        createdAtSource: 'reflog',
        mergedAt,
        mergedInto: main.id,
        status: 'merged',
      });
      expect(midi.commits).toHaveLength(2);
      expect(main.commits).toHaveLength(3);
    });

    it('recovers a fast-forwarded branch that was deleted', async () => {
      repo = await FixtureRepo.create();
      await repo.commit();
      await repo.branch('gone');
      await repo.commit();
      await repo.checkout('main');
      await repo.mergeFastForward('gone');
      await repo.deleteBranch('gone');

      const { tl } = await analyze(repo);
      expect(byName(tl, 'gone')).toMatchObject({ status: 'merged', createdAtSource: 'first-commit' });
    });

    it('treats repeated fast-forwards of one branch as one branch', async () => {
      repo = await FixtureRepo.create();
      await repo.commit();
      await repo.branch('dev');
      await repo.commit();
      await repo.checkout('main');
      await repo.mergeFastForward('dev');
      await repo.checkout('dev');
      await repo.commit();
      await repo.checkout('main');
      await repo.mergeFastForward('dev');

      const { tl } = await analyze(repo);
      expect(tl.branches.filter((b) => b.name === 'dev')).toHaveLength(1);
      const dev = byName(tl, 'dev');
      expect(dev.merges).toHaveLength(2);
      expect(dev.commits).toHaveLength(2);
      expect(dev.status).toBe('merged');
    });

    it('keeps work done after a fast-forward on the same branch', async () => {
      repo = await FixtureRepo.create();
      await repo.commit();
      await repo.branch('feat');
      await repo.commit();
      await repo.checkout('main');
      await repo.mergeFastForward('feat');
      await repo.checkout('feat');
      await repo.commit(); // not merged yet

      const { tl } = await analyze(repo);
      expect(tl.branches.filter((b) => b.name === 'feat')).toHaveLength(1);
      expect(byName(tl, 'feat')).toMatchObject({ status: 'open', merges: [expect.anything()] });
      expect(byName(tl, 'feat').commits).toHaveLength(2);
    });

    it('handles a fast-forward into a branch that is then fast-forwarded into main', async () => {
      repo = await FixtureRepo.create();
      await repo.commit();
      await repo.branch('optimise');
      await repo.commit();
      await repo.branch('sample');
      await repo.commit();
      await repo.checkout('optimise');
      await repo.mergeFastForward('sample');
      await repo.checkout('main');
      await repo.mergeFastForward('optimise');

      const { tl } = await analyze(repo);
      const main = byName(tl, 'main');
      const optimise = byName(tl, 'optimise');
      expect(optimise).toMatchObject({ parentId: main.id, mergedInto: main.id, status: 'merged' });
      expect(byName(tl, 'sample')).toMatchObject({ parentId: optimise.id, mergedInto: optimise.id, status: 'merged', depth: 2 });
    });

    it('nests a branch fast-forwarded into a feature branch', async () => {
      repo = await FixtureRepo.create();
      await repo.commit();
      await repo.branch('feature');
      await repo.commit();
      await repo.branch('sub');
      await repo.commit();
      await repo.checkout('feature');
      await repo.mergeFastForward('sub');
      await repo.commit();
      await repo.checkout('main');
      await repo.merge('feature');

      const { tl } = await analyze(repo);
      const feature = byName(tl, 'feature');
      expect(byName(tl, 'sub')).toMatchObject({ parentId: feature.id, mergedInto: feature.id, status: 'merged', depth: 2 });
    });
  });

  it('adds squash-merged pull requests from GitHub data', async () => {
    repo = await FixtureRepo.create();
    const base = await repo.commit();
    await repo.branch('feature/squashy');
    await repo.commit();
    const prStart = repo.time;
    await repo.checkout('main');
    repo.tick();
    await repo.git('merge', '--squash', 'feature/squashy');
    await repo.git('commit', '-q', '-m', 'Add squashy (#7)');
    const squash = await repo.head();
    await repo.deleteBranch('feature/squashy');

    const { tl, snap } = await analyze(repo);
    expect(tl.branches).toHaveLength(1); // the squashed branch commit is unreachable once deleted
    const enriched = enrichWithPullRequests(tl, snap, [
      {
        number: 7,
        title: 'Add squashy',
        url: 'https://github.com/o/r/pull/7',
        state: 'MERGED',
        createdAt: prStart,
        mergedAt: repo.time,
        headRefName: 'feature/squashy',
        baseRefName: 'main',
        mergeCommit: squash,
        firstCommitAt: prStart,
      },
    ]);
    const b = byName(enriched, 'feature/squashy');
    expect(b).toMatchObject({ status: 'squashed', forkCommit: base, nameSource: 'pr', parentId: tl.trunkId });
    expect(b.pr?.url).toContain('/pull/7');
  });
});
