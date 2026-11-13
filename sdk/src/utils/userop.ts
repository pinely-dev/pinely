import {
  type Address,
  type Hash,
  type Hex,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  isHex,
  keccak256,
} from "viem";
import { pinelyAccountAbi } from "@pinely/shared/contracts";

/**
 * ERC-4337 v0.7 UserOperation helpers shared by the machine side (SDK) and the facilitator (backend).
 *
 * The machine must never sign a UserOperation it has not checked. `verifyPreparedSettlement`
 * rebuilds the expected `callData` from the payment requirements the machine itself validated and
 * recomputes the `userOpHash`, so a facilitator cannot slip in another recipient, a larger amount, a
 * different paymaster or inflated gas.
 */

export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

export interface SerializedUserOperation {
  sender: Address;
  nonce: string;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: string;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

/**
 * Static gas parameters. These are placeholders: production must take them from the bundler
 * (`eth_estimateUserOperationGas`) and the chain's gas price. Both sides pin the same values, so any
 * deviation proposed by a facilitator is refused.
 */
// verificationGasLimit (150,000) and callGasLimit (100,000), packed
export const SETTLEMENT_ACCOUNT_GAS_LIMITS =
  "0x000000000000000000000000000249f0000000000000000000000000000186a0" as Hex;
// maxPriorityFeePerGas (0) and maxFeePerGas (0.1 gwei), packed. Robinhood Chain reports a priority fee of 0 and a
// base fee of 0.01 to 0.02 gwei, so the ceiling is 5 to 10 times the base fee. The previous 2 gwei made the
// prefund (450,000 gas) about $2.70 at an ETH price of $3,000, above the Paymaster's default cost cap, so every
// UserOperation would have been refused. Replace these with the bundler's estimate once a bundler is chosen.
export const SETTLEMENT_GAS_FEES =
  "0x0000000000000000000000000000000000000000000000000000000005f5e100" as Hex;
export const SETTLEMENT_PRE_VERIFICATION_GAS = 50_000n;
// paymaster verificationGasLimit (100,000) and postOpGasLimit (50,000), 16 bytes each
const PAYMASTER_GAS_SUFFIX = [
  "0x000000000000000000000000000186a0",
  "0x0000000000000000000000000000c350",
] as const;

/** Facilitator fee cap a machine accepts by default: 1.00% of the payment. */
export const DEFAULT_MAX_FEE_BPS = 100;

const erc20TransferAbi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function serializeUserOperation(op: PackedUserOperation): SerializedUserOperation {
  return {
    ...op,
    nonce: `0x${op.nonce.toString(16)}`,
    preVerificationGas: `0x${op.preVerificationGas.toString(16)}`,
  };
}

/** Parses an untrusted serialized UserOperation, rejecting anything malformed. */
export function deserializeUserOperation(raw: SerializedUserOperation): PackedUserOperation {
  const hex = (value: unknown, name: string): Hex => {
    if (typeof value !== "string" || !isHex(value))
      throw new Error(`UserOperation.${name} is not hex`);
    return value;
  };
  const quantity = (value: unknown, name: string): bigint => {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
      throw new Error(`UserOperation.${name} is not a hex quantity`);
    }
    return BigInt(value);
  };
  if (!raw || typeof raw !== "object" || !isAddress(raw.sender)) {
    throw new Error("UserOperation.sender is not an address");
  }
  return {
    sender: raw.sender,
    nonce: quantity(raw.nonce, "nonce"),
    initCode: hex(raw.initCode, "initCode"),
    callData: hex(raw.callData, "callData"),
    accountGasLimits: hex(raw.accountGasLimits, "accountGasLimits"),
    preVerificationGas: quantity(raw.preVerificationGas, "preVerificationGas"),
    gasFees: hex(raw.gasFees, "gasFees"),
    paymasterAndData: hex(raw.paymasterAndData, "paymasterAndData"),
    signature: hex(raw.signature, "signature"),
  };
}

/**
 * EntryPoint v0.7 `getUserOpHash`:
 * keccak256(abi.encode(keccak256(abi.encode(sender, nonce, keccak256(initCode), keccak256(callData),
 * accountGasLimits, preVerificationGas, gasFees, keccak256(paymasterAndData))), entryPoint, chainId)).
 * The signature is not part of the hash.
 */
export function getUserOpHash(op: PackedUserOperation, entryPoint: Address, chainId: number): Hash {
  const packed = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        op.sender,
        op.nonce,
        keccak256(op.initCode),
        keccak256(op.callData),
        op.accountGasLimits,
        op.preVerificationGas,
        op.gasFees,
        keccak256(op.paymasterAndData),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [packed, entryPoint, BigInt(chainId)],
    ),
  );
}

/**
 * `PinelyAccount.execute` for one stablecoin transfer, or `executeBatch` when a facilitator fee is paid in the
 * same operation. `amount` is what the merchant receives.
 */
export function buildSettlementCallData(params: {
  stablecoin: Address;
  merchant: Address;
  amount: bigint;
  feeRecipient?: Address;
  feeAmount?: bigint;
}): Hex {
  const transferTo = (to: Address, value: bigint) =>
    encodeFunctionData({ abi: erc20TransferAbi, functionName: "transfer", args: [to, value] });

  if (params.feeRecipient && params.feeAmount && params.feeAmount > 0n) {
    return encodeFunctionData({
      abi: pinelyAccountAbi,
      functionName: "executeBatch",
      args: [
        [params.stablecoin, params.stablecoin],
        [0n, 0n],
        [
          transferTo(params.merchant, params.amount),
          transferTo(params.feeRecipient, params.feeAmount),
        ],
      ],
    });
  }
  return encodeFunctionData({
    abi: pinelyAccountAbi,
    functionName: "execute",
    args: [params.stablecoin, 0n, transferTo(params.merchant, params.amount)],
  });
}

/** Builds the (unsigned) UserOperation that settles one x402 payment with gas sponsored by the paymaster. */
export function buildSettlementUserOp(params: {
  sender: Address;
  nonce: bigint;
  stablecoin: Address;
  merchant: Address;
  amount: bigint;
  paymaster: Address;
  feeRecipient?: Address;
  feeAmount?: bigint;
  signature?: Hex;
}): PackedUserOperation {
  return {
    sender: params.sender,
    nonce: params.nonce,
    initCode: "0x",
    callData: buildSettlementCallData(params),
    accountGasLimits: SETTLEMENT_ACCOUNT_GAS_LIMITS,
    preVerificationGas: SETTLEMENT_PRE_VERIFICATION_GAS,
    gasFees: SETTLEMENT_GAS_FEES,
    paymasterAndData: concat([params.paymaster, ...PAYMASTER_GAS_SUFFIX]),
    signature: params.signature ?? "0x",
  };
}

/** What the facilitator returns from `POST /v1/settle/prepare`. */
export interface PreparedSettlement {
  userOp: SerializedUserOperation;
  userOpHash: Hash;
  entryPoint: Address;
  chainId: number;
  facilitatorFee?: string;
  feeRecipient?: Address;
}

/** What the machine independently expects, derived from the 402 challenge it already validated. */
export interface ExpectedSettlement {
  sender: Address;
  stablecoin: Address;
  merchant: Address;
  /** Gross amount the machine agreed to pay (the intent amount). */
  grossAmount: bigint;
  paymaster: Address;
  entryPoint: Address;
  chainId: number;
  maxFeeBps?: number;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Checks a prepared UserOperation field by field and returns it only if the machine can safely sign it.
 * Throws a descriptive error otherwise. Nothing here trusts the facilitator.
 */
export function verifyPreparedSettlement(
  prepared: PreparedSettlement,
  expected: ExpectedSettlement,
): PackedUserOperation {
  const op = deserializeUserOperation(prepared.userOp);

  if (!sameAddress(prepared.entryPoint, expected.entryPoint)) {
    throw new Error("EntryPoint differs from the expected canonical EntryPoint");
  }
  if (Number(prepared.chainId) !== expected.chainId)
    throw new Error("UserOperation is for another network");
  if (!sameAddress(op.sender, expected.sender))
    throw new Error("UserOperation is not sent from the machine account");
  if (op.initCode !== "0x") throw new Error("UserOperation deploys code (initCode must be empty)");
  if (op.signature !== "0x") throw new Error("UserOperation must be unsigned");

  const expectedPaymasterAndData = concat([expected.paymaster, ...PAYMASTER_GAS_SUFFIX]);
  if (op.paymasterAndData.toLowerCase() !== expectedPaymasterAndData.toLowerCase()) {
    throw new Error("UserOperation uses an unexpected paymaster or paymaster gas");
  }
  if (
    op.accountGasLimits.toLowerCase() !== SETTLEMENT_ACCOUNT_GAS_LIMITS ||
    op.gasFees.toLowerCase() !== SETTLEMENT_GAS_FEES ||
    op.preVerificationGas !== SETTLEMENT_PRE_VERIFICATION_GAS
  ) {
    throw new Error("UserOperation gas parameters differ from the expected values");
  }

  // Facilitator fee: bounded, and the machine still pays exactly the agreed gross amount.
  const fee = BigInt(prepared.facilitatorFee ?? "0");
  if (fee < 0n || fee >= expected.grossAmount) throw new Error("Facilitator fee is out of range");
  const maxFeeBps = BigInt(expected.maxFeeBps ?? DEFAULT_MAX_FEE_BPS);
  if (fee * 10_000n > expected.grossAmount * maxFeeBps) {
    throw new Error("Facilitator fee exceeds the accepted maximum");
  }
  if (fee > 0n && (!prepared.feeRecipient || !isAddress(prepared.feeRecipient))) {
    throw new Error("Facilitator fee has no valid recipient");
  }

  const expectedCallData = buildSettlementCallData({
    stablecoin: expected.stablecoin,
    merchant: expected.merchant,
    amount: expected.grossAmount - fee,
    feeRecipient: fee > 0n ? prepared.feeRecipient : undefined,
    feeAmount: fee,
  });
  if (op.callData.toLowerCase() !== expectedCallData.toLowerCase()) {
    throw new Error("UserOperation call data does not match the agreed payment");
  }

  const hash = getUserOpHash(op, expected.entryPoint, expected.chainId);
  if (hash.toLowerCase() !== prepared.userOpHash.toLowerCase()) {
    throw new Error("userOpHash does not match the UserOperation");
  }
  return op;
}
