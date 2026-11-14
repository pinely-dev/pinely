// The proofs PINELY owes the public: one claim, how to check it, and where it stands.
//
// A proof is `proven` only when its transaction hashes are listed and anyone can open them on the block
// explorer. A proof that was tried and failed stays on the page with the reason. Nothing here is a claim
// about a result: until a hash is listed, the status is `pending`.
//
// Numbering follows the demo brief (proofs #3, #4 and #6). Add a proof by appending to PROOFS.

export type ProofStatus = "pending" | "proven" | "blocked";

export interface Proof {
  id: number;
  title: string;
  /** What is claimed, in one sentence. */
  claim: string;
  status: ProofStatus;
  /** ISO date the status last changed, when it is more than `pending`. */
  date?: string;
  /** Mainnet transaction hashes that prove it. Empty until the proof was run onchain. */
  txHashes: readonly string[];
  /** Why a `blocked` proof failed or could not be run. */
  reason?: string;
  /**
   * How anyone can check it. `{registry}` is replaced with the MachineRegistry address from the address book;
   * `{rpc}` is always the placeholder `$RPC_URL`.
   */
  checks: readonly string[];
}

export const PROOFS: readonly Proof[] = [
  {
    id: 3,
    title: "An operator registers a machine",
    claim:
      "A registered machine exists onchain, and the 2 USDG registration fee reaches the PINELY Safe.",
    status: "pending",
    txHashes: [],
    checks: [
      'cast call {registry} "registrationFee()(uint256)" --rpc-url $RPC_URL',
      "cast receipt <registration transaction hash> --rpc-url $RPC_URL",
    ],
  },
  {
    id: 4,
    title: "A machine pays with 0 ETH",
    claim:
      "A machine account with no ETH pays in USDG over HTTP 402, and the PINELY Paymaster pays the gas.",
    status: "pending",
    txHashes: [],
    checks: [
      "cast balance <machine account address> --rpc-url $RPC_URL",
      "cast receipt <handleOps transaction hash> --rpc-url $RPC_URL",
    ],
  },
  {
    id: 6,
    title: "The owner freezes a machine in one transaction",
    claim: "One owner transaction freezes a machine, and its next payment is rejected.",
    status: "pending",
    txHashes: [],
    checks: [
      'cast call {registry} "isFrozen(bytes32)(bool)" <machine id> --rpc-url $RPC_URL',
      "cast receipt <freeze transaction hash> --rpc-url $RPC_URL",
    ],
  },
];
