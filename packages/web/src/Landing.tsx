import { useEffect, useState } from 'react';
import { forgetSavedToken, getTokenSource, type TokenSource } from './api.ts';
import { FolderPicker } from './FolderPicker.tsx';
import { Logo } from './Logo.tsx';
import { ThemeSwitcher } from './ThemeSwitcher.tsx';
import { useStore } from './store.ts';

/** Decorative animated branch lines behind the hero. */
function HeroArt() {
  const paths = [
    { d: 'M-20,300 H1500', c: '#e8dfcc', w: 3 },
    { d: 'M180,300 C240,300 240,220 300,220 H620 C680,220 680,300 740,300', c: '#8fa3c0', w: 2 },
    { d: 'M380,220 C430,220 430,150 480,150 H560 C600,150 600,220 640,220', c: '#c48b78', w: 2 },
    { d: 'M820,300 C880,300 880,390 940,390 H1240', c: '#a3b477', w: 2 },
    { d: 'M980,390 C1030,390 1030,460 1080,460 H1180 C1220,460 1220,390 1260,390', c: '#c9878f', w: 2 },
    { d: 'M1040,300 C1090,300 1090,210 1140,210 H1500', c: '#d4a24c', w: 2 },
  ];
  return (
    <svg className="hero-art pointer-events-none absolute inset-0 h-full w-full opacity-50" viewBox="0 0 1440 600" preserveAspectRatio="xMidYMid slice">
      {paths.map((p, i) => (
        <g key={i}>
          <path d={p.d} stroke={p.c} strokeWidth={p.w} fill="none" strokeOpacity={0.25} />
          <path d={p.d} stroke={p.c} strokeWidth={p.w} fill="none" className="flow" style={{ animationDelay: `${-i * 2}s` }} />
        </g>
      ))}
    </svg>
  );
}

const TOKEN_LABEL: Record<NonNullable<TokenSource>, string> = {
  saved: 'Using token saved on this computer',
  session: 'Using pasted token (until server restarts)',
  env: 'Using GITHUB_TOKEN from the environment',
  gh: 'Using your GitHub CLI login',
};

export function Landing() {
  const { phase, progress, error, recent, open, forgetRecent } = useStore();
  const [source, setSource] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [remember, setRemember] = useState(true);
  const [tokenSource, setTokenSource] = useState<TokenSource>(null);

  useEffect(() => {
    getTokenSource().then(setTokenSource, () => setTokenSource(null));
  }, []);
  const [picking, setPicking] = useState(false);
  const busy = phase === 'opening' || phase === 'cloning' || phase === 'loading';

  const submit = (src: string) => {
    if (!src.trim() || busy) return;
    setSource(src);
    void open(src.trim(), token.trim() || undefined, remember);
  };

  const status =
    phase === 'cloning'
      ? (progress?.message ?? 'Cloning')
      : phase === 'loading'
        ? 'Reconstructing branch history'
        : phase === 'opening'
          ? 'Opening repository'
          : null;

  return (
    <div className="bg-grid relative flex h-full flex-col items-center justify-center overflow-hidden px-4">
      <HeroArt />
      <ThemeSwitcher className="absolute right-4 top-4 z-20" />
      <div className="hero-vignette pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_640px_340px_at_center,var(--color-ink-950)_35%,transparent_100%)]" />
      <div className="relative z-10 w-full max-w-2xl">
        <div className="mb-8 text-center">
          <Logo className="hero-logo mx-auto mb-5 h-14 w-14 drop-shadow-[0_0_20px_rgba(212,162,76,0.35)]" />
          <h1 className="brand-title bg-gradient-to-r from-cyan-200 via-white to-fuchsia-200 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
            Brancher
          </h1>
          <p className="mt-3 text-slate-400">See when every branch was born, where it came from, and when it came home.</p>
        </div>

        <form
          className="glass window rounded-2xl p-2 shadow-2xl shadow-black/50"
          onSubmit={(e) => {
            e.preventDefault();
            submit(source);
          }}
        >
          <div className="flex gap-2">
            <input
              autoFocus
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={busy}
              placeholder="C:\code\my-repo  or  https://github.com/owner/repo"
              className="field min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 font-mono text-sm outline-none placeholder:text-slate-600"
            />
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={busy}
              title="Browse for a folder"
              className="btn flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l2 2h7A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z" />
              </svg>
              Browse
            </button>
            <button
              type="submit"
              disabled={busy || !source.trim()}
              className="btn btn-primary rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-400 px-5 text-sm font-semibold text-ink-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? 'Working…' : 'Visualize'}
            </button>
          </div>

          {busy && (
            <div className="px-3 pb-2 pt-3">
              <div className="mb-1.5 flex justify-between text-[11px] text-slate-400">
                <span>{status}</span>
                {progress?.percent !== undefined && phase === 'cloning' && <span>{progress.percent}%</span>}
              </div>
              <div className="progress h-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`progress-bar h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-all ${
                    phase === 'cloning' && progress?.percent !== undefined ? '' : 'w-1/3 animate-pulse'
                  }`}
                  style={phase === 'cloning' && progress?.percent !== undefined ? { width: `${progress.percent}%` } : undefined}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 pb-1 pt-2 text-[11px] text-slate-500">
            <button type="button" onClick={() => setShowToken(!showToken)} className="hover:text-slate-300">
              {showToken ? '▾' : '▸'} GitHub token {tokenSource ? '' : '(optional)'}
            </button>
            {tokenSource ? (
              <span className="flex items-center gap-1.5">
                <span className="status-dot h-1.5 w-1.5 rounded-full bg-lime-400 shadow-[0_0_6px] shadow-lime-400" />
                <span className="text-slate-400">{TOKEN_LABEL[tokenSource]}</span>
                {(tokenSource === 'saved' || tokenSource === 'session') && (
                  <button
                    type="button"
                    onClick={() => forgetSavedToken().then(setTokenSource)}
                    className="text-slate-500 underline decoration-dotted hover:text-rose-300"
                  >
                    forget
                  </button>
                )}
              </span>
            ) : (
              <span className="text-slate-600">— recovers squash merges and PR details; needed for private repos</span>
            )}
          </div>
          {showToken && (
            <div className="mx-2 mb-2 space-y-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tokenSource ? 'Paste a new token to replace the current one' : 'github_pat_…'}
                className="field w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs outline-none placeholder:text-slate-600"
              />
              <label className="flex cursor-pointer items-center gap-2 px-1 text-[11px] text-slate-400">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-cyan-400" />
                Remember on this computer
                <span className="text-slate-600">— stored encrypted in your system credential store, never in the browser</span>
              </label>
            </div>
          )}
        </form>

        {phase === 'error' && error && (
          <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        )}

        {recent.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recent</h2>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <span key={r} className="chip group flex items-center rounded-lg border border-white/10 bg-white/5 text-xs hover:border-cyan-400/40">
                  <button onClick={() => submit(r)} disabled={busy} className="max-w-[420px] truncate px-3 py-1.5 font-mono text-slate-300" title={r}>
                    {r}
                  </button>
                  <button onClick={() => forgetRecent(r)} className="pr-2 text-slate-600 opacity-0 hover:text-slate-300 group-hover:opacity-100" aria-label="Remove">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {picking && (
        <FolderPicker
          // Start where the typed path points, unless it's a URL.
          initialPath={/^[a-z]+:\/\//i.test(source) ? undefined : source.trim()}
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setPicking(false);
            submit(path);
          }}
        />
      )}
    </div>
  );
}
