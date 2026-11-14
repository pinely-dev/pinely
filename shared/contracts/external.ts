// EXTERNAL contract addresses (not deployed by PINELY) per chain.
//
// This file is maintained MANUALLY and is never overwritten by `scripts/sync-contracts.mjs`
// (sync only writes `addresses.ts` from Foundry broadcast artifacts).
//
// An unset key means "not configured": resolvers must fail closed (report "not deployed", never invent
// an address), and mainnet paths must throw. Never copy an address from an explorer or a community
// channel: take it from the official Robinhood Chain documentation.
//
// Provenance of the values below (docs/plans/09-robinhood-chain-migration.md, section 3):
//   - checked on-chain on 2026-11-13: bytecode present; token name, symbol and decimals read from the chain;
//   - NOT yet confirmed against the official documentation (task RH-03), which was unreachable that day.
import type { Address } from "../types";

export const externalAddresses: Record<string, Record<string, Address>> = {
  // Robinhood Chain Testnet (46630)
  "46630": {
    // STABLECOIN is intentionally unset. A candidate token ("USDG Testnet", 6 decimals) exists at
    // 0x4b40a882fbdbac52e30865e5d730a996bf5805a2, but its origin is not confirmed, so it is not trusted here.
    // Set it once the official testnet stablecoin is confirmed (RH-03).
    // ERC-4337 EntryPoint v0.7: bytecode exists at the canonical address and equals the mainnet build.
    EntryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    Permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    // Safe on testnet has not been checked yet.
  },
  // Robinhood Chain Mainnet (4663)
  "4663": {
    // Global Dollar (USDG): 6 decimals, owner-controlled, supports EIP-2612 permit and EIP-3009.
    STABLECOIN: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    // ERC-4337 EntryPoint v0.7: bytecode exists at the canonical address (build not yet compared with the official release).
    EntryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    Permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    // PINELY protocol Safe: `owner()` of MachineRegistry and PinelyPaymaster, and their treasury. Read from the
    // chain on 2026-11-14: Safe 1.5.0, `getThreshold()` = 2, three owners (see docs/runbooks/evidence/).
    ProtocolSafe: "0x340B621D1BB4Be8b25D75fbBD9a628eD491030dD",
    // Safe 1.3.0: bytecode exists at each address.
    SafeProxyFactory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
    SafeSingleton: "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
    SafeSingletonL2: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
    SafeFallbackHandler: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4",
    SafeMultiSend: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761",
    // Uniswap v4 PoolManager (Robinhood Chain). Found on 2026-11-14 on the Uniswap v4 deployments page, the
    // Uniswap governance forum and third-party indexers; bytecode read from the chain (24,009 bytes, PoolManager
    // functions present, owner 0x2BAD8182C09F50c8318d769245beA52C32Be46CD). The owner compared the address with the
    // official Uniswap page on 2026-11-14. Used by the Stage 2 deployment only; see docs/plans/09, section 12.26.
    PoolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    //
    // PINELY ($PINELY token CA), shown in the hero, footer and marquee. Read from chain on 2026-11-14:
    // name "PINELY PROTOCOL", symbol PINELY, 18 decimals, total supply 1,000,000,000; bytecode present.
    // Provenance of the address (launch transaction) is the owner's to confirm. If the key is absent,
    // every page shows "CA: TBA". To change it, take the address from the launch transaction (never
    // from a chat message), in exact EIP-55 checksum form, then commit and redeploy:
    PINELY: "0x415fA0f3480e7c1115EF052F9a7238827DC288cF",
    // `resolvePinelyTokenCa` rejects a zero or wrongly cased address at build time.
  },
};
