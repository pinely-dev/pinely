"use client";

import { useEffect, useRef, useState } from "react";

interface TextScrambleProps {
  text: string;
  className?: string;
  scrambleSpeed?: number;
  revealSpeed?: number;
}

const GLYPHS = "0123456789ABCDEF_//:<>#";

export function TextScramble({
  text,
  className = "",
  scrambleSpeed = 30,
  revealSpeed = 50,
}: TextScrambleProps) {
  const [displayText, setDisplayText] = useState(text);
  const elementRef = useRef<HTMLSpanElement>(null);
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !elementRef.current) return;

    // Respect user's motion preferences
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayText(text);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !hasTriggered.current) {
          hasTriggered.current = true;

          let iteration = 0;
          const maxIterations = text.length;

          const interval = setInterval(() => {
            setDisplayText(() =>
              text
                .split("")
                .map((char, index) => {
                  if (char === " ") return " ";
                  if (index < iteration) {
                    return text[index];
                  }
                  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
                })
                .join(""),
            );

            iteration += 1 / (revealSpeed / scrambleSpeed);

            if (iteration >= maxIterations) {
              setDisplayText(text);
              clearInterval(interval);
            }
          }, scrambleSpeed);

          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );

    observer.observe(elementRef.current);

    return () => {
      observer.disconnect();
    };
  }, [text, scrambleSpeed, revealSpeed]);

  return (
    <span ref={elementRef} className={`scramble-text ${className}`}>
      {displayText}
    </span>
  );
}
