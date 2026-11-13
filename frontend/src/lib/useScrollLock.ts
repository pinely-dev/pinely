"use client";

import { useEffect } from "react";

let activeLocks = 0;
let originalBodyOverflow = "";
let originalDocOverflow = "";
let originalBodyPaddingRight = "";

/**
 * useScrollLock
 * Hook that locks background scroll (window/body) while a modal dialog is open.
 * Supports nested modals through reference counting and compensates for the
 * scrollbar width to avoid a horizontal layout shift on desktop.
 */
export function useScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked || typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    if (activeLocks === 0) {
      originalBodyOverflow = document.body.style.overflow;
      originalDocOverflow = document.documentElement.style.overflow;
      originalBodyPaddingRight = document.body.style.paddingRight;

      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";

      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
    }

    activeLocks++;

    return () => {
      activeLocks = Math.max(0, activeLocks - 1);
      if (activeLocks === 0) {
        document.body.style.overflow = originalBodyOverflow;
        document.documentElement.style.overflow = originalDocOverflow;
        document.body.style.paddingRight = originalBodyPaddingRight;
      }
    };
  }, [isLocked]);
}
