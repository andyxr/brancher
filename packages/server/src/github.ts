import type { PullRequest } from '@brancher/core';

export interface GitHubRepo {
  owner: string;
  name: string;
}

/** Recognizes https and ssh GitHub remote URLs. */
export function parseGitHubUrl(url: string): GitHubRepo | null {
  const m = url.trim().match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], name: m[2] } : null;
}

interface RestPull {
  number: number;
  title: string;
  html_url: string;
  user?: { login: string } | null;
  state: 'open' | 'closed';
  created_at: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { ref: string };
  base: { ref: string };
}

const toUnix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

export class GitHubError extends Error {}

/**
 * Lists pull requests, newest first. Without a token GitHub allows 60
 * requests an hour, so fewer pages are fetched.
 */
export async function fetchPullRequests(
  repo: GitHubRepo,
  token: string | undefined,
  maxPages = token ? 30 : 5,
): Promise<PullRequest[]> {
  const prs: PullRequest[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls?state=all&per_page=100&page=${page}&sort=created&direction=desc`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'brancher',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reason =
        remaining === '0'
          ? 'rate limit exceeded; add a GitHub token'
          : res.status === 404 || res.status === 401
            ? // GitHub answers 404 rather than 403 for private repos it won't show you.
              `${repo.owner}/${repo.name} not found. If it's private, add a GitHub token with access to load pull requests`
            : `${res.status} ${res.statusText}`;
      if (prs.length) break; // keep what we have
      throw new GitHubError(`GitHub API: ${reason}`);
    }
    const batch = (await res.json()) as RestPull[];
    for (const p of batch) {
      prs.push({
        number: p.number,
        title: p.title,
        url: p.html_url,
        author: p.user?.login,
        state: p.merged_at ? 'MERGED' : p.state === 'open' ? 'OPEN' : 'CLOSED',
        createdAt: toUnix(p.created_at),
        mergedAt: p.merged_at ? toUnix(p.merged_at) : undefined,
        headRefName: p.head.ref,
        baseRefName: p.base.ref,
        // For unmerged PRs this is a throwaway test merge, so ignore it.
        mergeCommit: p.merged_at ? (p.merge_commit_sha ?? undefined) : undefined,
      });
    }
    if (batch.length < 100) break;
  }
  return prs;
}
