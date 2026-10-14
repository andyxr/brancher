import type { Timeline as TimelineData } from '@brancher/core/browser';
import type { ScaleTime } from 'd3';
import { memo, useRef } from 'react';
import type { ViewModel } from '../store.ts';
import { usePalette, type Palette } from '../theme.ts';
import { branchColor } from './colors.ts';
import type { View } from './Timeline.tsx';

interface Props {
  vm: ViewModel;
  data: TimelineData;
  base: ScaleTime<number, number>;
  view: View;
  size: { w: number; h: number };
  laneH: number;
  top: number;
  /** Animate mode's current time, or null. */
  playhead: number | null;
  /** Centers the main view on a point in unzoomed content coordinates. */
  onNavigate(cx: number, cy: number): void;
}

const H = 56;
const MARGIN = 16;

/** Overview of the whole history. Drag or click to move the main view. */
export function Minimap({ vm, data, base, view, size, laneH, top, playhead, onNavigate }: Props) {
  const w = Math.min(size.w - MARGIN * 2, 520);
  const [r0, r1] = base.range();
  const sx = (px: number) => ((px - r0) / (r1 - r0)) * w;
  const sy = (lane: number) => 6 + (lane / Math.max(vm.laneCount - 1, 1)) * (H - 12);
  const dragging = useRef(false);
  const p = usePalette();

  // Main-view window in base coordinates.
  const winX0 = (0 - view.tx) / view.k;
  const winX1 = (size.w - view.tx) / view.k;
  const lane0 = (-view.ty - top) / laneH;
  const lane1 = (size.h - view.ty - top) / laneH;

  const navigate = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = Math.min(Math.max(e.clientX - rect.left, 0), w);
    const my = Math.min(Math.max(e.clientY - rect.top, 0), H);
    const cx = r0 + (mx / w) * (r1 - r0);
    const lane = ((my - 6) / (H - 12)) * Math.max(vm.laneCount - 1, 1);
    onNavigate(cx, top + lane * laneH);
  };

  return (
    <div
      className="glass absolute bottom-4 left-4 rounded-xl p-1.5 shadow-2xl shadow-black/50"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <svg
        width={w}
        height={H}
        className="block cursor-crosshair"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          navigate(e);
        }}
        onPointerMove={(e) => dragging.current && navigate(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        <MinimapLines vm={vm} data={data} base={base} p={p} sx={sx} sy={sy} />
        <rect
          x={sx(winX0)}
          y={Math.max(sy(lane0), 0)}
          width={Math.max(sx(winX1) - sx(winX0), 3)}
          height={Math.max(Math.min(sy(lane1), H) - Math.max(sy(lane0), 0), 4)}
          fill={p.window}
          fillOpacity={0.06}
          stroke={p.window}
          strokeOpacity={0.5}
          rx={3}
        />
        {playhead !== null && (
          <line
            x1={sx(base(new Date(playhead * 1000)))}
            x2={sx(base(new Date(playhead * 1000)))}
            y1={0}
            y2={H}
            stroke={p.playhead}
            strokeWidth={1.5}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}

/** Branch lines don't change while panning, so skip re-rendering unless the layout changes. */
const MinimapLines = memo(function MinimapLines({
  vm,
  data,
  base,
  p,
  sx,
  sy,
}: {
  vm: ViewModel;
  data: TimelineData;
  base: ScaleTime<number, number>;
  p: Palette;
  sx: (px: number) => number;
  sy: (lane: number) => number;
}) {
  const lines = vm.branches.map((b) => {
    const s = b.forkTime ?? b.createdAt;
    const e = b.status === 'open' || b.status === 'trunk' ? data.range.end : (b.mergedAt ?? b.lastActivity);
    return { id: b.id, x1: sx(base(new Date(s * 1000))), x2: sx(base(new Date(e * 1000))), y: sy(b.lane), color: branchColor(b, p) };
  });
  return (
    <g strokeLinecap="round">
      {lines.map((l) => (
        <line key={l.id} x1={l.x1} x2={Math.max(l.x2, l.x1 + 1)} y1={l.y} y2={l.y} stroke={l.color} strokeOpacity={0.7} strokeWidth={1.2} />
      ))}
    </g>
  );
}, (a, b) => a.vm === b.vm && a.data === b.data && a.base === b.base && a.p === b.p);
