import type { Branch, Timeline as TimelineData } from '@brancher/core/browser';
import { scaleTime } from 'd3';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { fmtDate } from '../format.ts';
import { useStore, type ViewModel } from '../store.ts';
import { usePalette, type Palette } from '../theme.ts';
import { branchColor } from './colors.ts';
import { Minimap } from './Minimap.tsx';
import type { PlaybackClock } from './playback.ts';
import { Tooltip } from './Tooltip.tsx';
import { usePrefersReducedMotion } from './usePlayback.ts';

export const AXIS_H = 40;
export const LANE_H = 30;
const TOP = AXIS_H + 34;
const LEFT = 32;
const RIGHT = 80;
const BOTTOM = 92; // room for the minimap
const FORK_W = 14;
const PANEL_W = 380; // SidePanel width + margin
/** How long an event's pop ring lasts, in seconds of 1× playback. */
const FLASH_S = 0.7;

export interface View {
  k: number;
  tx: number;
  ty: number;
}

export interface TimelineHandle {
  fit(): void;
  focus(id: string): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
}

interface Props {
  data: TimelineData;
  vm: ViewModel;
  clock: PlaybackClock;
}

const toDate = (sec: number) => new Date(sec * 1000);

export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline({ data, vm, clock }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const hoveredId = useStore((s) => s.hoveredId);
  const selectedId = useStore((s) => s.selectedId);
  const setHovered = useStore((s) => s.setHovered);
  const setSelected = useStore((s) => s.setSelected);
  const playback = useStore((s) => s.playback);
  const speed = useStore((s) => s.speed);
  const reducedMotion = usePrefersReducedMotion();
  const p = usePalette();

  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { start, end } = data.range;
  const pad = Math.max((end - start) * 0.02, 3600);
  const base = useMemo(
    () => scaleTime().domain([toDate(start - pad), toDate(end + pad)]).range([LEFT, Math.max(size.w - RIGHT, LEFT + 10)]),
    [start, end, pad, size.w],
  );
  const x = useMemo(() => {
    const [r0, r1] = base.range();
    return base.copy().range([r0 * view.k + view.tx, r1 * view.k + view.tx]);
  }, [base, view.k, view.tx]);
  const xs = useCallback((sec: number) => x(toDate(sec)), [x]);
  const laneY = useCallback((lane: number) => TOP + lane * LANE_H + view.ty, [view.ty]);

  const contentH = TOP + vm.laneCount * LANE_H + BOTTOM;
  const overflows = contentH > size.h + 1;
  const maxK = Math.max(4, (end - start + 2 * pad) / 1800);

  const clamp = useCallback(
    (v: View): View => {
      const k = Math.min(Math.max(v.k, 1), maxK);
      const [r0, r1] = base.range();
      // Keep at least part of the timeline on screen.
      const tx = Math.min(Math.max(v.tx, size.w * 0.5 - r1 * k), size.w * 0.5 - r0 * k);
      const ty = Math.min(Math.max(v.ty, Math.min(0, size.h - contentH)), 0);
      return { k, tx, ty };
    },
    [base, maxK, size.w, size.h, contentH],
  );
  const update = useCallback((fn: (v: View) => View) => setView((v) => clamp(fn(v))), [clamp]);
  // Panning by hand means the user wants to look elsewhere, so the camera stops chasing the playhead.
  const unfollow = () => useStore.getState().setFollow(false);

  const zoomAt = useCallback(
    (px: number, factor: number) =>
      update((v) => {
        const k = Math.min(Math.max(v.k * factor, 1), maxK);
        // While following, zoom around the playhead so it stays put instead of sliding off screen.
        const playback = useStore.getState().playback;
        const ax = playback?.follow ? base(toDate(playback.t)) * v.k + v.tx : px;
        return { ...v, k, tx: ax - ((ax - v.tx) * k) / v.k };
      }),
    [update, maxK, base],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: () => setView({ k: 1, tx: 0, ty: 0 }),
      zoomBy: (f) => zoomAt(size.w / 2, f),
      panBy: (dx, dy) => {
        if (dx) unfollow();
        update((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      },
      focus: (id) => {
        const b = vm.byId.get(id);
        if (!b) return;
        unfollow();
        const s = b.forkTime ?? b.createdAt;
        const e = Math.max(b.mergedAt ?? b.lastActivity, s + 3600);
        const span = base(toDate(e)) - base(toDate(s));
        // Focusing selects the branch, so center it in the space left of the side panel.
        const w = Math.max(size.w - PANEL_W, size.w / 2);
        const k = Math.min(Math.max(((w - LEFT - RIGHT) * 0.6) / Math.max(span, 1), 1), maxK);
        const mid = (base(toDate(s)) + base(toDate(e))) / 2;
        setView(clamp({ k, tx: w / 2 - mid * k, ty: size.h / 2 - (TOP + b.lane * LANE_H) }));
      },
    }),
    [vm.byId, base, size, maxK, clamp, update, zoomAt],
  );

  // Wheel zooms the time axis; shift+wheel scrolls lanes; horizontal trackpad swipes pan.
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        update((v) => ({ ...v, ty: v.ty - (e.deltaY || e.deltaX) }));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Trackpad zooms carry sideways jitter; only a clearly sideways swipe means "look elsewhere".
        if (Math.abs(e.deltaX) > 2 * Math.abs(e.deltaY)) unfollow();
        update((v) => ({ ...v, tx: v.tx - e.deltaX }));
      } else {
        const rect = el.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [update, zoomAt]);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // Set on pointerup so the click that ends a drag doesn't select a branch.
  const justDragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    // Capture only once dragging starts; capturing on pointerdown would retarget clicks away from branches.
    if (!d.moved) {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      unfollow();
    }
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    update((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    justDragged.current = d?.moved ?? false;
    if (d && !d.moved && (e.target as Element).closest('[data-branch]') === null) setSelected(null);
  };
  const dragging = drag.current?.moved ?? false;

  // Ancestors + descendants of the focused branch stay lit; the rest dims.
  const focusId = hoveredId ?? selectedId;
  const lineage = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (let b = vm.byId.get(focusId); b?.parentId; b = vm.byId.get(b.parentId)) set.add(b.parentId);
    const walk = (id: string) => {
      for (const c of vm.branches) if (c.parentId === id && !set.has(c.id)) (set.add(c.id), walk(c.id));
    };
    walk(focusId);
    // Merge targets are part of the story too.
    for (const m of vm.byId.get(focusId)?.merges ?? []) set.add(m.into);
    return set;
  }, [focusId, vm]);

  // Follow camera: when the playhead drifts out of the middle band, bring it back to 30% from the left,
  // without scrolling past either end of the history (so at fit zoom the camera stays put).
  const followX = playback?.follow ? xs(playback.t) : null;
  useEffect(() => {
    if (followX === null || (followX >= size.w * 0.25 && followX <= size.w * 0.7)) return;
    const [, r1] = base.range();
    update((v) => ({ ...v, tx: Math.min(Math.max(v.tx + size.w * 0.3 - followX, r1 * (1 - v.k)), 0) }));
  }, [followX, size.w, base, update]);

  const at = playback?.t ?? Infinity;
  const nowProgress = playback ? clock.progressAt(playback.t) : 0;
  const flashAge =
    playback?.playing && !reducedMotion
      ? (t: number) => {
          const age = ((nowProgress - clock.progressAt(t)) * clock.duration) / (FLASH_S * speed);
          return age >= 0 && age < 1 ? age : null;
        }
      : null;

  const [tMin, tMax] = [x.invert(-50).getTime() / 1000, x.invert(size.w + 50).getTime() / 1000];
  // Ticks come from the visible window, not the whole domain, so they refine as you zoom.
  const visibleScale = scaleTime().domain([x.invert(0), x.invert(size.w)]).range([0, size.w]);
  const ticks = visibleScale.ticks(Math.max(2, Math.floor(size.w / 130)));
  const tickFmt = visibleScale.tickFormat();

  const yOf = (id: string, fallback: number) => {
    const b = vm.byId.get(id);
    return b ? laneY(b.lane) : fallback;
  };
  const visible = vm.branches.filter((b) => {
    const s = b.forkTime ?? b.createdAt;
    if (b.status !== 'trunk' && s > at) return false;
    const e = b.status === 'open' ? end : Math.max(b.mergedAt ?? 0, b.lastActivity);
    if (e < tMin || s > tMax) return false;
    const y = laneY(b.lane);
    const ys = [y, b.parentId ? yOf(b.parentId, y) : y, ...b.merges.map((m) => yOf(m.into, y))];
    return Math.max(...ys) > -LANE_H && Math.min(...ys) < size.h + LANE_H;
  });
  // Draw the focused lineage last so it sits on top.
  if (lineage) visible.sort((a, b) => Number(lineage.has(a.id)) - Number(lineage.has(b.id)));

  const hovered = hoveredId ? vm.byId.get(hoveredId) : undefined;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full select-none overflow-hidden ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setPointer(null)}
    >
      <svg width={size.w} height={size.h} className="absolute inset-0">
        {/* Time grid */}
        <g>
          {ticks.map((t) => (
            <line key={+t} x1={x(t)} x2={x(t)} y1={AXIS_H} y2={size.h} stroke={p.ink} strokeOpacity={p.gridOpacity} />
          ))}
          <line x1={xs(end)} x2={xs(end)} y1={AXIS_H} y2={size.h} stroke={p.trunk} strokeOpacity={0.25} strokeDasharray="3 5" />
        </g>

        <g>
          {visible.map((b) => (
            <BranchShape
              key={b.id}
              b={b}
              vm={vm}
              p={p}
              xs={xs}
              laneY={laneY}
              end={end}
              at={at}
              flashAge={flashAge}
              dim={(lineage !== null && !lineage.has(b.id)) || (vm.matches !== null && !vm.matches.has(b.id) && b.status !== 'trunk')}
              focused={b.id === hoveredId || b.id === selectedId}
              showLabel={b.id === focusId || (vm.matches?.has(b.id) ?? false)}
              onEnter={() => !drag.current && setHovered(b.id)}
              onLeave={() => setHovered(null)}
              onClick={() => !justDragged.current && setSelected(b.id)}
            />
          ))}
        </g>

        {/* Axis */}
        <g>
          <rect x={0} y={0} width={size.w} height={AXIS_H} fill={p.axisBg} fillOpacity={p.axisBgOpacity} />
          <line x1={0} x2={size.w} y1={AXIS_H} y2={AXIS_H} stroke={p.ink} strokeOpacity={p.gridOpacity * 2} />
          {ticks.map((t) => (
            <g key={+t} transform={`translate(${x(t)},0)`}>
              <line y1={AXIS_H - 6} y2={AXIS_H} stroke={p.ink} strokeOpacity={0.3} />
              <text y={AXIS_H - 14} textAnchor="middle" className="fill-slate-400 font-mono text-[11px]">
                {tickFmt(t)}
              </text>
            </g>
          ))}
          <text x={xs(end) + 6} y={AXIS_H + 14} className="font-mono text-[10px]" fill={p.trunk} fillOpacity={0.6}>
            latest
          </text>
        </g>

        {playback && <Playhead x={xs(playback.t)} t={playback.t} height={size.h} p={p} />}
      </svg>

      {hovered && pointer && !dragging && <Tooltip branch={hovered} vm={vm} x={pointer.x} y={pointer.y} width={size.w} />}

      <Minimap
        vm={vm}
        data={data}
        base={base}
        view={view}
        size={size}
        laneH={LANE_H}
        top={TOP}
        playhead={playback?.t ?? null}
        onNavigate={(cx, cy) => {
          unfollow();
          update((v) => ({ ...v, tx: size.w / 2 - cx * v.k, ty: size.h / 2 - cy }));
        }}
      />

      {overflows && (
        <LaneScrollbar
          ty={view.ty}
          contentH={contentH}
          viewH={size.h}
          right={selectedId ? PANEL_W : 4}
          onScroll={(ty) => update((v) => ({ ...v, ty }))}
        />
      )}

      <div className="glass keys-hint pointer-events-none absolute bottom-4 right-6 hidden gap-3 rounded-lg px-3 py-2 text-[10px] text-slate-400 md:flex">
        <span><kbd>scroll</kbd> zoom</span>
        {overflows && (
          <span>
            <kbd>shift</kbd>+<kbd>scroll</kbd> lanes
          </span>
        )}
        <span><kbd>drag</kbd> pan</span>
        <span><kbd>f</kbd> fit</span>
        <span><kbd>/</kbd> search</span>
        {playback ? (
          <>
            <span><kbd>space</kbd> play/pause</span>
            <span><kbd>esc</kbd> exit</span>
          </>
        ) : (
          <span><kbd>a</kbd> animate</span>
        )}
      </div>
    </div>
  );
});

/** Animate mode's current-time rule, with its date on a pill in the axis band. */
function Playhead({ x, t, height, p }: { x: number; t: number; height: number; p: Palette }) {
  const label = fmtDate(t);
  const w = label.length * 6.6 + 16;
  return (
    <g pointerEvents="none">
      {p.glow && <line x1={x} x2={x} y1={AXIS_H} y2={height} stroke={p.playhead} strokeWidth={6} strokeOpacity={0.3} style={{ filter: 'blur(4px)' }} />}
      <line x1={x} x2={x} y1={AXIS_H} y2={height} stroke={p.playhead} strokeWidth={1.5} />
      <rect x={x - w / 2} y={AXIS_H - 30} width={w} height={20} rx={p.glow ? 10 : 2} fill={p.playhead} />
      <path d={`M${x - 5},${AXIS_H - 10} L${x},${AXIS_H - 4} L${x + 5},${AXIS_H - 10}Z`} fill={p.playhead} />
      <text x={x} y={AXIS_H - 16} textAnchor="middle" className="font-mono text-[11px] font-semibold" fill={p.playheadText}>
        {label}
      </text>
    </g>
  );
}

/** Vertical scrollbar for the lanes; only shown when they don't all fit. */
function LaneScrollbar({
  ty,
  contentH,
  viewH,
  right,
  onScroll,
}: {
  ty: number;
  contentH: number;
  viewH: number;
  right: number;
  onScroll(ty: number): void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; ty: number } | null>(null);
  const trackH = Math.max(viewH - AXIS_H - 16, 1);
  const thumbH = Math.max((viewH / contentH) * trackH, 28);
  const maxScroll = contentH - viewH;
  const thumbTop = (-ty / maxScroll) * (trackH - thumbH);
  // Track pixels → content pixels.
  const ratio = maxScroll / Math.max(trackH - thumbH, 1);

  return (
    <div
      ref={trackRef}
      className="lane-scroll group absolute w-2.5 cursor-pointer rounded-full bg-white/[0.03] transition-[width] hover:w-3"
      style={{ top: AXIS_H + 8, height: trackH, right }}
      onPointerDown={(e) => {
        e.stopPropagation();
        // Clicking the track centers the thumb there.
        const rect = trackRef.current!.getBoundingClientRect();
        const target = e.clientY - rect.top - thumbH / 2;
        onScroll(-target * ratio);
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="lane-scroll-thumb absolute inset-x-0 cursor-grab rounded-full bg-white/20 shadow-[0_0_8px_rgba(232,223,204,0.15)] transition-colors group-hover:bg-cyan-300/50 active:cursor-grabbing"
        style={{ top: thumbTop, height: thumbH }}
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.current = { y: e.clientY, ty };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) onScroll(d.ty - (e.clientY - d.y) * ratio);
        }}
        onPointerUp={() => (drag.current = null)}
      />
    </div>
  );
}

interface ShapeProps {
  b: Branch;
  vm: ViewModel;
  p: Palette;
  xs: (sec: number) => number;
  laneY: (lane: number) => number;
  end: number;
  /** Playhead: anything that happens after this time isn't drawn. Infinity outside animate mode. */
  at: number;
  /** 0..1 age of an event's pop ring, or null when it shouldn't flash. Null outside playback. */
  flashAge: ((t: number) => number | null) | null;
  dim: boolean;
  focused: boolean;
  showLabel: boolean;
  onEnter(): void;
  onLeave(): void;
  onClick(): void;
}

function sCurve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

function BranchShape({ b, vm, p, xs, laneY, end, at, flashAge, dim, focused, showLabel, onEnter, onLeave, onClick }: ShapeProps) {
  const color = branchColor(b, p);
  const y = laneY(b.lane);
  const isTrunk = b.status === 'trunk';
  const parent = b.parentId ? vm.byId.get(b.parentId) : undefined;
  const xf = xs(b.forkTime ?? b.createdAt);
  const xBend = parent ? xf + FORK_W : xf;
  const xCreated = Math.max(xs(b.createdAt), xBend);
  const commitTime = new Map(b.commits.map((c) => [c.hash, c.time]));

  const allMerges = b.merges
    .filter((m) => vm.byId.has(m.into))
    .map((m) => {
      const xm = xs(m.at);
      const headTime = m.head ? (commitTime.get(m.head) ?? b.lastActivity) : m.at;
      // Leave from the merged commit itself so the bar never runs past its own connector,
      // even if that makes the curve steep when the merge came right after the last commit.
      return { m, xm, x1: Math.max(Math.min(xs(headTime), xm), xCreated), yInto: laneY(vm.byId.get(m.into)!.lane) };
    });

  const live = isTrunk || b.status === 'open';
  const xLast = Math.max(xs(b.lastActivity), xCreated);
  const xBarEnd = Math.max(xLast, ...allMerges.map((m) => m.x1));

  // Clip to the playhead: elements appear as their moment passes.
  const xAt = Number.isFinite(at) ? xs(at) : Infinity;
  const created = b.createdAt <= at;
  const settled = b.lastActivity <= at;
  const merges = allMerges.filter(({ m }) => m.at <= at);
  const commits = b.commits.filter((c) => c.time <= at);
  const xBarTo = Math.min(xBarEnd, xAt);
  const xTail = live ? Math.min(xs(end), xAt) : xBarTo;

  const width = isTrunk ? 4 : 2.5;
  const opacity = dim ? 0.12 : b.status === 'abandoned' ? 0.5 : 1;
  const stroke = isTrunk ? p.trunk : color;
  // Connectors are context, not content: keep them quiet unless this branch is in focus.
  const linkOpacity = focused ? 0.95 : 0.4;
  const pxPerCommit = (xLast - xCreated) / Math.max(b.commits.length, 1);
  const showDots = pxPerCommit > 5 || (focused && pxPerCommit > 2.5);
  const labelX = Math.max(xCreated, 8) + 6;
  const labelVisible = showLabel || focused || isTrunk || xTail - Math.max(xCreated, 0) > 90;

  const strokes = (scale: number) => (
    <g fill="none" strokeLinecap="round">
      {/* Fork from parent */}
      {parent && <path d={sCurve(xf, laneY(parent.lane), xBend, y)} stroke={color} strokeWidth={1.5 * scale} strokeOpacity={linkOpacity} />}
      {/* Fork point → inferred creation: we only know it happened somewhere in here */}
      {Math.min(xCreated, xAt) > xBend + 1 && (
        <line x1={xBend} x2={Math.min(xCreated, xAt)} y1={y} y2={y} stroke={color} strokeWidth={1.5 * scale} strokeDasharray="1 5" strokeOpacity={0.7} />
      )}
      {created && <line x1={xCreated} x2={xBarTo} y1={y} y2={y} stroke={stroke} strokeWidth={width * scale} />}
      {/* Open branches trail off toward "now" */}
      {live && xTail > xBarEnd && (
        <line
          x1={xBarEnd}
          x2={xTail}
          y1={y}
          y2={y}
          stroke={stroke}
          strokeWidth={(isTrunk ? width : 1.5) * scale}
          strokeOpacity={isTrunk ? 1 : 0.5}
          className={isTrunk ? undefined : 'flow'}
        />
      )}
      {merges.map(({ m, xm, x1, yInto }) => (
        <path
          key={m.commit}
          d={sCurve(x1, y, xm, yInto)}
          stroke={color}
          strokeWidth={1.5 * scale}
          strokeOpacity={linkOpacity}
          strokeDasharray={m.head ? undefined : '4 3'}
        />
      ))}
    </g>
  );

  return (
    <g
      data-branch={b.id}
      opacity={opacity}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={onClick}
      className="transition-opacity duration-150"
      style={{ cursor: 'pointer' }}
    >
      {/* Halo instead of an SVG filter: filters collapse on zero-height (horizontal) lines. */}
      {p.glow && (focused || isTrunk) && (
        <g opacity={focused ? 0.35 : 0.18} style={{ filter: 'blur(3px)' }}>
          {strokes(3)}
        </g>
      )}
      {strokes(1)}

      {/* Hit area */}
      <line x1={xf} x2={Math.max(xTail, xf + 8)} y1={y} y2={y} stroke="transparent" strokeWidth={LANE_H - 6} />

      {showDots &&
        commits.map((c) => (
          <circle key={c.hash} cx={xs(c.time)} cy={y} r={isTrunk ? 2.5 : 2.2} fill={p.hole} stroke={stroke} strokeWidth={1.4} />
        ))}

      {/* Creation marker */}
      {!isTrunk && created && <circle cx={xCreated} cy={y} r={3.5} fill={color} />}

      {/* Merge landing glyphs on the target lane */}
      {merges.map(({ m, xm, yInto }) =>
        m.head ? (
          <circle key={m.commit} cx={xm} cy={yInto} r={4.5} fill={p.hole} stroke={color} strokeWidth={2} />
        ) : (
          <rect
            key={m.commit}
            x={xm - 4}
            y={yInto - 4}
            width={8}
            height={8}
            transform={`rotate(45 ${xm} ${yInto})`}
            fill={p.hole}
            stroke={color}
            strokeWidth={2}
          />
        ),
      )}

      {b.status === 'open' && settled && (
        <>
          <circle cx={xLast} cy={y} r={3} fill={color} className="pulse-ring" />
          <circle cx={xLast} cy={y} r={3.5} fill={color} />
        </>
      )}
      {b.status === 'abandoned' && settled && (
        <path d={`M${xLast - 4},${y - 4} L${xLast + 4},${y + 4} M${xLast + 4},${y - 4} L${xLast - 4},${y + 4}`} stroke={color} strokeWidth={1.8} />
      )}

      {labelVisible && (
        <text x={labelX} y={y - 8} className="font-mono text-[11px]" fill={color} style={{ paintOrder: 'stroke', stroke: p.labelHalo, strokeWidth: 4 }}>
          {b.name}
          {b.pr && <tspan fillOpacity={0.6}> #{b.pr.number}</tspan>}
        </text>
      )}

      {flashAge && <Flashes b={b} y={y} xs={xs} xCreated={xCreated} merges={merges} flashAge={flashAge} p={p} />}
    </g>
  );
}

/** Pop rings on whatever this branch did in the last moment of playback. */
function Flashes({
  b,
  y,
  xs,
  xCreated,
  merges,
  flashAge,
  p,
}: {
  b: Branch;
  y: number;
  xs: (sec: number) => number;
  xCreated: number;
  merges: { m: Branch['merges'][number]; xm: number; yInto: number }[];
  flashAge: (t: number) => number | null;
  p: Palette;
}) {
  const events = [
    { key: 'created', t: b.createdAt, x: xCreated, y },
    ...b.commits.map((c) => ({ key: c.hash, t: c.time, x: xs(c.time), y })),
    ...merges.map(({ m, xm, yInto }) => ({ key: `m${m.commit}`, t: m.at, x: xm, y: yInto })),
  ];
  const rings = events.flatMap((e) => {
    const age = flashAge(e.t);
    return age === null ? [] : [{ ...e, age }];
  });
  if (!rings.length) return null;
  return (
    <g fill="none" pointerEvents="none">
      {rings.map((r) => (
        <g key={r.key} opacity={1 - r.age}>
          {p.glow && <circle cx={r.x} cy={r.y} r={4 + r.age * 10} stroke={p.flash} strokeWidth={4} style={{ filter: 'blur(3px)' }} />}
          <circle cx={r.x} cy={r.y} r={4 + r.age * 10} stroke={p.flash} strokeWidth={p.glow ? 1.5 : 1} />
        </g>
      ))}
    </g>
  );
}
