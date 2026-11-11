/**
 * The lens for the Liquid Glass theme, referenced from index.css as `backdrop-filter: url(#lg-refract)`.
 * Low-frequency noise drives a displacement map, so the backdrop seen through the top bar bends like
 * thick glass. Inert unless a rule references it; the CSS only does so in Chromium (`data-glass-refract`).
 */
export function LiquidGlassFilter() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
      <filter id="lg-refract" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves={1} seed={7} result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2" result="softNoise" />
        <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="8" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
