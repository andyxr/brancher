import { useEffect, useState } from 'react';
import { listFolders, type FolderListing } from './api.ts';

function FolderIcon({ repo }: { repo: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 ${repo ? 'text-cyan-300' : 'text-slate-500'}`} fill="currentColor">
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l2 2h7A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z" fillOpacity={repo ? 0.9 : 0.6} />
    </svg>
  );
}

/** Splits a path into clickable breadcrumb segments, on Windows or POSIX. */
function crumbs(p: string): { label: string; path: string; sep: string }[] {
  if (p.includes('\\')) {
    const parts = p.split('\\').filter(Boolean);
    return parts.map((part, i) => ({ label: part, path: i === 0 ? `${part}\\` : parts.slice(0, i + 1).join('\\'), sep: '\\' }));
  }
  const parts = p.split('/').filter(Boolean);
  return [
    { label: '/', path: '/', sep: '' },
    ...parts.map((part, i) => ({ label: part, path: '/' + parts.slice(0, i + 1).join('/'), sep: '/' })),
  ];
}

interface Props {
  initialPath?: string;
  onPick(path: string): void;
  onClose(): void;
}

/**
 * Browses folders through the local API. Browser-native pickers don't reveal
 * absolute paths, which the server needs to run git, so we roll our own.
 */
export function FolderPicker({ initialPath, onPick, onClose }: Props) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const go = async (path?: string) => {
    setLoading(true);
    setError(undefined);
    try {
      setListing(await listFolders(path));
      setFilter('');
    } catch (e) {
      setError((e as Error).message);
      // Fall back to the home folder if the starting path is gone.
      if (!listing && path) setListing(await listFolders().catch(() => null));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void go(initialPath || undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // Only on open.

  const entries = listing?.entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass window flex h-[min(620px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a folder"
      >
        <div className="window-title flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Choose a repository folder</h2>
          <div className="ml-auto flex gap-1">
            {listing?.roots.map((r) => (
              <button
                key={r.path}
                onClick={() => go(r.path)}
                className="btn rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:bg-white/10"
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-white/5 px-4 py-2 font-mono text-xs">
          {listing?.parent && (
            <button onClick={() => go(listing.parent!)} className="mr-1 rounded px-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Up one level">
              ↑
            </button>
          )}
          {listing &&
            crumbs(listing.path).map((c, i, all) => (
              <span key={c.path} className="flex items-center gap-1">
                <button onClick={() => go(c.path)} className={`rounded px-1 hover:bg-white/10 ${i === all.length - 1 ? 'text-white' : 'text-slate-400'}`}>
                  {c.label}
                </button>
                {i < all.length - 1 && c.sep && <span className="text-slate-600">{c.sep}</span>}
              </span>
            ))}
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && entries.length === 1 && go(entries[0].path)}
            placeholder="Filter"
            className="field ml-auto w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-sans outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
          />
        </div>

        <ul className="list-pane scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
          {error && <li className="px-3 py-2 text-xs text-rose-300">{error}</li>}
          {!loading && listing && entries.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-500">No subfolders</li>}
          {entries.map((e) => (
            <li key={e.path}>
              <button
                onClick={() => go(e.path)}
                onDoubleClick={() => e.isRepo && onPick(e.path)}
                className="list-row group flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-white/5"
              >
                <FolderIcon repo={e.isRepo} />
                <span className={`truncate ${e.isRepo ? 'text-white' : 'text-slate-300'}`}>{e.name}</span>
                {e.isRepo && (
                  <span className="ml-auto shrink-0 rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300 ring-1 ring-cyan-400/25">git</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3 border-t border-white/5 px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {listing?.isRepo ? (
              <span className="text-cyan-300">This folder is a git repository</span>
            ) : (
              'Open a folder marked git, or select any folder inside a repository'
            )}
          </span>
          <button onClick={onClose} className="btn rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10">
            Cancel
          </button>
          <button
            onClick={() => listing && onPick(listing.path)}
            disabled={!listing}
            className="btn btn-primary rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-400 px-4 py-1.5 text-xs font-semibold text-ink-950 hover:brightness-110 disabled:opacity-40"
          >
            Visualize this folder
          </button>
        </div>
      </div>
    </div>
  );
}
