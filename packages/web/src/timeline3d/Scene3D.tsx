import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  Color,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  SphereGeometry,
  Vector2,
  Vector3,
  type Group,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { fmtDate } from '../format.ts';
import { useStore, type ViewModel } from '../store.ts';
import { usePalette, type Palette } from '../theme.ts';
import { branchColor } from '../timeline/colors.ts';
import type { PlaybackClock } from '../timeline/playback.ts';
import { usePrefersReducedMotion } from '../timeline/usePlayback.ts';
import { buildLayout3d, LENGTH, lowerBound, pointAt, type Layout3d } from './layout3d.ts';
import { buildStrands, toColor } from './materials.ts';

/** The camera aims this far behind the playhead so the recent past fills the middle of the view. */
const LOOK_BACK = 70;
/** Camera position relative to its aim: ahead of the playhead, above and to the side, looking back down the tunnel. */
const OFFSET = new Vector3(34, 26, 120);
/** How long an event's pop lasts, in seconds of 1× playback (matches the 2D view). */
const FLASH_S = 0.7;
const MAX_FLASH = 256;
/** Branches that did something within this many world units behind the playhead get a label. */
const LABEL_Z = 30;
const MAX_LABELS = 8;
const COMMIT_R = 0.45;
/** Overlay key for the playhead's date; git ref names can't contain spaces, so it never collides with a branch id. */
const DATE_KEY = 'playhead date';
/** Most traces that can be mid-draw at once; extra heads go undrawn. */
const MAX_BEAMS = 256;
/** Length of a beam's afterglow tail, in world units behind its head. */
const BEAM_TAIL = 5;

interface Props {
  vm: ViewModel;
  trunkId: string;
  clock: PlaybackClock;
}

/** Animate mode's time tunnel: history runs along z, the trunk is the axis, branches orbit it by depth. */
export default function Scene3D({ vm, trunkId, clock }: Props) {
  const p = usePalette();
  const hovered = useStore((s) => s.hoveredId !== null);
  const setSelected = useStore((s) => s.setSelected);
  const layout = useMemo(() => buildLayout3d(vm.branches, trunkId, clock), [vm.branches, trunkId, clock]);
  // Everything beyond the playhead is clipped; useFrame moves this plane instead of rebuilding geometry.
  const clip = useMemo(() => new Plane(new Vector3(0, 0, -1), 0), []);
  const overlay = useRef<HTMLDivElement>(null);
  // Vector-display look: bloom over the whole scene and a bright beam at each trace's head.
  const reducedMotion = usePrefersReducedMotion();
  const phosphor = p.instrument && !reducedMotion;

  return (
    <div className={`absolute inset-0 ${hovered ? 'cursor-pointer' : 'cursor-grab'}`}>
      <Canvas
        camera={{ position: OFFSET.toArray(), fov: 50, near: 0.5, far: LENGTH * 2 }}
        dpr={[1, 2]}
        onCreated={({ gl, raycaster }) => {
          gl.localClippingEnabled = true;
          raycaster.params.Line2 = { threshold: 6 };
        }}
        onPointerMissed={() => setSelected(null)}
      >
        <fog attach="fog" args={[p.labelHalo, 110, 600]} />
        {phosphor && <color attach="background" args={[p.labelHalo]} />}
        {phosphor && <Phosphor />}
        <Tunnel layout={layout} vm={vm} trunkId={trunkId} clock={clock} clip={clip} p={p} overlay={overlay} phosphor={phosphor} />
      </Canvas>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}

interface TunnelProps extends Props {
  layout: Layout3d;
  clip: Plane;
  p: Palette;
  overlay: RefObject<HTMLDivElement | null>;
  phosphor: boolean;
}

function Tunnel({ layout, vm, trunkId, clock, clip, p, overlay, phosphor }: TunnelProps) {
  const ringRadius = layout.maxRadius + 1.5;
  const reducedMotion = usePrefersReducedMotion();
  const colors = useBranchColors(vm, p);
  const zNow = () => clock.progressAt(useStore.getState().playback?.t ?? clock.end) * LENGTH;

  useFrame(() => {
    clip.constant = zNow();
  }, -1);

  return (
    <>
      <Strands layout={layout} vm={vm} colors={colors} trunkId={trunkId} clip={clip} p={p} zNow={zNow} />
      <Commits layout={layout} colors={colors} clip={clip} zNow={zNow} />
      {!reducedMotion && <Flashes layout={layout} clock={clock} p={p} zNow={zNow} />}
      {phosphor && <Beams layout={layout} colors={colors} zNow={zNow} />}
      <Trunk p={p} zNow={zNow} />
      <PlayheadRing radius={ringRadius} p={p} zNow={zNow} />
      <Labels layout={layout} vm={vm} trunkId={trunkId} clock={clock} p={p} overlay={overlay} ringRadius={ringRadius} />
      <CameraRig zNow={zNow} reducedMotion={reducedMotion} />
    </>
  );
}

interface PartProps {
  layout: Layout3d;
  vm: ViewModel;
  p: Palette;
  zNow(): number;
}

/** Branch colour, faded toward the background for abandoned branches and search misses. */
function useBranchColors(vm: ViewModel, p: Palette) {
  return useMemo(() => {
    const bg = new Color(p.labelHalo);
    const colors = new Map<string, Color>();
    for (const b of vm.branches) {
      const c = toColor(branchColor(b, p));
      if (vm.matches && !vm.matches.has(b.id)) c.lerp(bg, 0.85);
      else if (b.status === 'abandoned') c.lerp(bg, 0.5);
      colors.set(b.id, c);
    }
    return colors;
  }, [vm, p]);
}

/** Ignore hits on anything the playhead hasn't reached yet; it's clipped from view but still raycastable. */
const inPast = (e: ThreeEvent<PointerEvent | MouseEvent>, zNow: number) => e.point.z <= zNow + 0.5;

function useHitHandlers(idOf: (e: ThreeEvent<PointerEvent | MouseEvent>) => string | undefined, zNow: () => number) {
  const { setHovered, setSelected } = useStore.getState();
  return {
    onPointerMove(e: ThreeEvent<PointerEvent>) {
      const id = inPast(e, zNow()) ? idOf(e) : undefined;
      if (!id) return;
      e.stopPropagation();
      if (useStore.getState().hoveredId !== id) setHovered(id);
    },
    onPointerOut: () => setHovered(null),
    onClick(e: ThreeEvent<MouseEvent>) {
      const id = inPast(e, zNow()) ? idOf(e) : undefined;
      if (!id) return;
      e.stopPropagation();
      setSelected(id);
    },
  };
}

type Colors = Map<string, Color>;

function Strands({ layout, colors, trunkId, clip, p, zNow }: PartProps & { colors: Colors; trunkId: string; clip: Plane }) {
  const hoveredId = useStore((s) => s.hoveredId);
  const selectedId = useStore((s) => s.selectedId);

  const branches = useMemo(
    () =>
      buildStrands(
        layout.branches.filter((b) => b.id !== trunkId).map((b) => ({ id: b.id, path: b.path, color: colors.get(b.id)! })),
        { width: p.instrument ? 1.5 : 2, opacity: 1, clip },
      ),
    [layout, trunkId, colors, clip, p.instrument],
  );
  const merges = useMemo(
    () => buildStrands(layout.merges.map((m) => ({ id: m.branchId, path: m.path, color: colors.get(m.branchId)! })), { width: 1.5, opacity: 0.5, clip }),
    [layout, colors, clip],
  );
  // The focused branch is redrawn on top, thicker, with its merges at full strength.
  const focusId = selectedId ?? hoveredId;
  const focus = useMemo(() => {
    const own = layout.branches.find((b) => b.id === focusId && b.id !== trunkId);
    if (!own) return null;
    const color = colors.get(own.id)!.clone().lerp(new Color(p.ink), 0.15);
    const paths = [own.path, ...layout.merges.filter((m) => m.branchId === own.id).map((m) => m.path)];
    return buildStrands(paths.map((path) => ({ id: own.id, path, color })), { width: p.instrument ? 3 : 4, opacity: 1, clip });
  }, [layout, focusId, trunkId, colors, p, clip]);

  useDispose(branches.object);
  useDispose(merges.object);
  useDispose(focus?.object);

  const segmentOwner = (owners: string[]) => (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.faceIndex == null ? undefined : owners[e.faceIndex]);
  const branchHits = useHitHandlers(segmentOwner(branches.owners), zNow);
  const mergeHits = useHitHandlers(segmentOwner(merges.owners), zNow);

  return (
    <>
      <primitive object={branches.object} {...branchHits} />
      <primitive object={merges.object} {...mergeHits} />
      {focus && <primitive object={focus.object} raycast={() => null} />}
    </>
  );
}

function useDispose(o: { geometry: { dispose(): void }; material: { dispose(): void } } | undefined) {
  useEffect(
    () => () => {
      o?.geometry.dispose();
      o?.material.dispose();
    },
    [o],
  );
}

function Commits({ layout, colors, clip, zNow }: Pick<PartProps, 'layout' | 'zNow'> & { colors: Colors; clip: Plane }) {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(new SphereGeometry(COMMIT_R, 10, 8), new MeshBasicMaterial({ clippingPlanes: [clip] }), layout.commits.length);
    const o = new Object3D();
    layout.commits.forEach((c, i) => {
      o.position.set(c.x, c.y, c.z);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, colors.get(c.branchId)!);
    });
    m.computeBoundingSphere();
    return m;
  }, [layout, colors, clip]);
  useDispose(mesh);
  const hits = useHitHandlers((e) => (e.instanceId === undefined ? undefined : layout.commits[e.instanceId]?.branchId), zNow);
  return <primitive object={mesh} {...hits} />;
}

/** A pop on every event the playhead just passed, growing and fading toward the background. */
function Flashes({ layout, clock, p, zNow }: Omit<PartProps, 'vm'> & { clock: PlaybackClock }) {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(
      new SphereGeometry(COMMIT_R, 12, 10),
      new MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false }),
      MAX_FLASH,
    );
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, []);
  useDispose(mesh);
  const o = useMemo(() => new Object3D(), []);
  const [flash, bg, c] = useMemo(() => [new Color(p.flash), new Color(p.labelHalo), new Color()], [p]);

  useFrame(() => {
    const { playback, speed } = useStore.getState();
    const z = zNow();
    const win = ((FLASH_S * speed) / clock.duration) * LENGTH;
    const end = lowerBound(layout.events, z + 1e-6);
    const start = playback?.playing ? Math.max(lowerBound(layout.events, z - win), end - MAX_FLASH) : end;
    for (let i = start; i < end; i++) {
      const ev = layout.events[i];
      const age = (z - ev.z) / win;
      o.position.set(ev.x, ev.y, ev.z);
      o.scale.setScalar(1 + age * 3);
      o.updateMatrix();
      mesh.setMatrixAt(i - start, o.matrix);
      mesh.setColorAt(i - start, c.copy(flash).lerp(bg, age));
    }
    mesh.count = end - start;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <primitive object={mesh} raycast={() => null} />;
}

/** Renders through bloom instead of straight to the canvas; useFrame priority 1 takes over r3f's render. */
function Phosphor() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new Vector2(256, 256), 0.85, 0.35, 0));
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera]);
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size]);
  useEffect(() => () => composer.dispose(), [composer]);
  useFrame(() => composer.render(), 1);
  return null;
}

/** Electron beam at the head of every trace still being drawn: a white-hot spot with a short afterglow tail. */
function Beams({ layout, colors, zNow }: Pick<PartProps, 'layout' | 'zNow'> & { colors: Colors }) {
  const traces = useMemo(
    () => [...layout.branches.map((b) => ({ id: b.id, path: b.path })), ...layout.merges.map((m) => ({ id: m.branchId, path: m.path }))],
    [layout],
  );
  const [core, tail] = useMemo(() => {
    const make = (r: number, opacity: number) => {
      const m = new InstancedMesh(
        new SphereGeometry(r, 10, 8),
        new MeshBasicMaterial({ transparent: opacity < 1, opacity, depthWrite: false, toneMapped: false }),
        MAX_BEAMS,
      );
      m.setColorAt(0, new Color('#ffffff'));
      m.frustumCulled = false;
      m.count = 0;
      return m;
    };
    return [make(0.32, 1), make(1, 0.6)];
  }, []);
  useDispose(core);
  useDispose(tail);
  const [o, c, white] = useMemo(() => [new Object3D(), new Color(), new Color('#ffffff')], []);

  useFrame(() => {
    const z = zNow();
    let n = 0;
    for (const t of traces) {
      if (n === MAX_BEAMS) break;
      const last = t.path[t.path.length - 1];
      if (t.path[0].z >= z || last.z <= z) continue;
      const head = pointAt(t.path, z);
      const back = pointAt(t.path, Math.max(z - BEAM_TAIL, t.path[0].z));
      c.copy(colors.get(t.id) ?? white).lerp(white, 0.5);

      o.position.set(head.x, head.y, head.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(1);
      o.updateMatrix();
      core.setMatrixAt(n, o.matrix);
      core.setColorAt(n, white);

      const len = Math.hypot(head.x - back.x, head.y - back.y, head.z - back.z);
      o.position.set((head.x + back.x) / 2, (head.y + back.y) / 2, (head.z + back.z) / 2);
      o.lookAt(head.x, head.y, head.z);
      o.scale.set(0.16, 0.16, Math.max(len / 2, 0.2));
      o.updateMatrix();
      tail.setMatrixAt(n, o.matrix);
      tail.setColorAt(n, c);
      n++;
    }
    for (const m of [core, tail]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={tail} raycast={() => null} />
      <primitive object={core} raycast={() => null} />
    </>
  );
}

/** The trunk is the tunnel's spine: a solid rod that grows with the playhead. */
function Trunk({ p, zNow }: { p: Palette; zNow(): number }) {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const z = Math.max(zNow(), 1e-3);
    ref.current?.scale.set(1, z, 1);
    ref.current?.position.set(0, 0, z / 2);
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
      <cylinderGeometry args={[0.2, 0.2, 1, 12]} />
      <meshBasicMaterial color={p.trunk} />
    </mesh>
  );
}

/** "Now": a ring around the tunnel at the playhead. */
function PlayheadRing({ radius, p, zNow }: { radius: number; p: Palette; zNow(): number }) {
  const ref = useRef<Group>(null);
  useFrame(() => ref.current?.position.setZ(zNow()));
  return (
    <group ref={ref}>
      <mesh raycast={() => null}>
        <ringGeometry args={[radius, radius + 0.2, 96]} />
        <meshBasicMaterial color={p.playhead} transparent opacity={0.45} side={DoubleSide} fog={false} />
      </mesh>
    </group>
  );
}

interface Label {
  text: string;
  x: number;
  y: number;
  z: number;
  color: string;
  background: string;
  strong: boolean;
}

/**
 * Names for the trunk, the focused branch and whatever just happened, plus the playhead's date.
 * Labels are plain DOM in one overlay, projected every frame: a React root per label would remount
 * at frame rate as the set changes.
 */
function Labels({ layout, vm, trunkId, clock, p, overlay, ringRadius }: Omit<PartProps, 'zNow'> & {
  trunkId: string;
  clock: PlaybackClock;
  overlay: RefObject<HTMLDivElement | null>;
  ringRadius: number;
}) {
  const pathOf = useMemo(() => new Map(layout.branches.map((b) => [b.id, b.path])), [layout]);
  const nodes = useMemo(() => new Map<string, HTMLDivElement>(), []);
  const v = useMemo(() => new Vector3(), []);
  useEffect(() => () => nodes.forEach((n) => n.remove()), [nodes]);

  useFrame(({ camera, size }) => {
    const root = overlay.current;
    if (!root) return;
    const { playback, hoveredId, selectedId } = useStore.getState();
    const t = playback?.t ?? clock.end;
    const z = clock.progressAt(t) * LENGTH;

    const ids = new Set([trunkId, selectedId, hoveredId].filter((id): id is string => !!id));
    const end = lowerBound(layout.events, z + 1e-6);
    for (let i = end - 1; i >= 0 && layout.events[i].z >= z - LABEL_Z && ids.size < MAX_LABELS; i--) ids.add(layout.events[i].branchId);

    const labels = new Map<string, Label>();
    labels.set(DATE_KEY, { text: fmtDate(t), x: 0, y: ringRadius + 1.5, z, color: p.playheadText, background: p.playhead, strong: true });
    for (const id of ids) {
      const b = vm.byId.get(id);
      const path = pathOf.get(id);
      if (!b || !path || path[0].z > z) continue;
      const at = pointAt(path, z);
      const strong = id === hoveredId || id === selectedId || id === trunkId;
      labels.set(id, { text: b.name, x: at.x, y: at.y + 0.9, z: at.z, color: branchColor(b, p), background: p.labelHalo, strong });
    }

    for (const [key, n] of nodes) {
      if (!labels.has(key)) {
        n.remove();
        nodes.delete(key);
      }
    }
    for (const [key, l] of labels) {
      let n = nodes.get(key);
      if (!n) {
        n = document.createElement('div');
        n.className = 'absolute left-0 top-0 whitespace-nowrap rounded px-1.5 py-px font-mono text-[10px] tabular-nums';
        root.appendChild(n);
        nodes.set(key, n);
      }
      v.set(l.x, l.y, l.z).project(camera);
      const behind = v.z > 1;
      n.style.display = behind ? 'none' : '';
      if (behind) continue;
      if (n.textContent !== l.text) n.textContent = l.text;
      n.style.color = l.color;
      n.style.background = l.background;
      n.style.opacity = l.strong ? '0.95' : '0.75';
      n.style.fontWeight = l.strong ? '600' : '400';
      n.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

/**
 * Follow keeps the camera's current offset and carries it along with the playhead, so orbiting and
 * zooming stay on; panning moves off the axis and turns follow off, like a manual pan in 2D.
 */
function CameraRig({ zNow, reducedMotion }: { zNow(): number; reducedMotion: boolean }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const resetting = useRef(false);
  const [goal, step] = useMemo(() => [new Vector3(), new Vector3()], []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) useStore.getState().setFollow(false);
      resetting.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
      useStore.getState().setFollow(true);
      resetting.current = true;
    };
    dom.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [dom]);

  useFrame((_, dt) => {
    if (!controls || !useStore.getState().playback?.follow) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
    const target = controls.target;
    // z tracks the playhead exactly so the camera never lags it; x/y ease back onto the axis.
    goal.set(target.x + (0 - target.x) * k, target.y + (0 - target.y) * k, zNow() - LOOK_BACK);
    step.subVectors(goal, target);
    target.add(step);
    camera.position.add(step);
    if (resetting.current) {
      goal.addVectors(target, OFFSET);
      camera.position.lerp(goal, k);
      if (camera.position.distanceTo(goal) < 0.05) resetting.current = false;
    }
    controls.update();
  });

  return <OrbitControls makeDefault enableDamping={!reducedMotion} maxDistance={LENGTH} />;
}
