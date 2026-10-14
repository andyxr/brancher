import { create } from 'zustand';

/**
 * UI themes. The active theme is set as `data-theme` on <html>; CSS in
 * index.css remaps Tailwind's color tokens and restyles chrome per theme.
 * SVG colors can't come from Tailwind classes, so they live in `palette()`.
 */
export type ThemeId = 'neon' | 'mac_os_8';

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'neon', label: 'Neon' },
  { id: 'mac_os_8', label: 'Mac OS 8' },
];

const STORAGE_KEY = 'brancher.theme';
const DEFAULT_THEME: ThemeId = 'neon';

export interface Palette {
  trunk: string;
  /** Fill for hollow glyphs (commit dots, merge markers) so they read as holes. */
  hole: string;
  /** Halo behind branch labels so they stay legible over crossing lines. */
  labelHalo: string;
  axisBg: string;
  axisBgOpacity: number;
  /** Grid, axis rule and tick strokes. */
  ink: string;
  gridOpacity: number;
  /** Minimap viewport window. */
  window: string;
  /** Whether focused/trunk branches get a blurred glow. */
  glow: boolean;
  branch: { saturation: number; lightness: number; lightnessMax: number };
  legend: { merged: string; squashed: string; open: string; abandoned: string };
}

const PALETTES: Record<ThemeId, Palette> = {
  neon: {
    trunk: '#67e8f9',
    hole: '#0a0c14',
    labelHalo: '#05060b',
    axisBg: '#0a0c14',
    axisBgOpacity: 0.92,
    ink: 'white',
    gridOpacity: 0.04,
    window: 'white',
    glow: true,
    branch: { saturation: 92, lightness: 62, lightnessMax: 78 },
    legend: { merged: '#c4b5fd', squashed: '#f0abfc', open: '#bef264', abandoned: '#94a3b8' },
  },
  mac_os_8: {
    trunk: '#2a4ea0',
    hole: '#ffffff',
    labelHalo: '#ffffff',
    axisBg: '#dcdcdc',
    axisBgOpacity: 1,
    ink: '#000000',
    gridOpacity: 0.08,
    window: '#000000',
    glow: false,
    branch: { saturation: 70, lightness: 36, lightnessMax: 48 },
    legend: { merged: '#5b3a9e', squashed: '#8a2a8a', open: '#2f7a1f', abandoned: '#6a6a6a' },
  },
};

export const palette = (theme: ThemeId): Palette => PALETTES[theme];

function readStored(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (THEMES.some((t) => t.id === raw)) return raw as ThemeId;
  } catch {
    // Storage may be unavailable; fall back to the default.
  }
  return DEFAULT_THEME;
}

function apply(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: ThemeId;
  setTheme(theme: ThemeId): void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: readStored(),
  setTheme: (theme) => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme choice is a convenience only.
    }
    set({ theme });
  },
}));

/** Current theme's SVG palette; re-renders the caller when the theme changes. */
export const usePalette = () => palette(useTheme((s) => s.theme));

// Apply before the first render so there's no flash of the default theme.
apply(useTheme.getState().theme);
