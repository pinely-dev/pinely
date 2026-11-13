"use client";

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { activeChain } from "@/lib/chain";
import { findContractAddress } from "@pinely/shared/contracts";
import { DataState } from "@/components/pinely/DataState";
import { TxStatus } from "@/components/pinely/TxStatus";
import { usePreparedTx } from "@/hooks/usePreparedTx";
import {
  fetchStakeState,
  prepareCancelUnstakeAction,
  prepareStakeAction,
  prepareUnstakeAction,
  prepareWithdrawUnstakedAction,
  useStakeState,
  type StakeState,
} from "@/lib/api";
import { formatPinely } from "@/lib/machine-view";
import { useWallet } from "@/providers/WalletContext";

const errorStyle = { color: "#ff8fa3" } as const;

/** Parses a typed $PINELY amount ("12.5") into raw 18-decimal units; null when empty, zero or invalid. */
function parseTokenAmount(value: string): bigint | null {
  if (!/^\d+(\.\d{1,18})?$/.test(value.trim())) return null;
  const amount = parseUnits(value.trim(), 18);
  return amount > 0n ? amount : null;
}

/** Plain decimal text for an input field, without thousands separators. */
function inputAmount(raw: string): string {
  return formatUnits(BigInt(raw), 18);
}

function formatUnlock(unlockTime: string): string {
  const seconds = Number(unlockTime);
  return new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function matured(unlockTime: string): boolean {
  return Date.now() / 1000 >= Number(unlockTime);
}

/**
 * Live staking for the connected operator: position, stake, unstake, cancel and withdraw. Every
 * action is a transaction the operator signs; the position shown is read from the chain.
 */
export function StakePanel() {
  const wallet = useWallet();
  const tx = usePreparedTx();
  const stakeContract = findContractAddress(activeChain.id, "PinelyStake");
  const ready = wallet.isConnected && wallet.isAuthenticated;
  const position = useStakeState(stakeContract && ready ? wallet.address : undefined);

  const [stakeInput, setStakeInput] = useState("");
  const [unstakeInput, setUnstakeInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = [["stakeState"]];

  /** Re-reads the chain until `done(state)` holds, so success is only shown once the change is visible. */
  const settled = (done: (state: StakeState) => boolean) => async () =>
    done(await fetchStakeState(wallet.address as string));

  const stake = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseTokenAmount(stakeInput);
    if (amount === null) return setError("Enter an amount greater than zero (up to 18 decimals).");
    if (position.data && amount > BigInt(position.data.balance)) {
      return setError("That is more than your wallet balance.");
    }
    setError(null);
    const before = BigInt(position.data?.staked ?? "0");
    const ok = await tx.run(() => prepareStakeAction({ amount: amount.toString() }), {
      invalidate,
      waitForIndexer: settled((s) => BigInt(s.staked) === before + amount),
    });
    if (ok) setStakeInput("");
  };

  const unstake = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseTokenAmount(unstakeInput);
    if (amount === null) return setError("Enter an amount greater than zero (up to 18 decimals).");
    if (position.data && amount > BigInt(position.data.staked)) {
      return setError("That is more than your active stake.");
    }
    setError(null);
    const before = BigInt(position.data?.staked ?? "0");
    const ok = await tx.run(() => prepareUnstakeAction({ amount: amount.toString() }), {
      invalidate,
      waitForIndexer: settled((s) => BigInt(s.staked) === before - amount),
    });
    if (ok) setUnstakeInput("");
  };

  const cancelUnstake = async () => {
    setError(null);
    await tx.run(() => prepareCancelUnstakeAction(), {
      invalidate,
      waitForIndexer: settled((s) => BigInt(s.unbonding) === 0n),
    });
  };

  const withdraw = async () => {
    setError(null);
    await tx.run(() => prepareWithdrawUnstakedAction(), {
      invalidate,
      waitForIndexer: settled((s) => BigInt(s.unbonding) === 0n),
    });
  };

  if (!stakeContract) {
    return (
      <p className="note">
        PinelyStake is not deployed on {activeChain.name} yet. Staking opens in Stage 2.
      </p>
    );
  }

  if (!wallet.isConnected) {
    return (
      <div>
        <p className="note">Connect the wallet that holds your $PINELY to stake.</p>
        <button
          type="button"
          className="btn red"
          onClick={() => wallet.connectWallet()}
          style={{ minHeight: "44px" }}
        >
          Connect wallet
        </button>
      </div>
    );
  }

  if (!wallet.isAuthenticated) {
    return (
      <div>
        <p className="note">Sign a message to continue. No transaction is sent.</p>
        <button
          type="button"
          className="btn red"
          disabled={wallet.isAuthenticating}
          onClick={() => wallet.signInWithEthereum()}
          style={{ minHeight: "44px" }}
        >
          {wallet.isAuthenticating ? "Waiting for signature…" : "Sign in with Ethereum"}
        </button>
        {wallet.authNotice && (
          <p role="status" style={{ color: "var(--mut-light)", marginTop: "8px" }}>
            {wallet.authNotice}
          </p>
        )}
        {wallet.authError && (
          <p role="alert" style={{ ...errorStyle, marginTop: "8px", overflowWrap: "anywhere" }}>
            {wallet.authError}
          </p>
        )}
      </div>
    );
  }

  const data = position.data;
  const hasUnbonding = data !== undefined && BigInt(data.unbonding) > 0n;
  const canWithdraw = hasUnbonding && matured(data.unlockTime);

  return (
    <div>
      <TxStatus state={tx.state} busy={tx.busy} onDismiss={tx.reset} />

      <DataState
        isLoading={position.isPending}
        error={position.error}
        onRetry={() => position.refetch()}
      >
        {data && (
          <>
            <div className="kv">
              <div>
                Active stake<b>{formatPinely(data.staked)}</b>
              </div>
              <div>
                Unbonding
                <b>
                  {hasUnbonding
                    ? `${formatPinely(data.unbonding)} · ${canWithdraw ? "ready to withdraw" : `unlocks ${formatUnlock(data.unlockTime)}`}`
                    : "None"}
                </b>
              </div>
              <div>
                Wallet balance<b>{formatPinely(data.balance)}</b>
              </div>
              <div>
                Gold stake threshold
                <b>
                  {data.hasMinStakeGold ? "Met" : "Not met"} · {formatPinely(data.minStakeGold)}
                </b>
              </div>
            </div>
            <p className="note" style={{ marginTop: "8px" }}>
              Meeting the stake threshold is only one Gold requirement: each machine also needs a
              valid hardware attestation and 90 days registered without a violation.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
                gap: "20px",
                marginTop: "16px",
              }}
            >
              <form className="form" onSubmit={stake}>
                <label>
                  Amount to stake ($PINELY)
                  <input
                    inputMode="decimal"
                    value={stakeInput}
                    onChange={(e) => setStakeInput(e.target.value)}
                    placeholder="10000"
                    className="font-mono"
                  />
                </label>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" }}>
                  <button
                    type="button"
                    className="btn dark"
                    onClick={() => setStakeInput(inputAmount(data.balance))}
                    style={{ minHeight: "44px" }}
                  >
                    Max
                  </button>
                  <button
                    type="submit"
                    className="btn red"
                    disabled={tx.busy}
                    style={{ minHeight: "44px" }}
                  >
                    Stake
                  </button>
                </div>
              </form>

              <form className="form" onSubmit={unstake}>
                <label>
                  Amount to unstake ($PINELY)
                  <input
                    inputMode="decimal"
                    value={unstakeInput}
                    onChange={(e) => setUnstakeInput(e.target.value)}
                    placeholder="1000"
                    className="font-mono"
                  />
                </label>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" }}>
                  <button
                    type="button"
                    className="btn dark"
                    onClick={() => setUnstakeInput(inputAmount(data.staked))}
                    style={{ minHeight: "44px" }}
                  >
                    Max
                  </button>
                  <button
                    type="submit"
                    className="btn dark"
                    disabled={tx.busy}
                    style={{ minHeight: "44px" }}
                  >
                    Start unstake
                  </button>
                </div>
                <span className="note" style={{ display: "block", marginTop: "8px" }}>
                  Starts a {Number(data.unbondingPeriodSeconds) / 86_400}-day unbonding period. A
                  new request restarts the timer for everything already unbonding.
                </span>
              </form>
            </div>

            {hasUnbonding && (
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "16px" }}>
                <button
                  type="button"
                  className="btn red"
                  disabled={tx.busy || !canWithdraw}
                  onClick={withdraw}
                  style={{ minHeight: "44px" }}
                >
                  Withdraw {formatPinely(data.unbonding)}
                </button>
                <button
                  type="button"
                  className="btn dark"
                  disabled={tx.busy}
                  onClick={cancelUnstake}
                  style={{ minHeight: "44px" }}
                >
                  Cancel unstake
                </button>
              </div>
            )}

            {error && (
              <p role="alert" style={{ ...errorStyle, marginTop: "12px" }}>
                {error}
              </p>
            )}
          </>
        )}
      </DataState>
    </div>
  );
}
