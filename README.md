# Brancher

A temporal view of git branches: when each branch was created, which branch it
came from, and when it was merged back — on a zoomable timeline.

## Quick start

```sh
npm install
npm run dev        # API on 127.0.0.1:4310, UI on http://localhost:5173
npm run demo       # optional: builds a sample repo at ~/.brancher/demo-repo
```

The UI calls the API directly (set `VITE_API_URL` to point elsewhere); the API
only accepts browser requests from localhost origins.

Open the UI and enter a local path (`C:\code\my-repo`, or click **Browse** to pick a
folder; git repos are badged) or a clone URL
(`https://github.com/expressjs/express`). Remote repos are cloned bare and
treeless into `~/.brancher/cache` (override with `BRANCHER_CACHE`).

For GitHub repos, pull request data is fetched to name branches, link PRs and
recover squash/rebase merges; private repos need a token. The server looks for
one in this order:

1. a token pasted in the UI (memory only, until the server restarts)
2. a token saved with **Remember on this computer**, kept encrypted in the OS
   credential store (Windows Credential Manager / macOS Keychain / Secret Service)
3. the `GITHUB_TOKEN` environment variable
4. your GitHub CLI login (`gh auth token`)

The token never reaches the browser; the UI only shows which source is in use,
with a **forget** link for saved tokens. Without any token only ~500 recent PRs
of public repos are read (60 requests/hour limit).

**Controls:** scroll = zoom · shift+scroll = scroll lanes · drag = pan ·
`f` fit · `/` search (Enter / shift+Enter cycles matches) · `+`/`-` zoom ·
arrows pan · Esc deselect. Click a branch for details.

## How branch history is reconstructed

Git doesn't record when branches are created or merged, so Brancher infers it
from the commit graph (`packages/core/src/infer/inferTimeline.ts`):

1. The default branch claims its first-parent chain as the trunk.
2. Merge commits are processed oldest first. Each merged-in parent claims its
   first-parent chain until it reaches an already-claimed commit — that's the
   fork point, and its owner is the parent branch. This is what nests
   branches-of-branches.
3. Names come from merge messages (git, GitHub, GitLab, Bitbucket, Azure
   formats), then live refs. `git pull` merges show as `name (pull)`.
4. Remaining live refs become open (or, after 90 idle days, abandoned) branches.
5. Creation time is exact when the local reflog has `branch: Created from`;
   otherwise it's the first commit's author time (shown as `≈`, with a dotted
   segment back to the fork point).
6. GitHub PRs fill in names and links and add squash-merged branches.

### Known limits

- Fast-forward merges leave no trace without PR data.
- Rebased branches show post-rebase commit times.
- When two unmerged branches share commits, which one is the parent is a guess
  (reflog creation order is used when available).

## Layout

```
packages/core    git extraction + inference (pure TS, tested with real fixture repos)
packages/server  Fastify API: repo resolution, clone cache, GitHub enrichment
packages/web     React + D3 timeline UI
```

`npm test` runs the core tests; `npm run typecheck` checks all packages.
