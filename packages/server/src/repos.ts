import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  enrichWithPullRequests,
  getRemoteUrl,
  git,
  inferTimeline,
  readSnapshot,
  refsFingerprint,
  type PullRequest,
  type Timeline,
} from '@brancher/core';
import { resolveToken } from './credentials.ts';
import { fetchPullRequests, parseGitHubUrl, type GitHubRepo } from './github.ts';

export const CACHE_DIR = process.env.BRANCHER_CACHE ?? path.join(homedir(), '.brancher', 'cache');
const PR_TTL_MS = 10 * 60 * 1000;

export type RepoStatus = 'cloning' | 'ready' | 'error';

export interface ProgressEvent {
  type: 'progress' | 'ready' | 'error';
  message: string;
  percent?: number;
}

export class UserError extends Error {}

export class RepoEntry extends EventEmitter {
  status: RepoStatus = 'cloning';
  error?: string;
  github: GitHubRepo | null = null;
  lastProgress?: ProgressEvent;
  private cache?: { key: string; timeline: Timeline; warnings: string[] };
  private prs?: { at: number; tokenId: string; list: PullRequest[] };

  constructor(
    readonly id: string,
    readonly source: string,
    readonly kind: 'local' | 'remote',
    readonly dir: string,
    readonly name: string,
  ) {
    super();
  }

  emitProgress(ev: ProgressEvent) {
    this.lastProgress = ev;
    this.emit('progress', ev);
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      source: this.source,
      kind: this.kind,
      status: this.status,
      error: this.error,
      github: this.github,
    };
  }

  async timeline(refresh: boolean): Promise<{ timeline: Timeline; warnings: string[] }> {
    if (this.status !== 'ready') throw new UserError(`Repository is ${this.status}`);
    if (refresh && this.kind === 'remote') await git(['fetch', '-q', '--prune', 'origin'], { cwd: this.dir });
    const auth = this.github ? await resolveToken() : null;
    // Re-enrich when the token changes, since it decides which PRs are visible.
    const tokenId = auth ? createHash('sha256').update(auth.token).digest('hex').slice(0, 12) : '';
    const key = `${await refsFingerprint(this.dir)}:${tokenId}`;
    if (!refresh && this.cache?.key === key) return this.cache;

    const snap = await readSnapshot(this.dir);
    let timeline = inferTimeline(snap);
    const warnings: string[] = [];
    if (this.github) {
      try {
        const prs = await this.pullRequests(refresh, auth?.token, tokenId);
        timeline = enrichWithPullRequests(timeline, snap, prs);
      } catch (e) {
        warnings.push((e as Error).message);
      }
    }
    this.cache = { key, timeline, warnings };
    return this.cache;
  }

  private async pullRequests(refresh: boolean, token: string | undefined, tokenId: string) {
    const p = this.prs;
    if (!refresh && p && p.tokenId === tokenId && Date.now() - p.at < PR_TTL_MS) return p.list;
    const list = await fetchPullRequests(this.github!, token);
    this.prs = { at: Date.now(), tokenId, list };
    return list;
  }
}

const URL_PATTERN = /^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/i;

function displayName(source: string) {
  return source.replace(/[\\/]+$/, '').replace(/\.git$/, '').split(/[\\/:]/).pop() || source;
}

export class RepoManager {
  private repos = new Map<string, RepoEntry>();

  get(id: string) {
    return this.repos.get(id);
  }

  async open(source: string): Promise<RepoEntry> {
    source = source.trim();
    if (!source) throw new UserError('Enter a local path or a clone URL');
    const isUrl = URL_PATTERN.test(source);
    const id = createHash('sha1').update(isUrl ? source : path.resolve(source).toLowerCase()).digest('hex').slice(0, 12);

    let entry = this.repos.get(id);
    if (!entry || entry.status === 'error') {
      entry = isUrl ? this.openRemote(id, source) : await this.openLocal(id, source);
      this.repos.set(id, entry);
    }
    return entry;
  }

  private async openLocal(id: string, source: string): Promise<RepoEntry> {
    const dir = path.resolve(source);
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) throw new UserError(`Not a directory: ${dir}`);
    try {
      await git(['rev-parse', '--git-dir'], { cwd: dir });
    } catch {
      throw new UserError(`Not a git repository: ${dir}`);
    }
    const entry = new RepoEntry(id, dir, 'local', dir, displayName(dir));
    const remote = await getRemoteUrl(dir);
    entry.github = remote ? parseGitHubUrl(remote) : null;
    entry.status = 'ready';
    return entry;
  }

  private openRemote(id: string, url: string): RepoEntry {
    const dir = path.join(CACHE_DIR, `${id}.git`);
    const entry = new RepoEntry(id, url, 'remote', dir, displayName(url));
    entry.github = parseGitHubUrl(url);
    void this.sync(entry).catch((e: Error) => {
      entry.status = 'error';
      entry.error = e.message;
      entry.emitProgress({ type: 'error', message: e.message });
    });
    return entry;
  }

  /** Bare, treeless clone: we only need commit metadata, not file contents. */
  private async sync(entry: RepoEntry) {
    const onStderr = (chunk: string) => {
      for (const line of chunk.split(/[\r\n]+/)) {
        const m = line.match(/^(?:remote: )?([\w ]+):\s+(\d+)%/);
        if (m) entry.emitProgress({ type: 'progress', message: m[1].trim(), percent: Number(m[2]) });
      }
    };
    if (existsSync(path.join(entry.dir, 'HEAD'))) {
      entry.emitProgress({ type: 'progress', message: 'Fetching updates' });
      await git(['fetch', '--progress', '--prune', 'origin'], { cwd: entry.dir, onStderr });
    } else {
      await mkdir(CACHE_DIR, { recursive: true });
      entry.emitProgress({ type: 'progress', message: 'Cloning' });
      await git(
        ['-c', 'protocol.ext.allow=never', 'clone', '--bare', '--filter=tree:0', '--progress', '--', entry.source, entry.dir],
        { cwd: CACHE_DIR, onStderr },
      );
      await git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*'], { cwd: entry.dir });
    }
    entry.status = 'ready';
    entry.emitProgress({ type: 'ready', message: 'Ready', percent: 100 });
  }
}
