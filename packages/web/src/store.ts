import { assignLanes, type Branch, type BranchStatus, type Timeline } from '@brancher/core/browser';
import { create } from 'zustand';
import { getTimeline, openRepo, waitUntilReady, type ProgressEvent, type RepoSummary } from './api.ts';

export type Phase = 'idle' | 'opening' | 'cloning' | 'loading' | 'ready' | 'error';
export type StatusFilter = Record<Exclude<BranchStatus, 'trunk'>, boolean>;
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Animate mode. `t` is the playhead (unix seconds); null playback means the normal static view. */
export interface Playback {
  t: number;
  playing: boolean;
  /** Camera keeps the playhead in view; any manual pan turns this off. */
  follow: boolean;
}

const RECENT_KEY = 'brancher.recent';

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable (private mode); recents are a convenience only.
  }
}

interface State {
  phase: Phase;
  progress?: ProgressEvent;
  error?: string;
  repo: RepoSummary | null;
  timeline: Timeline | null;
  warnings: string[];
  recent: string[];

  hoveredId: string | null;
  selectedId: string | null;
  search: string;
  author: string;
  statusFilter: StatusFilter;
  playback: Playback | null;
  speed: Speed;

  open(source: string, githubToken?: string, rememberToken?: boolean): Promise<void>;
  refresh(): Promise<void>;
  close(): void;
  forgetRecent(source: string): void;
  setHovered(id: string | null): void;
  setSelected(id: string | null): void;
  setSearch(s: string): void;
  setAuthor(s: string): void;
  toggleStatus(s: keyof StatusFilter): void;
  startAnimate(): void;
  stopAnimate(): void;
  togglePlay(): void;
  seek(t: number): void;
  setSpeed(speed: Speed): void;
  setFollow(follow: boolean): void;
}

export const useStore = create<State>((set, get) => ({
  phase: 'idle',
  repo: null,
  timeline: null,
  warnings: [],
  recent: loadRecent(),
  hoveredId: null,
  selectedId: null,
  search: '',
  author: '',
  statusFilter: { merged: true, squashed: true, open: true, abandoned: true },
  playback: null,
  speed: 1,

  async open(source, githubToken, rememberToken) {
    set({ phase: 'opening', error: undefined, progress: undefined, playback: null });
    try {
      const repo = await openRepo(source, githubToken, rememberToken);
      set({ repo });
      if (repo.status === 'cloning') {
        set({ phase: 'cloning' });
        await waitUntilReady(repo.id, (progress) => set({ progress }));
      }
      set({ phase: 'loading' });
      const res = await getTimeline(repo.id);
      const recent = [source, ...get().recent.filter((r) => r !== source)].slice(0, 8);
      saveRecent(recent);
      const warnings = repo.notice ? [repo.notice, ...res.warnings] : res.warnings;
      set({ phase: 'ready', repo: res.repo, timeline: res.timeline, warnings, recent, selectedId: null });
      const url = new URL(location.href);
      url.searchParams.set('repo', source);
      history.replaceState(null, '', url);
    } catch (e) {
      set({ phase: 'error', error: (e as Error).message });
    }
  },

  async refresh() {
    const { repo } = get();
    if (!repo) return;
    set({ phase: 'loading', playback: null });
    try {
      const res = await getTimeline(repo.id, true);
      set({ phase: 'ready', timeline: res.timeline, warnings: res.warnings });
    } catch (e) {
      set({ phase: 'error', error: (e as Error).message });
    }
  },

  close() {
    set({ phase: 'idle', repo: null, timeline: null, selectedId: null, hoveredId: null, search: '', author: '', playback: null });
    const url = new URL(location.href);
    url.searchParams.delete('repo');
    history.replaceState(null, '', url);
  },

  forgetRecent(source) {
    const recent = get().recent.filter((r) => r !== source);
    saveRecent(recent);
    set({ recent });
  },

  setHovered: (hoveredId) => set({ hoveredId }),
  setSelected: (selectedId) => set({ selectedId }),
  setSearch: (search) => set({ search }),
  setAuthor: (author) => set({ author }),
  toggleStatus: (s) => set({ statusFilter: { ...get().statusFilter, [s]: !get().statusFilter[s] } }),

  startAnimate() {
    const { timeline } = get();
    if (timeline) set({ playback: { t: timeline.range.start, playing: true, follow: true } });
  },
  stopAnimate: () => set({ playback: null }),
  togglePlay() {
    const { playback, timeline } = get();
    if (!playback || !timeline) return;
    // Pressing play at the end replays from the start.
    const atEnd = playback.t >= timeline.range.end;
    set({ playback: { ...playback, playing: !playback.playing, t: atEnd && !playback.playing ? timeline.range.start : playback.t } });
  },
  seek(t) {
    const { playback } = get();
    if (playback) set({ playback: { ...playback, t } });
  },
  setSpeed: (speed) => set({ speed }),
  setFollow(follow) {
    const { playback } = get();
    if (playback && playback.follow !== follow) set({ playback: { ...playback, follow } });
  },
}));

export interface ViewModel {
  branches: Branch[];
  byId: Map<string, Branch>;
  laneCount: number;
  /** Branches matching search/author, or null when no query is active. */
  matches: Set<string> | null;
}

/** Applies status filters and re-packs lanes so hidden branches leave no gaps. */
export function buildViewModel(tl: Timeline, statusFilter: StatusFilter, search: string, author: string): ViewModel {
  const visible = tl.branches
    .filter((b) => b.status === 'trunk' || statusFilter[b.status])
    .map((b) => ({ ...b }));
  assignLanes(visible, tl.trunkId, tl.range);
  const byId = new Map(visible.map((b) => [b.id, b]));
  const laneCount = visible.reduce((m, b) => Math.max(m, b.lane + 1), 1);

  let matches: Set<string> | null = null;
  const q = search.trim().toLowerCase();
  const a = author.trim().toLowerCase();
  if (q || a) {
    matches = new Set(
      visible
        .filter((b) => !q || b.name.toLowerCase().includes(q) || String(b.pr?.number ?? '') === q.replace('#', ''))
        .filter((b) => !a || b.commits.some((c) => c.author.toLowerCase().includes(a)) || b.pr?.author?.toLowerCase().includes(a))
        .map((b) => b.id),
    );
  }
  return { branches: visible, byId, laneCount, matches };
}
