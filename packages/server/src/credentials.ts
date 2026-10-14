import { Entry } from '@napi-rs/keyring';
import { execFile } from 'node:child_process';

/**
 * GitHub token lookup, in priority order:
 *   0. a token pasted in the UI without "remember" (memory only, until restart)
 *   1. a token saved from the UI, kept in the OS credential store
 *      (Windows Credential Manager, macOS Keychain, Secret Service on Linux)
 *   2. the GITHUB_TOKEN environment variable
 *   3. the GitHub CLI's login (`gh auth token`)
 * Tokens never leave the server; the UI only learns where one came from.
 */
export type TokenSource = 'session' | 'saved' | 'env' | 'gh';

const entry = new Entry('brancher', 'github-token');
let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

function readSaved(): string | null {
  try {
    return entry.getPassword();
  } catch {
    return null; // No usable credential store (e.g. headless Linux without Secret Service).
  }
}

/** Saves to the OS credential store; falls back to this session only if there isn't one. */
export function saveToken(token: string): boolean {
  try {
    entry.setPassword(token);
    sessionToken = null;
    return true;
  } catch {
    sessionToken = token;
    return false;
  }
}

export function forgetToken(): boolean {
  sessionToken = null;
  try {
    return entry.deleteCredential();
  } catch {
    return false;
  }
}

let ghCache: { at: number; token: string | null } | undefined;
const GH_TTL_MS = 5 * 60 * 1000;

function ghToken(): Promise<string | null> {
  if (ghCache && Date.now() - ghCache.at < GH_TTL_MS) return Promise.resolve(ghCache.token);
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token', '--hostname', 'github.com'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      const token = err ? null : stdout.trim() || null;
      ghCache = { at: Date.now(), token };
      resolve(token);
    });
  });
}

export async function resolveToken(): Promise<{ token: string; source: TokenSource } | null> {
  if (sessionToken) return { token: sessionToken, source: 'session' };
  const saved = readSaved();
  if (saved) return { token: saved, source: 'saved' };
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, source: 'env' };
  const gh = await ghToken();
  return gh ? { token: gh, source: 'gh' } : null;
}
