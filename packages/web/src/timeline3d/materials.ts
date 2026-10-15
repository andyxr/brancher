import { Color, type Plane } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Point3 } from './layout3d.ts';

/** three's colour parser only reads the legacy comma form of hsl(). */
export const toColor = (css: string) => new Color(css.replace(/^hsl\((\S+) (\S+) (\S+)\)$/, 'hsl($1, $2, $3)'));

export interface Strand {
  /** Owner id reported back when one of this strand's segments is hit. */
  id: string;
  path: Point3[];
  color: Color;
}

/**
 * Every strand in one fat-line draw call. The clip plane hides whatever lies beyond the playhead,
 * so playback never rebuilds geometry. `owners[segment]` maps a raycast hit back to its strand.
 */
export function buildStrands(strands: Strand[], o: { width: number; opacity: number; clip: Plane }) {
  const positions: number[] = [];
  const colors: number[] = [];
  const owners: string[] = [];
  for (const s of strands) {
    for (let i = 1; i < s.path.length; i++) {
      const [a, b] = [s.path[i - 1], s.path[i]];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      colors.push(s.color.r, s.color.g, s.color.b, s.color.r, s.color.g, s.color.b);
      owners.push(s.id);
    }
  }
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);
  const material = new LineMaterial({
    linewidth: o.width,
    vertexColors: true,
    transparent: o.opacity < 1,
    opacity: o.opacity,
    clippingPlanes: [o.clip],
  });
  material.fog = true;
  return { object: new LineSegments2(geometry, material), owners };
}
