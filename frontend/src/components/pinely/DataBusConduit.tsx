"use client";

import { useEffect, useState } from "react";

interface ChapterAnchor {
  id: string;
  label: string;
}

const CHAPTERS: ChapterAnchor[] = [
  { id: "problem", label: "TENSION" },
  { id: "architecture", label: "BLUEPRINT" },
  { id: "cockpit", label: "COCKPIT" },
  { id: "scenarios", label: "SCENARIOS" },
  { id: "tokenomics", label: "ECONOMICS" },
  { id: "roadmap", label: "TRAJECTORY" },
];

export function DataBusConduit() {
  const [activeChapter, setActiveChapter] = useState<string>("problem");
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleScroll = () => {
      const winScroll = window.scrollY;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const scrolled = height > 0 ? (winScroll / height) * 100 : 0;
      setScrollProgress(Math.min(100, Math.max(0, scrolled)));

      // Show the side conduit only after scrolling past Hero (e.g. > 450px)
      setIsVisible(winScroll > 450);

      // Determine active section based on proximity
      const scrollPos = winScroll + 300;
      for (let i = CHAPTERS.length - 1; i >= 0; i--) {
        const el = document.getElementById(CHAPTERS[i].id);
        if (el && el.offsetTop <= scrollPos) {
          setActiveChapter(CHAPTERS[i].id);
          break;
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <>
      {/* Top Laser Progress Line */}
      <div className="data-bus-top-rail" aria-hidden="true">
        <div className="data-bus-progress-bar" style={{ width: `${scrollProgress}%` }} />
      </div>

      {/* Side Avionics Telemetry Conduit (Desktop only >= 1180px) */}
      <nav
        className={`data-bus-sidebar ${isVisible ? "visible" : ""}`}
        aria-label="5-Chapter Telemetry Navigator"
      >
        <div className="conduit-header">
          <span className="micro-square" aria-hidden="true" />
          <span className="conduit-title">DATA BUS</span>
          <span className="conduit-pct">{Math.round(scrollProgress)}%</span>
        </div>

        <div className="conduit-track">
          <div className="conduit-fill-line" style={{ height: `${scrollProgress}%` }} />

          <ul className="conduit-nodes">
            {CHAPTERS.map((ch) => {
              const isActive = activeChapter === ch.id;
              return (
                <li key={ch.id} className="conduit-node-item">
                  <button
                    onClick={() => scrollToSection(ch.id)}
                    className={`conduit-node-btn ${isActive ? "active" : ""}`}
                    aria-label={`Jump to ${ch.label}`}
                  >
                    <span className="node-marker" />
                    <span className="node-label">
                      <span className="node-name">{ch.label}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}
