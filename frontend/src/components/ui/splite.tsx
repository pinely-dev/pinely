"use client";

import dynamic from "next/dynamic";

interface SplineSceneProps {
  scene: string;
  className?: string;
}

// Client-only and code-split: three.js + the Spline loader are fetched only when this mounts.
const SplineRobot = dynamic(() => import("./spline-robot"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center font-mono text-xs tracking-widest text-zinc-400">
      LOADING 3D SCENE…
    </div>
  ),
});

export function SplineScene({ scene, className }: SplineSceneProps) {
  return <SplineRobot scene={scene} className={className} />;
}
