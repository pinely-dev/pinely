import { erc20Abi, type Address } from "viem";
import { pinelyStakeAbi } from "@pinely/shared/contracts";
import { requireDeployed } from "./config";
import { ChainUnavailableError, logFailure, readClient } from "./machine-reads";

/** Everything the staking UI and the prepare routes need, read from the chain in one pass. */
export interface StakeState {
  stakeContract: Address;
  token: Address;
  /** Active stake that counts toward the Gold tier (raw 18-decimal units). */
  staked: bigint;
  /** Stake in the unbonding period: it no longer counts toward Gold. */
  unbonding: bigint;
  /** Unix seconds when `unbonding` can be withdrawn; 0 when nothing is unbonding. */
  unlockTime: bigint;
  hasMinStakeGold: boolean;
  minStakeGold: bigint;
  unbondingPeriodSeconds: bigint;
  /** The operator's wallet balance of the staking token. */
  balance: bigint;
  /** How much the stake contract may already pull from the operator's wallet. */
  allowance: bigint;
}

/** Reads the staking state of `operator`. Unreadable chain data is an error, never a zero stake. */
export async function readStakeState(operator: Address): Promise<StakeState> {
  const stakeContract = requireDeployed("PinelyStake");
  const client = readClient();
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: stakeContract,
      abi: pinelyStakeAbi,
      functionName,
      args,
    } as never) as Promise<T>;

  try {
    const token = await read<Address>("pinelyToken");
    const [staked, unbond, hasMinStakeGold, minStakeGold, unbondingPeriod, balance, allowance] =
      await Promise.all([
        read<bigint>("stakeOf", [operator]),
        read<readonly [bigint, bigint]>("unbondRequestOf", [operator]),
        read<boolean>("hasMinStakeGold", [operator]),
        read<bigint>("MIN_STAKE_GOLD"),
        read<bigint>("UNBONDING_PERIOD"),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [operator],
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [operator, stakeContract],
        }),
      ]);

    return {
      stakeContract,
      token,
      staked,
      unbonding: unbond[0],
      unlockTime: unbond[1],
      hasMinStakeGold,
      minStakeGold,
      unbondingPeriodSeconds: unbondingPeriod,
      balance,
      allowance,
    };
  } catch (error) {
    logFailure("stake state", error);
    throw new ChainUnavailableError();
  }
}
