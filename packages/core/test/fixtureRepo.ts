import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git } from '../src/git.ts';

export const T0 = 1_700_000_000;
export const HOUR = 3600;

/**
 * Builds a real git repository with deterministic timestamps. Each operation
 * advances the clock by one hour unless told otherwise.
 */
export class FixtureRepo {
  time = T0;
  private n = 0;

  private constructor(readonly dir: string) {}

  static async create(dir?: string): Promise<FixtureRepo> {
    if (dir) await mkdir(dir, { recursive: true });
    else dir = await mkdtemp(path.join(tmpdir(), 'brancher-fixture-'));
    const repo = new FixtureRepo(dir);
    await repo.git('init', '-q', '-b', 'main');
    return repo;
  }

  private env() {
    const date = `@${this.time} +0000`;
    return {
      GIT_AUTHOR_NAME: 'Tester',
      GIT_AUTHOR_EMAIL: 'tester@example.com',
      GIT_COMMITTER_NAME: 'Tester',
      GIT_COMMITTER_EMAIL: 'tester@example.com',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    };
  }

  async git(...args: string[]): Promise<string> {
    const out = await git(['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
      cwd: this.dir,
      env: this.env(),
    });
    return out.trim();
  }

  tick(hours = 1) {
    this.time += hours * HOUR;
    return this;
  }

  /** Commits a new file and returns the commit hash. */
  async commit(message = `commit ${this.n + 1}`): Promise<string> {
    this.tick();
    this.n++;
    await writeFile(path.join(this.dir, `file${this.n}.txt`), `${message}\n`);
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', message);
    return this.head();
  }

  async branch(name: string, from?: string) {
    this.tick();
    await this.git('checkout', '-q', '-b', name, ...(from ? [from] : []));
    return this.time;
  }

  async checkout(name: string) {
    await this.git('checkout', '-q', name);
  }

  /** `git merge --no-ff` with git's default message. Returns the merge commit. */
  async merge(...branches: string[]): Promise<string> {
    this.tick();
    await this.git('merge', '-q', '--no-ff', '--no-edit', ...branches);
    return this.head();
  }

  /** `git merge --ff-only`: moves the current branch with no merge commit. */
  async mergeFastForward(branch: string) {
    this.tick();
    await this.git('merge', '-q', '--ff-only', branch);
    return this.time;
  }

  async head(): Promise<string> {
    return this.git('rev-parse', 'HEAD');
  }

  async deleteBranch(name: string) {
    await this.git('branch', '-q', '-D', name);
  }

  async cleanup() {
    await rm(this.dir, { recursive: true, force: true });
  }
}
