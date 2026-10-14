import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Commit, FastForward, Ref, ReflogCreation, RepoSnapshot } from './types.ts';

export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Called with each chunk of stderr, e.g. for `--progress` output. */
  onStderr?: (chunk: string) => void;
}

/** Runs git with arguments passed directly (no shell). Resolves with stdout. */
export function git(args: string[], opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      err += s;
      opts.onStderr?.(s);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new GitError(`git ${args[0]} failed: ${err.trim()}`, code, err));
    });
  });
}

const FIELD = '\x00';
const RECORD = '\x1e';

export async function readCommits(cwd: string): Promise<Map<string, Commit>> {
  const format = ['%H', '%P', '%an', '%ae', '%at', '%ct', '%s'].join('%x00') + '%x1e';
  const out = await git(['log', '--all', '--topo-order', `--format=${format}`], { cwd });
  return parseLog(out);
}

export function parseLog(out: string): Map<string, Commit> {
  const commits = new Map<string, Commit>();
  for (const raw of out.split(RECORD)) {
    const rec = raw.replace(/^\s+/, '');
    if (!rec) continue;
    const [hash, parents, author, email, at, ct, subject = ''] = rec.split(FIELD);
    commits.set(hash, {
      hash,
      parents: parents ? parents.split(' ') : [],
      author,
      email,
      authorTime: Number(at),
      commitTime: Number(ct),
      subject,
    });
  }
  return commits;
}

export async function readRefs(cwd: string): Promise<Ref[]> {
  const out = await git(
    ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads', 'refs/remotes'],
    { cwd },
  );
  const refs: Ref[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [ref, hash, symref] = line.split(FIELD);
    if (symref) continue; // e.g. refs/remotes/origin/HEAD
    if (ref.startsWith('refs/heads/')) {
      refs.push({ ref, hash, kind: 'local', name: ref.slice('refs/heads/'.length) });
    } else {
      const rest = ref.slice('refs/remotes/'.length);
      const slash = rest.indexOf('/');
      if (slash < 0) continue;
      refs.push({ ref, hash, kind: 'remote', remote: rest.slice(0, slash), name: rest.slice(slash + 1) });
    }
  }
  return refs;
}

async function tryGit(args: string[], cwd: string): Promise<string | null> {
  try {
    return (await git(args, { cwd })).trim();
  } catch {
    return null;
  }
}

/** Picks the trunk: origin's HEAD, then main/master, then the repo's own HEAD. */
export async function detectTrunkRef(cwd: string, refs: Ref[]): Promise<string> {
  const has = (r: string) => refs.some((x) => x.ref === r);
  // In a bare clone HEAD mirrors the remote's default branch.
  if ((await tryGit(['rev-parse', '--is-bare-repository'], cwd)) === 'true') {
    const head = await tryGit(['symbolic-ref', '-q', 'HEAD'], cwd);
    if (head && has(head)) return head;
  }
  const originHead = await tryGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], cwd);
  if (originHead && has(originHead)) {
    // Prefer the local copy of the default branch when it exists.
    const local = 'refs/heads/' + originHead.slice('refs/remotes/origin/'.length);
    return has(local) ? local : originHead;
  }
  for (const r of ['refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master']) {
    if (has(r)) return r;
  }
  const head = await tryGit(['symbolic-ref', '-q', 'HEAD'], cwd);
  if (head && has(head)) return head;
  if (refs.length) return refs[0].ref;
  throw new Error('Repository has no branches');
}

/**
 * Reads local branch reflogs for creation times (`branch: Created from X`) and
 * fast-forward merges (`merge X: Fast-forward`).
 */
export async function readReflogs(
  cwd: string,
  refs: Ref[],
): Promise<{ creations: Map<string, ReflogCreation>; fastForwards: FastForward[] }> {
  const creations = new Map<string, ReflogCreation>();
  const fastForwards: FastForward[] = [];
  const result = { creations, fastForwards };
  const gitDir = await tryGit(['rev-parse', '--absolute-git-dir'], cwd);
  if (!gitDir) return result;
  await Promise.all(
    refs
      .filter((r) => r.kind === 'local')
      .map(async (r) => {
        let text: string;
        try {
          text = await readFile(path.join(gitDir, 'logs', ...r.ref.split('/')), 'utf8');
        } catch {
          return;
        }
        const creation = parseReflogCreation(text);
        if (creation) creations.set(r.name, creation);
        fastForwards.push(...parseFastForwards(text, r.name));
      }),
  );
  fastForwards.sort((a, b) => a.time - b.time);
  return result;
}

const REFLOG_LINE = /^([0-9a-f]+) ([0-9a-f]+) .* (\d+) [+-]\d{4}\t(.*)$/;

export function parseFastForwards(text: string, target: string): FastForward[] {
  const out: FastForward[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(REFLOG_LINE);
    const ff = m?.[4].match(/^merge (.+): Fast-forward$/);
    if (!m || !ff) continue;
    out.push({ target, source: ff[1], old: m[1], new: m[2], time: Number(m[3]) });
  }
  return out;
}

export function parseReflogCreation(text: string): ReflogCreation | null {
  const first = text.split('\n', 1)[0];
  const tab = first.indexOf('\t');
  if (tab < 0) return null;
  const msg = first.slice(tab + 1);
  if (!msg.startsWith('branch: Created from')) return null;
  const meta = first.slice(0, tab).match(/ (\d+) [+-]\d{4}$/);
  if (!meta) return null;
  const from = msg.slice('branch: Created from'.length).trim() || undefined;
  return { time: Number(meta[1]), from };
}

export async function readSnapshot(cwd: string): Promise<RepoSnapshot> {
  const [commits, refs] = await Promise.all([readCommits(cwd), readRefs(cwd)]);
  const [trunkRef, reflogs] = await Promise.all([detectTrunkRef(cwd, refs), readReflogs(cwd, refs)]);
  return { commits, refs, trunkRef, reflogCreations: reflogs.creations, fastForwards: reflogs.fastForwards };
}

/** A cheap fingerprint of all ref tips, for cache invalidation. */
export async function refsFingerprint(cwd: string): Promise<string> {
  return git(['for-each-ref', '--format=%(refname) %(objectname)'], { cwd });
}

export async function getRemoteUrl(cwd: string, remote = 'origin'): Promise<string | null> {
  return tryGit(['remote', 'get-url', remote], cwd);
}
