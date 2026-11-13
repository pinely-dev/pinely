import { Hono } from "hono";
import type { SerializedUserOperation } from "@pinely/sdk";
import { type Address, type Hash, type Hex, isAddress } from "viem";
import { getChainProfile } from "@pinely/shared/chains";
import { getBackendChainId, notDeployedBody, resolveAddress } from "../lib/config";
import {
  detectPaymentRailCapability,
  executePaymentSettlement,
  isPaymentNonceSettledAsync,
  prepareSettlement,
  verifyPayment402Intent,
} from "../services/payment-rails";

const facilitatorRoute = new Hono();

/** Labels used in x402 payment requirements, per supported network. */
const X402_NETWORK: Record<number, string> = {
  46630: "robinhood-testnet",
  4663: "robinhood",
};

interface IntentBody {
  machineId: Hash;
  resource: string;
  amountStable: string;
  nonce: string;
  deadline: string;
}

function parseIntent(raw: IntentBody) {
  return {
    machineId: raw.machineId,
    resource: raw.resource,
    amountStable: BigInt(raw.amountStable),
    nonce: BigInt(raw.nonce),
    deadline: BigInt(raw.deadline),
  };
}

/**
 * The EIP-712 verifying contract of the facilitator domain. The MachineRegistry is deployed in
 * Stage 1, so it is always available (the Router only exists from Stage 2).
 */
function verifyingContract(): Address | undefined {
  return resolveAddress("MachineRegistry");
}

/**
 * Reports the settlement rail. EIP-3009 support is informational only: the rail is always the
 * ERC-4337 Paymaster rail.
 */
facilitatorRoute.get("/capability", async (c) => {
  const queryToken = c.req.query("token");
  if (queryToken !== undefined && !isAddress(queryToken)) {
    return c.json({ error: "token must be a valid address" }, 400);
  }
  const tokenAddress = (queryToken as Address | undefined) ?? resolveAddress("STABLECOIN");
  if (!tokenAddress) return c.json(notDeployedBody("STABLECOIN"), 503);

  const capability = await detectPaymentRailCapability(tokenAddress, process.env.RPC_URL);
  return c.json(capability);
});

/**
 * Standard x402 HTTP 402 response for a machine charging request (power, data, access).
 */
facilitatorRoute.get("/charge/:id", (c) => {
  const id = c.req.param("id");
  const amount = c.req.query("amount") ?? "100000"; // 0.10 stablecoin (6 decimals)
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    return c.json({ error: "amount must be a positive integer in stablecoin base units" }, 400);
  }

  const chainId = getBackendChainId();
  const stablecoin = resolveAddress("STABLECOIN");
  const registry = verifyingContract();
  if (!stablecoin) return c.json(notDeployedBody("STABLECOIN"), 503);
  if (!registry) return c.json(notDeployedBody("MachineRegistry"), 503);

  const configuredMerchant = (process.env.MERCHANT_ADDRESS ||
    process.env.FACILITATOR_MERCHANT_ADDRESS) as Address | undefined;
  const payTo = (c.req.query("payTo") ?? configuredMerchant) as Address | undefined;
  if (!payTo || !isAddress(payTo)) {
    return c.json(
      {
        error:
          "MERCHANT_ADDRESS_REQUIRED: a valid payTo query parameter or MERCHANT_ADDRESS env is required",
      },
      400,
    );
  }

  // The public base URL must be configured explicitly in production: it is part of the signed
  // payment requirements and must not be derived from request headers.
  const publicBaseUrl = process.env.FACILITATOR_PUBLIC_URL;
  if (!publicBaseUrl && process.env.NODE_ENV === "production") {
    return c.json({ error: "FACILITATOR_PUBLIC_URL is not configured" }, 503);
  }
  const baseUrl = (publicBaseUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");

  c.status(402);
  return c.json({
    x402Version: 1,
    error: "Payment required",
    accepts: [
      {
        scheme: "exact",
        network: X402_NETWORK[chainId],
        maxAmountRequired: amount,
        asset: stablecoin,
        payTo,
        resource: `${baseUrl}/v1/charge/${encodeURIComponent(id)}`,
        description: `Autonomous machine service charge for endpoint: ${id}`,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        extra: {
          name: getChainProfile(chainId).stablecoinSymbol,
          chainId,
          verifyingContract: registry,
          rail: "erc4337-paymaster",
        },
      },
    ],
  });
});

/**
 * Pre-payment verification of a machine's signed payment intent.
 */
facilitatorRoute.post("/verify", async (c) => {
  const body = await c.req.json<{ intent: IntentBody; signature: Hex }>();

  if (!body.intent || !body.signature) {
    return c.json({ error: "intent and signature payload is required" }, 400);
  }
  const registry = verifyingContract();
  if (!registry) return c.json(notDeployedBody("MachineRegistry"), 503);

  const intent = parseIntent(body.intent);
  if (await isPaymentNonceSettledAsync(intent.machineId, intent.nonce)) {
    return c.json(
      {
        valid: false,
        error: "Payment nonce has already been used (replay attack defeated)",
        code: "NONCE_REPLAYED",
      },
      409,
    );
  }

  const result = await verifyPayment402Intent({
    intent,
    signature: body.signature,
    verifyingContract: registry,
  });

  if (!result.valid) {
    return c.json({ valid: false, error: result.error }, 400);
  }

  return c.json({
    valid: true,
    machineId: body.intent.machineId,
    amountStable: body.intent.amountStable,
    signer: result.recoveredAddress,
  });
});

/** Maps a settlement error message to an HTTP status and a stable error code. */
function settlementError(
  msg: string,
): { status: 400 | 403 | 409 | 502 | 503 | 504; code: string } | null {
  if (msg.includes("MERCHANT_ADDRESS_REQUIRED"))
    return { status: 400, code: "MERCHANT_ADDRESS_REQUIRED" };
  if (msg.includes("MACHINE_ACCOUNT_REQUIRED"))
    return { status: 400, code: "MACHINE_ACCOUNT_REQUIRED" };
  if (msg.includes("USEROP_SIGNATURE_REQUIRED"))
    return { status: 400, code: "USEROP_SIGNATURE_REQUIRED" };
  if (msg.includes("USEROP_SIGNATURE_INVALID"))
    return { status: 403, code: "USEROP_SIGNATURE_INVALID" };
  if (msg.includes("USEROP_MISMATCH")) return { status: 409, code: "USEROP_MISMATCH" };
  if (msg.includes("MACHINE_NOT_AUTHORIZED"))
    return { status: 403, code: "MACHINE_NOT_AUTHORIZED" };
  if (msg.includes("CONTRACT_NOT_DEPLOYED")) return { status: 503, code: "CONTRACT_NOT_DEPLOYED" };
  if (msg.includes("BUNDLER_UNAVAILABLE")) return { status: 503, code: "BUNDLER_UNAVAILABLE" };
  if (msg.includes("BUNDLER_TIMEOUT")) return { status: 504, code: "BUNDLER_TIMEOUT" };
  if (msg.includes("BUNDLER_REJECTED_USEROP") || msg.includes("BUNDLER_CONNECTION_ERROR")) {
    return { status: 502, code: "BUNDLER_ERROR" };
  }
  return null;
}

/**
 * Step 1 of settlement: verifies the machine and returns the unsigned UserOperation. The machine checks
 * it, signs its hash with its session key and sends it back to /settle.
 */
facilitatorRoute.post("/settle/prepare", async (c) => {
  const body = await c.req.json<{
    intent: IntentBody;
    signature: Hex;
    machineAccount?: Address;
    merchantAddress?: Address;
  }>();

  if (!body.intent || !body.signature) {
    return c.json({ error: "intent and signature payload is required" }, 400);
  }
  const registry = verifyingContract();
  if (!registry) return c.json(notDeployedBody("MachineRegistry"), 503);

  const intent = parseIntent(body.intent);
  const verified = await verifyPayment402Intent({
    intent,
    signature: body.signature,
    verifyingContract: registry,
  });
  if (!verified.valid || !verified.recoveredAddress) {
    return c.json({ status: "failed", error: verified.error }, 400);
  }

  try {
    return c.json(
      await prepareSettlement({
        intent,
        signerAddress: verified.recoveredAddress,
        machineAccount: body.machineAccount,
        merchantAddress: body.merchantAddress,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NONCE_REPLAYED")) {
      return c.json(
        {
          status: "failed",
          error: "Payment nonce has already been settled",
          code: "NONCE_REPLAYED",
        },
        409,
      );
    }
    const mapped = settlementError(msg);
    if (mapped) return c.json({ status: "failed", error: msg, code: mapped.code }, mapped.status);
    return c.json({ status: "failed", error: msg }, 500);
  }
});

/**
 * x402 settlement. The access token is returned only after the payment is confirmed on-chain.
 */
facilitatorRoute.post("/settle", async (c) => {
  const body = await c.req.json<{
    intent: IntentBody;
    signature: Hex;
    machineAccount?: Address;
    merchantAddress?: Address;
    userOp?: SerializedUserOperation;
    userOpSignature?: Hex;
  }>();

  if (!body.intent || !body.signature) {
    return c.json({ error: "intent and signature payload is required" }, 400);
  }
  const registry = verifyingContract();
  if (!registry) return c.json(notDeployedBody("MachineRegistry"), 503);

  const intent = parseIntent(body.intent);

  // 1. Replay check
  if (await isPaymentNonceSettledAsync(intent.machineId, intent.nonce)) {
    return c.json(
      {
        status: "failed",
        error: "Payment nonce has already been settled (replay attack defeated)",
        code: "NONCE_REPLAYED",
      },
      409,
    );
  }

  // 2. EIP-712 signature verification
  const verifyResult = await verifyPayment402Intent({
    intent,
    signature: body.signature,
    verifyingContract: registry,
  });

  if (!verifyResult.valid || !verifyResult.recoveredAddress) {
    return c.json({ status: "failed", error: verifyResult.error }, 400);
  }

  // 3. Settlement
  try {
    const settlement = await executePaymentSettlement({
      intent,
      signature: body.signature,
      signerAddress: verifyResult.recoveredAddress,
      machineAccount: body.machineAccount,
      merchantAddress: body.merchantAddress,
      userOp: body.userOp,
      userOpSignature: body.userOpSignature,
    });

    return c.json({
      status: settlement.status,
      resource: body.intent.resource,
      amountStable: body.intent.amountStable,
      facilitatorFee: settlement.facilitatorFee,
      netMerchantAmount: settlement.netMerchantAmount,
      txHash: settlement.txHash,
      accessToken: settlement.accessToken,
      onChain: settlement.onChain,
      simulated: settlement.simulated,
      rail: settlement.rail,
      userOp: settlement.userOp,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NONCE_REPLAYED")) {
      return c.json(
        {
          status: "failed",
          error: "Payment nonce has already been settled (replay attack defeated)",
          code: "NONCE_REPLAYED",
        },
        409,
      );
    }
    const mapped = settlementError(msg);
    if (mapped) return c.json({ status: "failed", error: msg, code: mapped.code }, mapped.status);
    return c.json({ status: "failed", error: msg }, 500);
  }
});

export default facilitatorRoute;
