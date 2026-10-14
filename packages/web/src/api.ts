import type { Timeline } from '@brancher/core/browser';

export interface RepoSummary {
  id: string;
  name: string;
  source: string;
  kind: 'local' | 'remote';
  status: 'cloning' | 'ready' | 'error';
  error?: string;
  github: { owner: string; name: string } | null;
  /** One-off message from opening, e.g. the token couldn't be saved. */
  notice?: string;
}

/** Where the server's GitHub token comes from; the token itself never reaches the browser. */
export type TokenSource = 'session' | 'saved' | 'env' | 'gh' | null;

export interface ProgressEvent {
  type: 'progress' | 'ready' | 'error';
  message: string;
  percent?: number;
}

export interface TimelineResponse {
  repo: RepoSummary;
  timeline: Timeline;
  warnings: string[];
}

const API = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4310';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, init);
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function openRepo(source: string, githubToken?: string, rememberToken = false) {
  return request<RepoSummary>('/api/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, githubToken, rememberToken }),
  });
}

export async function getTokenSource(): Promise<TokenSource> {
  return (await request<{ source: TokenSource }>('/api/github/token')).source;
}

export async function forgetSavedToken(): Promise<TokenSource> {
  return (await request<{ source: TokenSource }>('/api/github/token', { method: 'DELETE' })).source;
}

export function getTimeline(id: string, refresh = false) {
  return request<TimelineResponse>(`/api/repos/${id}/timeline${refresh ? '?refresh=1' : ''}`);
}

/** Resolves once the repo is ready; rejects on clone failure. */
export function waitUntilReady(id: string, onProgress: (ev: ProgressEvent) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${API}/api/repos/${id}/progress`);
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data) as ProgressEvent;
      onProgress(ev);
      if (ev.type === 'ready') {
        es.close();
        resolve();
      } else if (ev.type === 'error') {
        es.close();
        reject(new Error(ev.message));
      }
    };
    es.onerror = () => {
      es.close();
      reject(new Error('Lost connection to the Brancher server'));
    };
  });
}

export interface FolderEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  isRepo: boolean;
  entries: FolderEntry[];
  roots: FolderEntry[];
}

export function listFolders(path?: string) {
  return request<FolderListing>(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ''}`);
}
