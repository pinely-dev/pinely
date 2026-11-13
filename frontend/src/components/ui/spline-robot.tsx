"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import SplineLoader from "@splinetool/loader";
import * as THREE from "three";

// Motion amplitude multiplier (1 = production value).
const AMP = 1;

// Camera framing (scene units; the robot spans roughly y -238..309).
// Fixed close-up on the head and shoulders from the first frame.
const CAM = { y: 238, z: 400 };

interface SplineRobotProps {
  scene: string;
  className?: string;
}

/**
 * Loads a Spline scene through the lightweight three.js loader (no Spline runtime)
 * and renders it on a transparent canvas so it sits over the hero backdrop.
 */
// Joint names exist in the Spline scene hierarchy; a missing name is skipped, never fatal.
const ARMS = [
  { shoulder: "Hand LEFT", elbow: "elbow", side: 1, phase: 0 },
  { shoulder: "Hand LEFT1", elbow: "elbow1", side: -1, phase: Math.PI },
] as const;

interface Joint {
  obj: THREE.Object3D;
  base: THREE.Euler;
  basePos: THREE.Vector3;
}

function joint(root: THREE.Object3D, name: string): Joint | null {
  const obj = root.getObjectByName(name);
  if (!obj) return null;
  return { obj, base: obj.rotation.clone(), basePos: obj.position.clone() };
}

function RobotModel({
  url,
  pointer,
  onReady,
}: {
  url: string;
  pointer: React.RefObject<THREE.Vector2>;
  onReady: () => void;
}) {
  const loaded = useLoader(SplineLoader, url) as unknown as THREE.Scene;
  const group = useRef<THREE.Group>(null);
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    // Keep the scene transparent and drop Spline's own camera/background; shadows stay cheap.
    loaded.background = null;
    onReady();
    loaded.traverse((obj) => {
      if (obj instanceof THREE.Camera) obj.visible = false;
      if (obj instanceof THREE.Light) obj.castShadow = false;
    });
    return () => {
      loaded.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m?.dispose());
        }
      });
    };
  }, [loaded, onReady]);

  // Capture rest poses once per loaded scene; all motion is an offset from these.
  const rig = useMemo(
    () => ({
      head: joint(loaded, "Head"),
      neck: joint(loaded, "Neck"),
      torso: joint(loaded, "Top part"),
      arms: ARMS.map((a) => ({
        side: a.side,
        phase: a.phase,
        shoulder: joint(loaded, a.shoulder),
        elbow: joint(loaded, a.elbow),
      })),
    }),
    [loaded],
  );

  useFrame((state, delta) => {
    const g = group.current;
    if (!g || reducedMotion) return;
    const t = state.clock.elapsedTime;
    const p = pointer.current;
    const damp = THREE.MathUtils.damp;
    const amp = AMP;

    // Body turns a little, the head turns more, so the gaze leads the body.
    g.rotation.y = damp(g.rotation.y, p.x * 0.18, 4, delta);
    g.position.y = Math.sin(t * 1.2) * 4;

    const { head, neck, torso } = rig;
    if (head) {
      head.obj.rotation.y = damp(head.obj.rotation.y, head.base.y + p.x * 0.5 * amp, 6, delta);
      head.obj.rotation.x = damp(head.obj.rotation.x, head.base.x + p.y * 0.22 * amp, 6, delta);
    }
    if (neck) {
      neck.obj.rotation.y = damp(neck.obj.rotation.y, neck.base.y + p.x * 0.12 * amp, 5, delta);
    }
    if (torso) {
      // Breathing: chest rises and settles.
      const breath = Math.sin(t * 1.6);
      torso.obj.position.y = torso.basePos.y + breath * 1.6 * amp;
      torso.obj.scale.y = 1 + breath * 0.004 * amp;
    }
    for (const arm of rig.arms) {
      const sway = Math.sin(t * 1.1 + arm.phase);
      if (arm.shoulder) {
        arm.shoulder.obj.rotation.z = arm.shoulder.base.z + arm.side * sway * 0.04 * amp;
      }
      if (arm.elbow) {
        arm.elbow.obj.rotation.x = arm.elbow.base.x + Math.sin(t * 1.3 + arm.phase) * 0.07 * amp;
      }
    }
  });

  return (
    <group ref={group}>
      <primitive object={loaded} />
    </group>
  );
}

export default function SplineRobot({ scene, className }: SplineRobotProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointer = useRef(new THREE.Vector2());
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const handleReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    // The Spline loader logs one error per extruded shape because its bevel engine is not
    // loaded (those parts render without a bevel). Filter only that known message, scoped to
    // this component's lifetime, so real errors still surface.
    const original = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("[extrude] engine not loaded")) return;
      original(...args);
    };
    return () => {
      console.error = original;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Pause rendering while the hero is off-screen.
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.05,
    });
    io.observe(el);
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.set(
        THREE.MathUtils.clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1),
        THREE.MathUtils.clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1),
      );
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      {!ready && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center font-mono text-xs tracking-widest text-zinc-400">
          LOADING 3D SCENE…
        </div>
      )}
      <Canvas
        frameloop={visible ? "always" : "never"}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, CAM.y, CAM.z], fov: 35, near: 10, far: 10000 }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0);
          // R3F aims new cameras at the origin; keep the view level at head height instead.
          camera.lookAt(0, CAM.y, 0);
        }}
      >
        <Suspense fallback={null}>
          <RobotModel url={scene} pointer={pointer} onReady={handleReady} />
        </Suspense>
      </Canvas>
    </div>
  );
}
