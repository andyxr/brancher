import { THEMES, useTheme, type ThemeId } from './theme.ts';

export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <label className={`theme-switcher flex items-center gap-1.5 text-[11px] text-slate-500 ${className}`}>
      Theme
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        aria-label="Choose UI theme"
        className="field rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-400/50"
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
