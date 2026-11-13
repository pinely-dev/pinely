import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { encodeFunctionData, erc20Abi, formatUnits, isAddress, type Address } from "viem";
import { pinelyStakeAbi } from "@pinely/shared/contracts";
import { getBackendChainId } from "../lib/config";
import { readStakeState, type StakeState } from "../lib/stake-reads";
import { getSessionUser } from "./auth";

const stakeRoute = new Hono();

const UINT256_MAX = 2n ** 256n - 1n;
const UNAUTHORIZED = {
  error: "Operator authentication session is invalid or expired. Please sign in with SIWE.",
} as const;

function sessionAddress(c: Context): Address | null {
  const token =
    getCookie(c, "pinely_session") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  const user = getSessionUser(token);
  return user && isAddress(user) ? (user as Address) : null;
}

/** Parses a raw 18-decimal token amount sent as a decimal string; null when it is not a positive uint256. */
function parseAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n && amount <= UINT256_MAX ? amount : null;
}

async function readAmountBody(c: Context): Promise<bigint | null> {
  try {
    const body: unknown = await c.req.json();
    if (typeof body !== "object" || body === null) return null;
    return parseAmount((body as Record<string, unknown>).amount);
  } catch {
    return null;
  }
}

function pinely(amount: bigint): string {
  return `${Number(formatUnits(amount, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} $PINELY`;
}

function prepared(state: StakeState, data: `0x${string}`, description: string) {
  return {
    to: state.stakeContract,
    data,
    value: "0",
    chainId: getBackendChainId(),
    description,
  };
}

/**
 * GET /api/stake/:operator
 * Current staking position, read from the chain so it is accurate the moment a transaction is mined.
 */
stakeRoute.get("/:operator", async (c) => {
  const operator = c.req.param("operator");
  if (!isAddress(operator)) return c.json({ error: "operator must be a valid address" }, 400);

  const state = await readStakeState(operator);
  return c.json({
    data: {
      operator,
      stakeContract: state.stakeContract,
      token: state.token,
      staked: state.staked.toString(),
      unbonding: state.unbonding.toString(),
      unlockTime: state.unlockTime.toString(),
      hasMinStakeGold: state.hasMinStakeGold,
      minStakeGold: state.minStakeGold.toString(),
      unbondingPeriodSeconds: state.unbondingPeriodSeconds.toString(),
      balance: state.balance.toString(),
      allowance: state.allowance.toString(),
    },
  });
});

/** Stake $PINELY. The wallet first approves the exact amount, unless the allowance already covers it. */
stakeRoute.post("/stake/prepare", async (c) => {
  const user = sessionAddress(c);
  if (!user) return c.json(UNAUTHORIZED, 401);
  const amount = await readAmountBody(c);
  if (amount === null)
    return c.json({ error: "amount must be a positive whole number of base units" }, 400);

  const state = await readStakeState(user);
  if (amount > state.balance) {
    return c.json({ error: "Insufficient $PINELY balance in your wallet" }, 400);
  }

  const result = prepared(
    state,
    encodeFunctionData({ abi: pinelyStakeAbi, functionName: "stake", args: [amount] }),
    `Stake ${pinely(amount)}. The tokens move into the PinelyStake contract and count toward the Gold tier while staked.`,
  );
  if (state.allowance >= amount) return c.json(result);

  return c.json({
    ...result,
    approvalStep: {
      to: state.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [state.stakeContract, amount],
      }),
      value: "0",
      description: `Step 1 of 2: allow the PinelyStake contract to take ${pinely(amount)} from your wallet`,
    },
  });
});

/** Start the unbonding period for part of the stake. */
stakeRoute.post("/unstake/prepare", async (c) => {
  const user = sessionAddress(c);
  if (!user) return c.json(UNAUTHORIZED, 401);
  const amount = await readAmountBody(c);
  if (amount === null)
    return c.json({ error: "amount must be a positive whole number of base units" }, 400);

  const state = await readStakeState(user);
  if (amount > state.staked) {
    return c.json({ error: "Amount exceeds your active stake" }, 400);
  }

  const dropsBelowGold =
    state.staked >= state.minStakeGold && state.staked - amount < state.minStakeGold;
  const days = Number(state.unbondingPeriodSeconds) / 86_400;
  const notes = [
    `Unstaking ${pinely(amount)} starts a ${days}-day unbonding period. You can withdraw once it ends.`,
    "Unbonding stake no longer counts toward the Gold tier, and a new request restarts the timer for everything already unbonding.",
  ];
  if (dropsBelowGold) {
    notes.push(`This leaves you below the ${pinely(state.minStakeGold)} needed for Gold.`);
  }

  return c.json(
    prepared(
      state,
      encodeFunctionData({ abi: pinelyStakeAbi, functionName: "requestUnstake", args: [amount] }),
      notes.join(" "),
    ),
  );
});

/** Cancel an unbonding request and return that amount to the active stake. */
stakeRoute.post("/cancel-unstake/prepare", async (c) => {
  const user = sessionAddress(c);
  if (!user) return c.json(UNAUTHORIZED, 401);

  const state = await readStakeState(user);
  if (state.unbonding === 0n) return c.json({ error: "You have no unstake in progress" }, 400);

  return c.json(
    prepared(
      state,
      encodeFunctionData({ abi: pinelyStakeAbi, functionName: "cancelUnstake" }),
      `Cancel the unstake and return ${pinely(state.unbonding)} to your active stake.`,
    ),
  );
});

/** Withdraw an unbonding amount once the unbonding period has ended. */
stakeRoute.post("/withdraw/prepare", async (c) => {
  const user = sessionAddress(c);
  if (!user) return c.json(UNAUTHORIZED, 401);

  const state = await readStakeState(user);
  if (state.unbonding === 0n) return c.json({ error: "You have no unstake in progress" }, 400);

  // Advisory check against this server's clock. The contract compares against block.timestamp and
  // reverts an early withdrawal, so a small clock difference can never release funds early.
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < state.unlockTime) {
    return c.json(
      {
        error: "The unbonding period has not ended yet",
        unlocksAt: state.unlockTime.toString(),
      },
      400,
    );
  }

  return c.json(
    prepared(
      state,
      encodeFunctionData({ abi: pinelyStakeAbi, functionName: "withdrawUnstaked" }),
      `Withdraw ${pinely(state.unbonding)} to your wallet.`,
    ),
  );
});

export default stakeRoute;
