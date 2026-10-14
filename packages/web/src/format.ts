const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dayFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export const fmtDateTime = (sec: number) => dateFmt.format(sec * 1000);
export const fmtDate = (sec: number) => dayFmt.format(sec * 1000);

export function fmtDuration(sec: number): string {
  const abs = Math.abs(sec);
  if (abs < 3600) return `${Math.max(1, Math.round(abs / 60))}m`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h`;
  if (abs < 86400 * 60) return `${Math.round(abs / 86400)}d`;
  if (abs < 86400 * 730) return `${Math.round(abs / (86400 * 30))}mo`;
  return `${(abs / (86400 * 365)).toFixed(1)}y`;
}

export const shortSha = (h: string) => h.slice(0, 7);
