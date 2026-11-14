import { isPublicChainId } from "@pinely/shared/chains";
import { activeChain } from "@/lib/chain";

/**
 * Status badges. Wording and variants come from the website brief; what is live and what is not comes
 * from `@pinely/shared/status`, never from a literal typed next to the badge.
 */
type StageBadgeVariant = "live" | "testnet" | "stage2";

const LABELS: Record<StageBadgeVariant, string> = {
  live: "LIVE · MAINNET",
  testnet: "TESTNET",
  stage2: "STAGE 2 · NOT DEPLOYED · SIMULATION",
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
 * Shown above any Stage 2 feature (staking, burn, fee tiers) while its contract is not deployed on the
 * active chain. Pages decide when to render it, from the address book.
 */
export function Stage2Banner({ className }: { className?: string }) {
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
