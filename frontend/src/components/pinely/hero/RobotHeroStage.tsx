"use client";

import { useEffect, useState } from "react";
import { SplineScene } from "@/components/ui/splite";
import { stablecoinSymbol } from "@/lib/chain";

// Third-party hosted Spline scene (runtime fetch from prod.spline.design).
const SPLINE_SCENE_URL = "https://prod.spline.design/8Hp-6YP1I3GOEZA7/scene.splinecode";

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

export function RobotHeroStage() {
  const [hudVisible, setHudVisible] = useState(false);
  const [hudOpacity, setHudOpacity] = useState(0);

  // Scroll-driven telemetry HUD for the Spline 3D robot stage
  useEffect(() => {
    const onScroll = () => {
      const heroHeight = document.getElementById("home")?.offsetHeight || 800;
      const progress = clamp(window.scrollY / (heroHeight * 0.65), 0, 1);
      setHudVisible(progress > 0.28);
      setHudOpacity(progress > 0.28 ? clamp((progress - 0.28) / 0.35, 0, 1) : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="hero-3d-stage">
      {/* Interactive Spline 3D Robot */}
      <div
        className="relative h-full w-full overflow-hidden"
        role="img"
        aria-label="Interactive 3D robot"
      >
        <SplineScene scene={SPLINE_SCENE_URL} className="h-full w-full" />
      </div>

      {/* Floating Annotated Chip Telemetry HUD */}
      {hudVisible && (
        <div
          className="robot-chip-hud"
          style={{
            opacity: hudOpacity,
            transform: `translateY(${(1 - hudOpacity) * 12}px)`,
          }}
          aria-live="polite"
        >
          <div className="hud-header">
            <span className="hud-badge">[ TARGET HARDWARE ]</span>
            <span className="hud-id">Planned</span>
          </div>
          <div className="hud-body">
            <strong>Secure element (planned)</strong>
            <p>Session keys, kill switch, sponsored gas. Settled in {stablecoinSymbol}.</p>
            <div className="hud-specs">
              <span>Non-exportable key (goal)</span>
              <span>·</span>
              <span>Ed25519 Session</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
