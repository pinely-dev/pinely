"use client";

import { DataState } from "@/components/pinely/DataState";
import { useBillingQuota, useBillingSubscription } from "@/lib/api";
import { formatCount } from "@/lib/machine-view";
import { stablecoinSymbol } from "@/lib/chain";

const FEATURE_LABELS: Record<string, string> = {
  basic_swap: "Machine swaps",
  x402_payments: "x402 machine payments",
  single_machine_freeze: "Single-machine freeze",
  fleet_kill_switch: "Fleet kill switch",
  surplus_auto_sweep: "Surplus auto-sweep",
  gold_tier_staking: "Gold tier staking",
  priority_facilitator: "Priority facilitator",
  advanced_telemetry: "Advanced telemetry",
  dedicated_bundler: "Dedicated bundler",
  custom_sla: "Custom SLA",
};

function formatUsd(value: string): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "n/a";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "n/a"
    : d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
}

/**
 * Read-only view of the operator's Fleet Pro plan and monthly volume styled as an executive titanium pass.
 * Plan changes are not offered here: there is no payment flow behind the backend plan yet.
 */
export function FleetBillingCard({ operator }: { operator: string }) {
  const subscription = useBillingSubscription(operator);
  const quota = useBillingQuota(operator);

  return (
    <div className="card fleet-pro-card">
      <div className="card-top-badge-row">
        <span className="security-badge pass font-mono">FLEET SUBSCRIPTION</span>
        <span className="font-mono text-xs" style={{ color: "var(--mut-light)" }}>
          TIER · STAGE 1
        </span>
      </div>

      <div style={{ marginTop: "12px", marginBottom: "16px" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: "20px", letterSpacing: "-0.01em" }}>
          Fleet Pro Plan
        </h3>
        <p className="note" style={{ margin: 0, fontSize: "13px" }}>
          Active enterprise subscription profile governing fleet quotas and sponsored gas subsidies.
        </p>
      </div>

      <DataState
        isLoading={subscription.isPending || quota.isPending}
        error={subscription.error ?? quota.error}
        onRetry={() => {
          subscription.refetch();
          quota.refetch();
        }}
      >
        {subscription.data && quota.data && (
          <>
            {/* Visual Quota Telemetry Cockpit Box */}
            {(() => {
              const spent = Number(quota.data.spentStable) || 0;
              const cap = Number(quota.data.monthlyCapStable) || 1;
              const pct = Math.min(100, Math.max(0, (spent / cap) * 100));
              const remaining = Math.max(0, cap - spent);
              return (
                <div className="pro-quota-meter">
                  <div className="pro-quota-header font-mono">
                    <div>
                      <span className="pro-quota-title text-xs">MONTHLY SWAP VOLUME USAGE</span>
                      <div className="pro-quota-amount">
                        <b>{formatUsd(quota.data.spentStable)}</b>
                        <span className="pro-quota-denom"> Consumed</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span
                        className="pro-quota-denom font-mono text-xs"
                        style={{ display: "block", marginBottom: "4px" }}
                      >
                        Cap: {formatUsd(quota.data.monthlyCapStable)} {stablecoinSymbol}
                      </span>
                      <div className="pro-quota-badge font-mono">
                        <span>{pct.toFixed(1)}% OF CAP</span>
                      </div>
                    </div>
                  </div>

                  <div className="spend-bar-track" style={{ height: "6px", margin: "10px 0 12px" }}>
                    <div className="spend-bar-fill" style={{ width: `${pct}%` }} />
                  </div>

                  <div className="pro-quota-sub-grid font-mono text-xs">
                    <div className="pro-quota-sub-cell">
                      <span className="pro-sub-label">CONSUMED</span>
                      <b className="pro-sub-val" style={{ color: "#ffffff" }}>
                        {formatUsd(quota.data.spentStable)}
                      </b>
                    </div>
                    <div className="pro-quota-sub-cell">
                      <span className="pro-sub-label">REMAINING</span>
                      <b className="pro-sub-val" style={{ color: "var(--bl)" }}>
                        {formatUsd(remaining.toString())}
                      </b>
                    </div>
                    <div className="pro-quota-sub-cell">
                      <span className="pro-sub-label">CAPACITY HEADROOM</span>
                      <b className="pro-sub-val" style={{ color: "#ffffff" }}>
                        {pct >= 90
                          ? "CRITICAL CEILING"
                          : pct >= 70
                            ? "HIGH LOAD"
                            : "OPTIMAL (100%)"}
                      </b>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Enterprise Fleet Specifications — Full Edge-to-Edge Dossier Rows */}
            <div className="dossier-spec-list font-mono text-xs">
              <div className="dossier-spec-row">
                <span className="dossier-spec-label">PLAN TIER</span>
                <b className="dossier-spec-val" style={{ color: "#ffffff" }}>
                  {subscription.data.name} Founding Pass
                </b>
              </div>
              <div className="dossier-spec-row">
                <span className="dossier-spec-label">ALLOCATED HARDWARE NODES</span>
                <b className="dossier-spec-val" style={{ color: "var(--bl)" }}>
                  {formatCount(subscription.data.activeMachines)} of{" "}
                  {formatCount(subscription.data.maxMachines)} Nodes Active
                </b>
              </div>
              <div className="dossier-spec-row">
                <span className="dossier-spec-label">MONTHLY SPEND CEILING</span>
                <b className="dossier-spec-val" style={{ color: "#ffffff" }}>
                  {formatUsd(quota.data.monthlyCapStable)} {stablecoinSymbol}
                </b>
              </div>
              <div className="dossier-spec-row">
                <span className="dossier-spec-label">BILLING CYCLE &amp; QUOTA RESETS</span>
                <b className="dossier-spec-val" style={{ color: "var(--mut-light)" }}>
                  {formatDate(quota.data.resetsAt)} (Monthly)
                </b>
              </div>
            </div>

            <div style={{ marginTop: "18px" }}>
              <span
                className="font-mono text-xs"
                style={{
                  color: "var(--mut)",
                  display: "block",
                  marginBottom: "10px",
                  letterSpacing: "0.06em",
                }}
              >
                INCLUDED PROTOCOL CAPABILITIES
              </span>
              <div className="pro-features-grid-3">
                {subscription.data.features.map((feature) => (
                  <div key={feature} className="pro-feature-chip font-mono">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--bl)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="pro-feature-name">{FEATURE_LABELS[feature] ?? feature}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pro-paymaster-notice font-mono text-xs">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--bl)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ flexShrink: 0 }}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                Gas subsidies for automated machine transactions are sponsored by PINELY Paymaster
                on Robinhood Chain.
              </span>
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}
