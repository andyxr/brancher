import { create } from 'zustand';

/**
 * UI themes. Each theme's `css` id is set as `data-theme` on <html>; CSS in
 * index.css remaps Tailwind's color tokens and restyles chrome per css id, so
 * variants like Mac OS 8 Mono share chrome and differ only in `palette()`.
 * SVG colors can't come from Tailwind classes, so they live in `palette()`.
 */
export type ThemeId = 'pigment' | 'mac_os_8' | 'mac_os_8_mono';

export const THEMES: { id: ThemeId; label: string; css: string }[] = [
  { id: 'pigment', label: 'Pigment', css: 'pigment' },
  { id: 'mac_os_8', label: 'Mac OS 8', css: 'mac_os_8' },
  { id: 'mac_os_8_mono', label: 'Mac OS 8 Mono', css: 'mac_os_8' },
];

const STORAGE_KEY = 'brancher.theme';
const DEFAULT_THEME: ThemeId = 'pigment';

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
  /** Animate mode's playhead rule and date pill. */
  playhead: string;
  /** Text on the playhead's date pill. */
  playheadText: string;
  /** Pop ring on events that just happened during playback. */
  flash: string;
  /** Whether focused/trunk branches get a blurred glow. */
  glow: boolean;
  /**
   * Feature-branch colors: hashed hue at fixed saturation, or, when `swatches`
   * is set, a hashed pick from that curated list. Depth lightens either way.
   */
  branch: {
    saturation: number;
    lightness: number;
    lightnessMax: number;
    swatches?: { h: number; s: number; l: number }[];
  };
  legend: { merged: string; squashed: string; open: string; abandoned: string };
}

const MAC_OS_8: Palette = {
  trunk: '#2a4ea0',
  hole: '#ffffff',
  labelHalo: '#ffffff',
  axisBg: '#dcdcdc',
  axisBgOpacity: 1,
  ink: '#000000',
  gridOpacity: 0.08,
  window: '#000000',
  playhead: '#000000',
  playheadText: '#ffffff',
  flash: '#16307a',
  glow: false,
  branch: { saturation: 70, lightness: 36, lightnessMax: 48 },
  legend: { merged: '#5b3a9e', squashed: '#8a2a8a', open: '#2f7a1f', abandoned: '#6a6a6a' },
};

const PALETTES: Record<ThemeId, Palette> = {
  pigment: {
    trunk: '#e8dfcc',
    hole: '#181612',
    labelHalo: '#12110e',
    axisBg: '#181612',
    axisBgOpacity: 0.94,
    ink: '#f3eee4',
    gridOpacity: 0.045,
    window: '#f3eee4',
    playhead: '#d4a24c',
    playheadText: '#12110e',
    flash: '#f3eee4',
    glow: false,
    branch: {
      saturation: 40,
      lightness: 64,
      lightnessMax: 76,
      // Earth and ink pigments: muted enough to sit quietly, spread across
      // hue and lightness so neighbouring lanes still separate.
      swatches: [
        { h: 36, s: 58, l: 60 }, // ochre
        { h: 14, s: 52, l: 62 }, // terracotta
        { h: 92, s: 26, l: 60 }, // sage
        { h: 210, s: 32, l: 66 }, // slate blue
        { h: 330, s: 22, l: 66 }, // dusty plum
        { h: 176, s: 24, l: 56 }, // verdigris
        { h: 52, s: 40, l: 66 }, // lichen
        { h: 262, s: 20, l: 70 }, // heather
        { h: 24, s: 34, l: 55 }, // umber
        { h: 228, s: 36, l: 72 }, // denim
        { h: 350, s: 38, l: 64 }, // madder
        { h: 72, s: 30, l: 50 }, // moss
      ],
    },
    legend: { merged: '#8fa3c0', squashed: '#c48b78', open: '#a3b477', abandoned: '#8a847a' },
  },
  mac_os_8: MAC_OS_8,
  mac_os_8_mono: {
    ...MAC_OS_8,
    trunk: '#000000',
    // Every lane is black; the lightness cap stops depth from greying them.
    branch: { ...MAC_OS_8.branch, lightnessMax: 0, swatches: [{ h: 0, s: 0, l: 0 }] },
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
  document.documentElement.dataset.theme = THEMES.find((t) => t.id === theme)!.css;
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
