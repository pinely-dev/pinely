"use client";

import type { ReactNode } from "react";
import { isApiError, DATA_SOURCE } from "@/lib/http";

interface DataStateProps {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  /** Shown when the request succeeded and returned nothing. */
  emptyMessage?: string;
  /** Optional custom React node rendered when isEmpty is true. */
  emptyContent?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}

function describeError(error: unknown): { title: string; detail: string } {
  if (isApiError(error)) {
    if (error.isIndexerUnavailable) {
      return {
        title: "Indexer unavailable",
        detail: "The PINELY indexer is not reachable right now. This is not an empty result.",
      };
    }
    if (error.code === "network_error" || error.code === "timeout") {
      return {
        title: "API unreachable",
        detail: "The PINELY API did not answer. Check that the backend is running.",
      };
    }
    if (error.isNotFound) {
      return { title: "Not found", detail: error.message };
    }
    return { title: "Request failed", detail: error.message };
  }
  return { title: "Request failed", detail: "An unexpected error occurred." };
}

const boxStyle = {
  border: "1px solid var(--line)",
  borderRadius: "12px",
  padding: "28px 18px",
  textAlign: "center",
  color: "var(--mut-light)",
} as const;

/**
 * One place for the four states every data view shares: loading, error, empty and loaded.
 * An unavailable indexer or API is reported as such and never rendered as "zero".
 */
export function DataState({
  isLoading,
  error,
  isEmpty,
  emptyMessage = "Nothing to show yet.",
  emptyContent,
  onRetry,
  children,
}: DataStateProps) {
  if (DATA_SOURCE !== "api") {
    return (
      <div style={boxStyle} role="status">
        Live data is turned off in this build.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={boxStyle} role="status" aria-live="polite">
        Loading…
      </div>
    );
  }

  if (error) {
    const { title, detail } = describeError(error);
    return (
      <div style={boxStyle} role="alert">
        <div style={{ color: "#ffffff", fontWeight: 600, marginBottom: "6px" }}>{title}</div>
        <div style={{ fontSize: "13px" }}>{detail}</div>
        {onRetry && (
          <button
            type="button"
            className="btn dark"
            onClick={onRetry}
            style={{ marginTop: "14px", minHeight: "44px", fontSize: "13px" }}
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    if (emptyContent) {
      return (
        <div style={boxStyle} role="status">
          {emptyContent}
        </div>
      );
    }
    return (
      <div style={boxStyle} role="status">
        {emptyMessage}
      </div>
    );
  }

  return <>{children}</>;
}
