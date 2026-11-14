"use client";

import { useEffect, useRef } from "react";
import { useScrollLock } from "@/lib/useScrollLock";

/** One thing the wallet is about to be asked to sign. */
export interface SignConfirmStep {
  /** The contract that will be called, or a plain statement that none is. */
  contract: string;
  /** What the signature allows, in one sentence. */
  permission: string;
}

export interface SignConfirmRequest {
  title: string;
  /** The network the signature is for. */
  network: string;
  steps: SignConfirmStep[];
}

interface SignConfirmModalProps {
  /** `null` keeps the dialog closed. */
  request: SignConfirmRequest | null;
  onDecision: (approved: boolean) => void;
}

/**
 * The short notice shown before a wallet is asked to sign: network, contract called, permission granted.
 * Nothing is sent until the user continues here and then confirms in the wallet itself. Closing the dialog,
 * pressing Escape or clicking outside it all count as "cancel".
 */
export function SignConfirmModal({ request, onDecision }: SignConfirmModalProps) {
  const open = request !== null;
  useScrollLock(open);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    continueRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDecision(false);
        return;
      }
      if (event.key !== "Tab") return;
      // Keep keyboard focus inside the dialog: there are only two controls.
      const first = cancelRef.current;
      const last = continueRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onDecision]);

  if (!request) return null;

  const multi = request.steps.length > 1;

  return (
    <div className="sign-confirm-backdrop" onClick={() => onDecision(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-confirm-title"
        className="sign-confirm"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="sign-confirm-title">{request.title}</h2>

        <dl className="sign-confirm-list">
          <div>
            <dt>Network</dt>
            <dd>{request.network}</dd>
          </div>
          {request.steps.map((step, index) => (
            <div key={`${index}-${step.contract}`} className="sign-confirm-step">
              <dt>
                {multi
                  ? `Step ${index + 1} of ${request.steps.length}: contract called`
                  : "Contract called"}
              </dt>
              <dd className="font-mono">{step.contract}</dd>
              <dt>
                {multi
                  ? `Step ${index + 1} of ${request.steps.length}: permission granted`
                  : "Permission granted"}
              </dt>
              <dd>{step.permission}</dd>
            </div>
          ))}
        </dl>

        <p className="sign-confirm-note">
          Your wallet asks you to confirm next. Nothing is sent until you do.
        </p>

        <div className="sign-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn dark"
            onClick={() => onDecision(false)}
          >
            Cancel
          </button>
          <button
            ref={continueRef}
            type="button"
            className="btn red"
            onClick={() => onDecision(true)}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
