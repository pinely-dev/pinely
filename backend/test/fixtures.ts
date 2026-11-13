import {
  encodeErrorResult,
  encodeFunctionResult,
  erc20Abi,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import {
  deserializeUserOperation,
  getUserOpHash,
  type SerializedUserOperation,
} from "@pinely-protocol/sdk";
import { addresses, machineRegistryAbi, pinelyStakeAbi } from "@pinely/shared/contracts";

/**
 * Fixture deployment for tests. `shared/contracts/addresses.ts` is empty until Robinhood Chain is deployed, so
 * tests install placeholder addresses for the Stage 1 contracts and the stablecoin. The EntryPoint comes from the
 * external address book (shared/contracts/external.ts).
 */
export const FIXTURE_ADDRESSES = {
  MachineRegistry: "0x1111111111111111111111111111111111111111",
  PinelyPaymaster: "0x3333333333333333333333333333333333333333",
  SurplusSweeper: "0x7777777777777777777777777777777777777777",
  PinelyStake: "0x8888888888888888888888888888888888888888",
  // The testnet stablecoin is deliberately absent from the external address book until it is confirmed, so the
  // fixture installs a placeholder token (the mainnet entry is a real address and must not be used in tests).
  STABLECOIN: "0x5555555555555555555555555555555555555555",
} as const;

export function installFixtureDeployment(): void {
  process.env.CHAIN_ID = "46630";
  const book = addresses as unknown as Record<string, Record<string, string>>;
  book["46630"] = { ...(book["46630"] ?? {}), ...FIXTURE_ADDRESSES };
}

const entryPointNonceAbi = [
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface MockChainOptions {
  account: Address;
  signer: Address;
  /** Registry operator of the machine. Defaults to `account`. */
  operator?: Address;
  /** Owner of the machine's smart account. Defaults to the registry operator. */
  accountOwner?: Address;
  /** Result of `isAssetAllowed`. Defaults to false. */
  assetAllowed?: boolean;
  /** Make `getMachine` revert with `MachineNotFound`. */
  machineMissing?: boolean;
  /** State served by the PinelyStake contract and its token. All amounts are raw 18-decimal units. */
  stake?: {
    token?: Address;
    staked?: bigint;
    unbonding?: bigint;
    unlockTime?: bigint;
    balance?: bigint;
    allowance?: bigint;
    minStakeGold?: bigint;
  };
  frozen?: boolean;
  entryPointNonce?: bigint;
  sendUserOp?: "accept" | "reject";
  /** Make the bundler answer with this hash instead of the real userOpHash. */
  returnHash?: Hex;
  receipt?: "success" | "reverted" | "never";
}

/**
 * A minimal JSON-RPC server that plays both the chain (MachineRegistry and EntryPoint reads) and the
 * ERC-4337 bundler, so the real (non-simulated) settlement pipeline can be exercised end to end.
 */
export function startMockChain(options: MockChainOptions) {
  const calls: { method: string; params: unknown[] }[] = [];
  const selectors = {
    getMachine: toFunctionSelector("getMachine(bytes32)"),
    isFrozen: toFunctionSelector("isFrozen(bytes32)"),
    getNonce: toFunctionSelector("getNonce(address,uint192)"),
    owner: toFunctionSelector("owner()"),
    isAssetAllowed: toFunctionSelector("isAssetAllowed(bytes32,address)"),
    pinelyToken: toFunctionSelector("pinelyToken()"),
    stakeOf: toFunctionSelector("stakeOf(address)"),
    unbondRequestOf: toFunctionSelector("unbondRequestOf(address)"),
    hasMinStakeGold: toFunctionSelector("hasMinStakeGold(address)"),
    minStakeGold: toFunctionSelector("MIN_STAKE_GOLD()"),
    unbondingPeriod: toFunctionSelector("UNBONDING_PERIOD()"),
    balanceOf: toFunctionSelector("balanceOf(address)"),
    allowance: toFunctionSelector("allowance(address,address)"),
  };
  const txHash = `0x${"ef".repeat(32)}` as Hex;
  let entryPointNonce = options.entryPointNonce ?? 7n;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { id: number; method: string; params: unknown[] };
      calls.push({ method: body.method, params: body.params });
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
      const fail = (message: string) =>
        Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message } });

      switch (body.method) {
        case "eth_chainId":
          return reply("0x185d9"); // 46630
        case "eth_call": {
          const call = body.params[0] as { data?: Hex; input?: Hex };
          const data = (call.data ?? call.input ?? "0x") as Hex;
          const selector = data.slice(0, 10);
          if (selector === selectors.getMachine && options.machineMissing) {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: 3,
                message: "execution reverted",
                data: encodeErrorResult({ abi: machineRegistryAbi, errorName: "MachineNotFound" }),
              },
            });
          }
          if (selector === selectors.owner) {
            return reply(
              `0x${(options.accountOwner ?? options.operator ?? options.account).slice(2).toLowerCase().padStart(64, "0")}`,
            );
          }
          if (selector === selectors.isAssetAllowed) {
            return reply(`0x${(options.assetAllowed ? 1 : 0).toString(16).padStart(64, "0")}`);
          }
          if (selector === selectors.getMachine) {
            return reply(
              encodeFunctionResult({
                abi: machineRegistryAbi,
                functionName: "getMachine",
                result: {
                  account: options.account,
                  operator: options.operator ?? options.account,
                  signer: options.signer,
                  attestationHash: `0x${"00".repeat(32)}`,
                  registeredAt: 1n,
                  lastActiveAt: 1n,
                  lastViolationAt: 0n,
                  attestationValid: false,
                  frozen: false,
                },
              }),
            );
          }
          if (selector === selectors.isFrozen) {
            return reply(
              encodeFunctionResult({
                abi: machineRegistryAbi,
                functionName: "isFrozen",
                result: options.frozen ?? false,
              }),
            );
          }
          if (selector === selectors.getNonce) {
            return reply(
              encodeFunctionResult({
                abi: entryPointNonceAbi,
                functionName: "getNonce",
                result: entryPointNonce,
              }),
            );
          }
          if (options.stake) {
            const st = options.stake;
            const staked = st.staked ?? 0n;
            const minGold = st.minStakeGold ?? 10_000n * 10n ** 18n;
            if (selector === selectors.pinelyToken) {
              return reply(
                encodeFunctionResult({
                  abi: pinelyStakeAbi,
                  functionName: "pinelyToken",
                  result: st.token ?? "0x9999999999999999999999999999999999999999",
                }),
              );
            }
            if (selector === selectors.stakeOf) {
              return reply(
                encodeFunctionResult({
                  abi: pinelyStakeAbi,
                  functionName: "stakeOf",
                  result: staked,
                }),
              );
            }
            if (selector === selectors.unbondRequestOf) {
              return reply(
                encodeFunctionResult({
                  abi: pinelyStakeAbi,
                  functionName: "unbondRequestOf",
                  result: [st.unbonding ?? 0n, st.unlockTime ?? 0n],
                }),
              );
            }
            if (selector === selectors.hasMinStakeGold) {
              return reply(
                encodeFunctionResult({
                  abi: pinelyStakeAbi,
                  functionName: "hasMinStakeGold",
                  result: staked >= minGold,
                }),
              );
            }
            if (selector === selectors.minStakeGold) {
              return reply(
                encodeFunctionResult({
                  abi: pinelyStakeAbi,
                  functionName: "MIN_STAKE_GOLD",
                  result: minGold,
                }),
              );
            }
            if (selector === selectors.unbondingPeriod) {
              return reply(
                encodeFunctionResult({
                  abi: pinelyStakeAbi,
                  functionName: "UNBONDING_PERIOD",
                  result: 604_800n,
                }),
              );
            }
            if (selector === selectors.balanceOf) {
              return reply(
                encodeFunctionResult({
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  result: st.balance ?? 0n,
                }),
              );
            }
            if (selector === selectors.allowance) {
              return reply(
                encodeFunctionResult({
                  abi: erc20Abi,
                  functionName: "allowance",
                  result: st.allowance ?? 0n,
                }),
              );
            }
          }
          return fail(`unexpected eth_call selector ${selector}`);
        }
        case "eth_sendUserOperation": {
          if (options.sendUserOp === "reject") return fail("AA24 signature error");
          if (options.returnHash) return reply(options.returnHash);
          const [rawOp, entryPoint] = body.params as [SerializedUserOperation, Address];
          return reply(getUserOpHash(deserializeUserOperation(rawOp), entryPoint, 46630));
        }
        case "eth_getUserOperationReceipt":
          if (options.receipt === "never") return reply(null);
          return reply({
            success: options.receipt !== "reverted",
            receipt: { transactionHash: txHash },
          });
        default:
          return fail(`unsupported method ${body.method}`);
      }
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    txHash,
    setNonce: (value: bigint) => {
      entryPointNonce = value;
    },
    stop: () => server.stop(true),
  };
}
