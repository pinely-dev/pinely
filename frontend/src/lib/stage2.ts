import { isPublicChainId } from "@pinely/shared/chains";
import { stage2State, type Stage2State } from "@pinely/shared/status";
import { activeChain } from "@/lib/chain";

/**
 * Where Stage 2 stands on the network this build talks to. Stage 2 only exists on mainnet, so any other
 * network (a local testnet build) reads as not deployed.
 */
export function activeStage2State(): Stage2State {
  return isPublicChainId(activeChain.id) ? stage2State() : "not-deployed";
}
