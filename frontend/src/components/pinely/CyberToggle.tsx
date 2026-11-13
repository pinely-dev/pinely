"use client";

import { useId } from "react";

interface CyberToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Tactical cybernetic sliding hardware switch.
 * Fully accessible with WAI-ARIA switch pattern, keyboard-navigable (Space/Enter),
 * and styled with physical tactile track, smooth spring slide, and active LED pip.
 */
export function CyberToggle({
  id: explicitId,
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: CyberToggleProps) {
  const generatedId = useId();
  const switchId = explicitId ?? generatedId;

  return (
    <div
      role="switch"
      id={switchId}
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={`cyber-toggle-wrapper ${checked ? "is-active" : "is-inactive"} ${
        disabled ? "is-disabled" : ""
      }`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <div className="cyber-toggle-text">
        <span className="cyber-toggle-label">{label}</span>
        {description && <span className="cyber-toggle-desc">{description}</span>}
      </div>

      <div className="cyber-toggle-switch" aria-hidden="true">
        <span className="cyber-toggle-track">
          <span className="cyber-toggle-thumb">
            <span className={`cyber-toggle-led ${checked ? "led-on" : "led-off"}`} />
          </span>
        </span>
        <span className="cyber-toggle-status font-mono">{checked ? "ACTIVE" : "BYPASS"}</span>
      </div>
    </div>
  );
}
