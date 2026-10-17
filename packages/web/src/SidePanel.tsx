import type { Branch } from '@brancher/core/browser';
import { fmtDateTime, fmtDuration, shortSha } from './format.ts';
import { useStore, type ViewModel } from './store.ts';
import { usePalette } from './theme.ts';
import { branchColor, STATUS_CLASS, STATUS_LABEL } from './timeline/colors.ts';
import { createdLabel, topAuthors } from './timeline/Tooltip.tsx';

const CREATED_SOURCE: Record<Branch['createdAtSource'], string> = {
  reflog: 'Exact, from the branch reflog',
  'first-commit': 'Inferred from the first commit; the branch was created between the fork point and this time',
  pr: 'From the pull request',
  root: 'First commit of the history',
};

function BranchLink({ b, onPick }: { b: Branch; onPick(id: string): void }) {
  const p = usePalette();
  return (
    <button onClick={() => onPick(b.id)} className="inline-flex max-w-full items-center gap-1.5 truncate font-mono hover:underline">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: branchColor(b, p) }} />
      <span className="truncate">{b.name}</span>
    </button>
  );
}

export function SidePanel({ vm, onFocus }: { vm: ViewModel; onFocus(id: string): void }) {
  const selectedId = useStore((s) => s.selectedId);
  const setSelected = useStore((s) => s.setSelected);
  const p = usePalette();
  const b = selectedId ? vm.byId.get(selectedId) : undefined;
  if (!b) return null;

  const pick = (id: string) => {
    setSelected(id);
    onFocus(id);
  };
  const parent = b.parentId ? vm.byId.get(b.parentId) : undefined;
  const children = vm.branches.filter((c) => c.parentId === b.id).sort((x, y) => x.createdAt - y.createdAt);
  const color = branchColor(b, p);
  const commits = [...b.commits].reverse();

  return (
    <aside className="glass window side-panel scroll-thin absolute right-4 top-4 bottom-4 z-30 flex w-[360px] flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/60">
      <div className="window-title border-b border-white/5 p-4" style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${color} 14%, transparent), transparent 70%)` }}>
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 break-words font-mono text-[15px] font-semibold text-white">{b.name}</h2>
          <button onClick={() => setSelected(null)} className="rounded-md px-1.5 text-lg leading-none text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`status-pill rounded-full px-2 py-0.5 ring-1 ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</span>
          {b.nameSource !== 'ref' && (
            <span className="text-slate-500">
              {b.nameSource === 'synthetic' ? 'name unknown (branch deleted)' : `name from ${b.nameSource === 'pr' ? 'pull request' : 'merge message'}`}
            </span>
          )}
        </div>
        {b.pr?.url && (
          <a href={b.pr.url} target="_blank" rel="noreferrer" className="mt-3 block rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10">
            <span className="text-fuchsia-300">PR #{b.pr.number}</span> {b.pr.title}
            {b.pr.author && <span className="text-slate-500"> · {b.pr.author}</span>}
          </a>
        )}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-4 text-xs">
        <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-slate-300">
          {parent && (
            <>
              <dt className="text-slate-500">Forked from</dt>
              <dd className="min-w-0">
                <BranchLink b={parent} onPick={pick} />
                {b.forkCommit && <div className="font-mono text-slate-500">at {shortSha(b.forkCommit)} · {b.forkTime && fmtDateTime(b.forkTime)}</div>}
              </dd>
            </>
          )}
          <dt className="text-slate-500">Created</dt>
          <dd title={CREATED_SOURCE[b.createdAtSource]}>
            {createdLabel(b)}
            <div className="text-slate-500">{CREATED_SOURCE[b.createdAtSource]}</div>
          </dd>
          {b.status !== 'trunk' && (
            <>
              <dt className="text-slate-500">Lifetime</dt>
              <dd>{fmtDuration((b.mergedAt ?? b.lastActivity) - b.createdAt)}</dd>
            </>
          )}
          <dt className="text-slate-500">Last commit</dt>
          <dd>{fmtDateTime(b.lastActivity)}</dd>
          <dt className="text-slate-500">Authors</dt>
          <dd>{topAuthors(b, 6).join(', ') || '—'}</dd>
        </dl>

        {b.merges.length > 0 && (
          <Section title={`Merges (${b.merges.length})`}>
            {b.merges.map((m) => {
              const into = vm.byId.get(m.into);
              return (
                <li key={m.commit} className="flex items-center gap-2">
                  <span className="text-slate-500">{fmtDateTime(m.at)}</span>
                  <span className="text-slate-600">→</span>
                  {into ? <BranchLink b={into} onPick={pick} /> : <span className="text-slate-500">hidden branch</span>}
                  {!m.head && <span className="text-fuchsia-300/70">squash</span>}
                </li>
              );
            })}
          </Section>
        )}

        {children.length > 0 && (
          <Section title={`Branched off here (${children.length})`}>
            {children.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <BranchLink b={c} onPick={pick} />
                <span className="ml-auto shrink-0 text-slate-500">{createdLabel(c)}</span>
              </li>
            ))}
          </Section>
        )}

        <Section title={`Commits (${b.commits.length})`}>
          {commits.slice(0, 300).map((c) => (
            <li key={c.hash} className="grid grid-cols-[56px_1fr] gap-x-2 py-0.5">
              <span className="font-mono text-slate-500">{shortSha(c.hash)}</span>
              <span className="min-w-0">
                <span className="block truncate text-slate-200" title={c.subject}>
                  {c.subject}
                </span>
                <span className="text-slate-500">
                  {c.author} · {fmtDateTime(c.time)}
                </span>
              </span>
            </li>
          ))}
          {commits.length > 300 && <li className="text-slate-500">…and {commits.length - 300} more</li>}
          {b.status === 'squashed' && <li className="text-slate-500">Individual commits were squashed away on merge.</li>}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}
