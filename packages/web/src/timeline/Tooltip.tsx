import type { Branch } from '@brancher/core/browser';
import { fmtDateTime, fmtDuration, shortSha } from '../format.ts';
import type { ViewModel } from '../store.ts';
import { usePalette } from '../theme.ts';
import { branchColor, STATUS_CLASS, STATUS_LABEL } from './colors.ts';

export function topAuthors(b: Branch, n = 3): string[] {
  const counts = new Map<string, number>();
  for (const c of b.commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  return [...counts.entries()].sort((a, c) => c[1] - a[1]).slice(0, n).map(([a]) => a);
}

export const createdLabel = (b: Branch) =>
  b.createdAtSource === 'first-commit' ? `≈ ${fmtDateTime(b.createdAt)}` : fmtDateTime(b.createdAt);

export function Tooltip({ branch: b, vm, x, y, width }: { branch: Branch; vm: ViewModel; x: number; y: number; width: number }) {
  const parent = b.parentId ? vm.byId.get(b.parentId) : undefined;
  const into = b.mergedInto ? vm.byId.get(b.mergedInto) : undefined;
  const endTime = b.mergedAt ?? b.lastActivity;
  const authors = topAuthors(b);
  const color = branchColor(b, usePalette());
  const left = x + 300 > width ? x - 296 : x + 16;

  return (
    <div className="glass tooltip pointer-events-none absolute z-20 w-[280px] rounded-xl p-3 text-xs shadow-2xl shadow-black/60" style={{ left, top: y + 16 }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <span className="truncate font-mono text-[13px] font-medium text-white">{b.name}</span>
        <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] ring-1 ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</span>
      </div>
      <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-slate-300">
        {parent && (
          <>
            <dt className="text-slate-500">From</dt>
            <dd className="truncate font-mono">
              {parent.name}
              {b.forkCommit && <span className="text-slate-500"> @{shortSha(b.forkCommit)}</span>}
            </dd>
          </>
        )}
        <dt className="text-slate-500">Created</dt>
        <dd>{createdLabel(b)}</dd>
        {b.mergedAt && (
          <>
            <dt className="text-slate-500">Merged</dt>
            <dd>
              {fmtDateTime(b.mergedAt)}
              {into && <span className="font-mono text-slate-400"> → {into.name}</span>}
            </dd>
          </>
        )}
        {b.status !== 'trunk' && (
          <>
            <dt className="text-slate-500">Lifetime</dt>
            <dd>{fmtDuration(endTime - b.createdAt)}</dd>
          </>
        )}
        <dt className="text-slate-500">Commits</dt>
        <dd>{b.status === 'squashed' ? 'squashed into 1' : b.commits.length}</dd>
        {authors.length > 0 && (
          <>
            <dt className="text-slate-500">Authors</dt>
            <dd className="truncate">{authors.join(', ')}</dd>
          </>
        )}
        {b.pr && (
          <>
            <dt className="text-slate-500">PR</dt>
            <dd className="truncate">
              #{b.pr.number} {b.pr.title}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
