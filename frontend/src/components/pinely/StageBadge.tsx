import { isPublicChainId } from "@pinely/shared/chains";
import Link from "next/link";
import { activeChain } from "@/lib/chain";
import { activeStage2State } from "@/lib/stage2";

/**
 * Status badges. Wording and variants come from the website brief; what is live and what is not comes
 * from `@pinely/shared/status`, never from a literal typed next to the badge.
 */
type StageBadgeVariant = "live" | "testnet" | "stage2" | "deployed" | "connected";

const LABELS: Record<StageBadgeVariant, string> = {
  live: "LIVE · MAINNET",
  testnet: "TESTNET",
  stage2: "STAGE 2 · NOT DEPLOYED · SIMULATION",
  deployed: "STAGE 2 · DEPLOYED · NOT ACTIVE YET",
  connected: "STAGE 2 · CONNECTED · NO POOL YET",
};

interface StageBadgeProps {
  variant: StageBadgeVariant;
  className?: string;
}

export function StageBadge({ variant, className }: StageBadgeProps) {
  return (
    <span className={`stage-badge stage-badge-${variant}${className ? ` ${className}` : ""}`}>
      <span className="stage-badge-dot" aria-hidden="true" />
      {LABELS[variant]}
    </span>
  );
}

/** The network this build talks to, as a badge: mainnet or testnet, read from the active chain profile. */
export function NetworkBadge({ className }: { className?: string }) {
  return (
    <StageBadge
      variant={isPublicChainId(activeChain.id) ? "live" : "testnet"}
      className={className}
    />
  );
}

/**
 * The badge for a Stage 2 contract that has an address: "deployed, not active yet" until the Safe has connected it
 * (`STAGE2_WIRING` in `@pinely/shared/status`), "live" afterwards. Outside mainnet it is the plain network badge.
 */
export function Stage2ContractBadge({ className }: { className?: string }) {
  const state = activeStage2State();
  if (state === "deployed-inactive") return <StageBadge variant="deployed" className={className} />;
  if (state === "connected") return <StageBadge variant="connected" className={className} />;
  return <NetworkBadge className={className} />;
}

/**
 * Shown above any Stage 2 feature (staking, burn, fee tiers) until Stage 2 is active. The wording follows the
 * state: not deployed (brief copy), or deployed on mainnet but not yet connected by the Safe.
 */
export function Stage2Banner({ className }: { className?: string }) {
  const state = activeStage2State();
  if (state === "active") return null;
  if (state === "deployed-inactive") {
    return (
      <div className={`stage-banner${className ? ` ${className}` : ""}`} role="note">
        <StageBadge variant="deployed" />
        <p>
          <strong>STAGE 2 · DEPLOYED, NOT ACTIVE YET.</strong> The Stage 2 contracts are deployed on
          mainnet, but the PINELY Safe has not connected them to MachineRegistry, and this site has
          no staking or burning actions. The contracts are unaudited. Figures on this page are
          simulations, not returns.
        </p>
        <Link href="/contracts" className="stage-banner-link">
          See the deployed contracts →
        </Link>
      </div>
    );
  }
  if (state === "connected") {
    return (
      <div className={`stage-banner${className ? ` ${className}` : ""}`} role="note">
        <StageBadge variant="connected" />
        <p>
          <strong>STAGE 2 · CONNECTED, NO POOL YET.</strong> The PINELY Safe connected the Stage 2
          contracts to MachineRegistry, but no machine pool or buyback pool exists yet, so nothing
          is swapped or burned, and this site has no staking or burning actions. The contracts are
          unaudited. Figures on this page are simulations, not returns.
        </p>
        <Link href="/contracts" className="stage-banner-link">
          See the deployed contracts →
        </Link>
      </div>
    );
  }
  return (
    <div className={`stage-banner${className ? ` ${className}` : ""}`} role="note">
      <StageBadge variant="stage2" />
      <p>
        <strong>STAGE 2 · NOT DEPLOYED.</strong> PinelyStake, BurnVault and PinelyHook are not live
        on mainnet yet. Nothing is staked or burned onchain today. Figures on this page are
        simulations, not returns.
      </p>
    </div>
  );
}
