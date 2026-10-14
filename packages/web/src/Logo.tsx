// Colors come from --logo-a / --logo-b so each theme can recolor the mark.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" strokeLinecap="round">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--logo-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--logo-b)' }} />
        </linearGradient>
      </defs>
      <path d="M4 8h24" style={{ stroke: 'var(--logo-a)' }} strokeWidth="3" />
      <path d="M9 8c4 0 4 8 8 8h5c4 0 4-8 6-8" stroke="url(#logo-g)" strokeWidth="2.5" />
      <path d="M13 16c3 0 3 8 7 8h4" style={{ stroke: 'var(--logo-b)' }} strokeWidth="2.5" />
      <circle cx="24" cy="24" r="2.5" style={{ fill: 'var(--logo-b)' }} />
    </svg>
  );
}
