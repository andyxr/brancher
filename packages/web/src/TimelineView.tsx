import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Logo } from './Logo.tsx';
import { SidePanel } from './SidePanel.tsx';
import { buildViewModel, useStore, type StatusFilter } from './store.ts';
import { usePalette, type Palette } from './theme.ts';
import { ThemeSwitcher } from './ThemeSwitcher.tsx';
import { buildClock } from './timeline/playback.ts';
import { PlaybackBar } from './timeline/PlaybackBar.tsx';
import { Timeline, type TimelineHandle } from './timeline/Timeline.tsx';
import { usePlayback } from './timeline/usePlayback.ts';

const Scene3D = lazy(() => import('./timeline3d/Scene3D.tsx'));

const LEGEND: { key: keyof StatusFilter; label: string; glyph(p: Palette): React.ReactNode }[] = [
  {
    key: 'merged',
    label: 'Merged',
    glyph: (p) => <circle cx={8} cy={8} r={4} fill={p.hole} stroke={p.legend.merged} strokeWidth={2} />,
  },
  {
    key: 'squashed',
    label: 'Squashed',
    glyph: (p) => (
      <rect x={4.5} y={4.5} width={7} height={7} transform="rotate(45 8 8)" fill={p.hole} stroke={p.legend.squashed} strokeWidth={2} />
    ),
  },
  { key: 'open', label: 'Open', glyph: (p) => <circle cx={8} cy={8} r={4} fill={p.legend.open} /> },
  {
    key: 'abandoned',
    label: 'Abandoned',
    glyph: (p) => <path d="M4,4 L12,12 M12,4 L4,12" stroke={p.legend.abandoned} strokeWidth={2} />,
  },
];

export function TimelineView() {
  const { repo, timeline, warnings, phase, statusFilter, search, author, playback } = useStore();
  const { refresh, close, setSearch, setAuthor, toggleStatus, setSelected, toggleAnimate } = useStore();
  const p = usePalette();
  const timelineRef = useRef<TimelineHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const vm = useMemo(
    () => buildViewModel(timeline!, statusFilter, search, author),
    [timeline, statusFilter, search, author],
  );
  const clock = useMemo(() => buildClock(vm.branches, timeline!.range), [vm.branches, timeline]);
  usePlayback(clock);
  const matchList = useMemo(
    () => (vm.matches ? vm.branches.filter((b) => vm.matches!.has(b.id)).sort((a, b) => a.createdAt - b.createdAt) : []),
    [vm],
  );

  const jumpToMatch = (step: number) => {
    if (!matchList.length) return;
    const i = (matchIndex + step + matchList.length) % matchList.length;
    setMatchIndex(i);
    setSelected(matchList[i].id);
    timelineRef.current?.focus(matchList[i].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range';
      const { playback, stopAnimate, togglePlay, toggleAnimate } = useStore.getState();
      if (e.key === 'Escape') {
        if (typing) (e.target as HTMLInputElement).blur();
        if (playback) stopAnimate();
        else setSelected(null);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = timelineRef.current;
      if (e.key === ' ') {
        // A focused button already activates on space; don't toggle twice.
        if (!playback || e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'a') toggleAnimate('2d');
      else if (e.key === '3') toggleAnimate('3d');
      else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'f') t?.fit();
      else if (e.key === '+' || e.key === '=') t?.zoomBy(1.5);
      else if (e.key === '-') t?.zoomBy(1 / 1.5);
      else if (e.key === 'ArrowLeft') t?.panBy(120, 0);
      else if (e.key === 'ArrowRight') t?.panBy(-120, 0);
      else if (e.key === 'ArrowUp') t?.panBy(0, 90);
      else if (e.key === 'ArrowDown') t?.panBy(0, -90);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelected]);

  if (!timeline || !repo) return null;
  const s = timeline.stats;

  return (
    <div className="bg-grid flex h-full flex-col">
      <header className="titlebar relative z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/5 bg-ink-900/80 px-4 py-2.5 backdrop-blur">
        <button onClick={close} className="flex items-center gap-2" title="Open another repository">
          <Logo className="h-6 w-6" />
          <span className="brand text-sm font-semibold tracking-tight text-white">Brancher</span>
        </button>
        <div className="divider h-5 w-px bg-white/10" />
        <div className="min-w-0">
          <div className="truncate font-mono text-sm text-white">{repo.name}</div>
          <div className="truncate text-[11px] text-slate-500" title={repo.source}>
            {s.branches} branches · {s.merged} merged · {s.open} open · {s.commits.toLocaleString()} commits
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setMatchIndex(-1);
              }}
              onKeyDown={(e) => e.key === 'Enter' && jumpToMatch(e.shiftKey ? -1 : 1)}
              placeholder="Search branches or #PR"
              className="field w-56 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-slate-500 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
            />
            {vm.matches && (
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
                {vm.matches.size} found
              </span>
            )}
          </div>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author"
            className="field w-32 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-slate-500 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
          />
          <div className="segmented flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
            {LEGEND.map((l) => (
              <button
                key={l.key}
                onClick={() => toggleStatus(l.key)}
                title={`${statusFilter[l.key] ? 'Hide' : 'Show'} ${l.label.toLowerCase()} branches`}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition ${
                  statusFilter[l.key] ? 'on text-slate-200 hover:bg-white/10' : 'text-slate-600 line-through opacity-60'
                }`}
              >
                <svg width={16} height={16}>{l.glyph(p)}</svg>
                {l.label}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={phase === 'loading'}
            className="btn rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            {phase === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => toggleAnimate('2d')}
            title={playback?.dim === '2d' ? 'Exit animate (a)' : 'Replay the history (a)'}
            className={`btn rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 ${playback?.dim === '2d' ? 'lit' : ''}`}
          >
            Animate
          </button>
          <button
            onClick={() => toggleAnimate('3d')}
            title={playback?.dim === '3d' ? 'Exit 3D (3)' : 'Fly through the history in 3D (3)'}
            className={`btn rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 ${playback?.dim === '3d' ? 'lit' : ''}`}
          >
            3D
          </button>
          <ThemeSwitcher />
        </div>
      </header>

      {warnings.length > 0 && !dismissed && (
        <div className="warning-bar flex items-center gap-3 border-b border-amber-400/20 bg-amber-400/10 px-4 py-1.5 text-xs text-amber-200">
          <span>⚠ {warnings.join(' · ')}</span>
          <button onClick={() => setDismissed(true)} className="ml-auto text-amber-200/70 hover:text-amber-100">
            Dismiss
          </button>
        </div>
      )}

      <main className="relative min-h-0 flex-1">
        {playback?.dim === '3d' ? (
          <Suspense fallback={null}>
            <Scene3D vm={vm} trunkId={timeline.trunkId} clock={clock} />
          </Suspense>
        ) : (
          <Timeline ref={timelineRef} data={timeline} vm={vm} clock={clock} />
        )}
        <PlaybackBar clock={clock} />
        <SidePanel vm={vm} onFocus={(id) => timelineRef.current?.focus(id)} />
      </main>
    </div>
  );
}
