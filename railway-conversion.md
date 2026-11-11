Hand-off from my previous session (saved at /Users/andydeighton/.claude/handoffs/brancher-2026-11-11T08-26-22-656Z.md):

  # Brancher hosted-mode hand-off

  ## Goal
  Investigate, then build, "option 2": serve the Brancher web UI (`packages/web`) from Netlify and run the Fastify API server (`packages/server`) on a host that has the `git` binary and a persistent disk (proposed: Fly.io). Anyone could then view public GitHub repos with nothing installed. Today's local mode must keep working exactly as it does.

  ## Current state
  - No code has changed. Branch is `main`, working tree clean, latest commit `e93a1c4 Merge branch 'liquid-glass-theme'`.
  - The user asked for a new branch before any code change. Proposed name: `hosted-mode`.
  - I proposed the phase 1 design below and asked the user to confirm scope: phase 1 as described, or include private repos, or use a different host. **No answer yet.** Confirm before implementing.
  - How the app works now:
    - The server listens on `127.0.0.1:4310`.
    - The UI runs on Vite at `:5173` and calls the API directly. The URL comes from `VITE_API_URL` in `packages/web/src/api.ts`, defaulting to `http://127.0.0.1:4310`.
    - `packages/core/src/git.ts` spawns the `git` binary and reads `.git/logs` reflogs from disk.
    - Remote repos are cloned bare and treeless (`--filter=tree:0`) into `BRANCHER_CACHE` (default `~/.brancher/cache`) by `RepoManager` in `packages/server/src/repos.ts`.
    - Clone progress streams over SSE at `/api/repos/:id/progress`.
  - Scripts in root `package.json`:
    - `dev` runs server and web together.
    - `build` builds web only.
    - `test` runs vitest.
    - `typecheck` runs tsc on each package.
    - The server runs with `tsx` (no build step), and core exports `.ts` sources directly.

  ## Key decisions and why
  - **Not Netlify Functions for the API.** They have no git binary and no persistent disk, time out after 10–26s, can't hold long-lived SSE connections, and can't see local folders. Netlify hosts only the static UI.
  - **Fly.io for the API.** It gives a Docker image with git, a persistent volume for the clone cache, and machines that stop when idle for low cost. Render or Railway would also work.
  - **Gate behind `BRANCHER_MODE=hosted`.** Local mode is unchanged.
  - **Phase 1 handles public GitHub repos only, using the server's own `GITHUB_TOKEN` env.** Reason: `credentials.ts` keeps one session token for the whole process. A token pasted by one visitor would be used for everyone and could leak private PR data. Clones of public repos need no token.
  - **Private repos are deferred to phase 2.** They need GitHub OAuth per user, that user's token for clone and PRs, and per-user separation of the clone cache.
  - **Hosted-mode security and resource limits:**
    - Turn off local paths and `/api/folders`, since they expose the host filesystem.
    - Accept only URLs matching `https://github.com/<owner>/<name>(.git)?`. This blocks `ssh://`, `git://`, `user@host:` and other hosts, which could otherwise be used to reach internal addresses.
    - Before cloning, check the repo's size via the GitHub API (`GET /repos/{o}/{r}`, field `size` in KB) and reject anything over about 200MB.
    - Allow at most 2 clones at once.
    - Kill a clone after about 2 minutes.
    - Evict least-recently-used repos whebudget, and remove the matching entries
  from the in-memory `RepoManager` map.                                                                      - Add per-IP rate limiting with `@fas
    - Turn off the token paste, remember and forget endpoints, and skip the keyring.                       - **CORS:** keep the localhost regex and in an env var (e.g.
  `BRANCHER_ALLOWED_ORIGINS`) for the Netlify URL.                                                         - **The server must bind `0.0.0.0` in hded to `127.0.0.1` today.
                                                                                                           ## Files touched or relevant (paths)
  None modified yet. Relevant files:                                                                       - `packages/server/src/index.ts`: routeN`), `app.listen` host and port, token
  endpoints, SSE progress.                                                                                 - `packages/server/src/repos.ts`: `Repo, `openRemote`, `sync` (clone/fetch),
  `CACHE_DIR`, `URL_PATTERN`, `RepoEntry.timeline` (calls `resolveToken`).                                 - `packages/server/src/credentials.ts`:yring (`@napi-rs/keyring`), env token,
  `gh auth token` fallback.                                                                                - `packages/server/src/github.ts`: `parquests` (30 pages with a token, 5
  without).                                                                                                - `packages/server/src/folders.ts`: fil
  - `packages/server/package.json`: dependencies (fastify, keyring). Add `@fastify/rate-limit`.            - `packages/core/src/git.ts`: `git()` sL_PROMPT=0`), `readSnapshot`, reflog
  reads.                                                                                                   - `packages/web/src/api.ts`: API base U`getConfig()`.
  - `packages/web/src/Landing.tsx`: path input, Browse button, token form, remember checkbox, forget link. Hide in hosted mode.
  - `packages/web/src/FolderPicker.tsx`: hide in hosted mode.
  - `packages/web/vite.config.ts`, `packa build.
  - `README.md`: document hosted mode and deployment.                                                     - To create: `Dockerfile` (Node ≥22.12 packages/server/src/index.ts`),
  `fly.toml` (volume mounted at the cache path, `BRANCHER_CACHE` set to it, auto stop and start),         `netlify.toml` (base `packages/web` or  publish `packages/web/dist`,
  `VITE_API_URL` set to the Fly URL), optionally `.dockerignore`.                                         
  ## Next steps                                                                                           1. Confirm scope with the user: phase 1s too, or another host.
  2. `git checkout -b hosted-mode`.                                                                       3. Server config: read `BRANCHER_MODE`,`, `HOST` (default `127.0.0.1`,
  `0.0.0.0` when hosted), `PORT`, and the limits (max repo MB, max concurrent clones, clone timeout, cachebudget). Add a `GET /api/config` endpoi
  4. In hosted mode:                                                                                         - Reject local sources and return 40the token routes.
     - Validate GitHub https URLs only, and normalize them so the ids are stable.                            - Make `resolveToken` return only th
     - Avoid the keyring import, or tolerate it failing on Linux.                                         5. Add the size pre-check, a concurrenc the clone timeout (kill the child
  process; `git()` has no timeout today, so extend `RunOptions` with a `timeoutMs` or `AbortSignal`), and LRU cache eviction with disk-usage trac
  6. Register `@fastify/rate-limit`, keyed per IP. Behind the Fly proxy, set `trustProxy`.                7. Web: fetch `/api/config` at startup local path, Browse and the token UI.
  Change placeholder copy to GitHub URLs only.                                                            8. Add `Dockerfile`, `.dockerignore`, `l`, and update the README.
  9. Add tests: URL validation, hosted-mode rejection of local paths and folders, eviction logic. Run `npmtest` and `npm run typecheck`, and show).
  10. Smoke-test locally with `BRANCHER_MODE=hosted`. Run dev processes in the herdr pane called `run`    (project rule). If possible, build and
  11. The user deploys, since it needs their accounts: `fly launch` / `fly volumes create` / `fly secrets set GITHUB_TOKEN=...`, then connect the

  ## Open questions / gotchas
  - Scope is still unconfirmed: private repos via OAuth now or later, and Fly or another host.             - SSE: confirm Fly's proxy doesn't buffe handler hijacks the reply and copies
  CORS headers by hand, so the new allowed-origins logic must still apply there.                           - Comments in `index.ts` say Vite's devabyte responses, which is why the UI
  calls the API cross-origin. Timeline JSON can be several MB, so consider compression                     (`@fastify/compress`).
  - `@napi-rs/keyring` is a native module. Make sure `npm ci` in the Linux Docker image works, or import   it lazily only in local mode.
  - Reflog creation times aren't available for remote clones, so hosted timelines rely on first-commit and PR dates. That's expected, not a bug.
  - With only the server's single `GITHUB_TOKEN`, all visitors share its 5000 requests/hour. PR results are cached 10 min per repo (`PR_TTL_MS`
  - A Fly machine that stops when idle has a cold start of a few seconds on the first request. The cache
  volume persists across stops.
  - Existing sessions on `main` may have the dev server running. Don't change local-mode defaults.
  - User preferences: be extremely concisles, never hard-wrap sentences. Run the
  tests and show the output before saying anything is done. Report anything missing or broken instead of
  working around it.

  Continue from Next steps.
