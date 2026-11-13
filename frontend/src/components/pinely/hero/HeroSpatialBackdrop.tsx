"use client";

import { useEffect, useRef } from "react";

export function HeroSpatialBackdrop() {
  const backdropRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const gridFloorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let ticking = false;

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;

          // Only compute within first 800px of scrolling
          if (scrollY <= 850) {
            const progress = Math.min(1, Math.max(0, scrollY / 600));

            // Headline recedes into 3D z-space
            if (headlineRef.current) {
              const scale = 1 - progress * 0.16;
              const translateY = progress * -70;
              const opacity = 1 - progress * 0.75;
              headlineRef.current.style.transform = `scale3d(${scale.toFixed(3)}, ${scale.toFixed(3)}, 1) translate3d(0, ${translateY.toFixed(1)}px, 0)`;
              headlineRef.current.style.opacity = opacity.toFixed(2);
            }

            // Grid floor pitches dynamically
            if (gridFloorRef.current) {
              const pitch = 62 + progress * 16;
              const translateY = progress * 40;
              gridFloorRef.current.style.transform = `rotateX(${pitch.toFixed(1)}deg) translate3d(0, ${translateY.toFixed(1)}px, 0)`;
            }
          }

          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div ref={backdropRef} className="hero-backdrop">
      {/* The headline stays in the accessibility tree: it is the page's only h1. */}
      <h1 ref={headlineRef} className="monumental-headline">
        <span className="line-1">Money for</span> <span className="line-2">Physical AI</span>
      </h1>
      <div ref={gridFloorRef} className="hero-grid-floor" aria-hidden="true" />
    </div>
  );
}
