import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  type Address,
  type Hash,
  type Hex,
  isAddress,
  isHex,
  padHex,
  encodeFunctionData,
  formatUnits,
  zeroAddress,
} from "viem";
import {
  findContractAddress,
  machineRegistryAbi,
  pinelyAccountAbi,
  surplusSweeperAbi,
} from "@pinely/shared/contracts";
import { getActiveChain, getChainProfile } from "@pinely/shared/chains";
import { getBackendChainId, requireDeployed } from "../lib/config";
import {
  readAccountOwner,
  readAssetAllowed,
  readMachine,
  type OnchainMachine,
} from "../lib/machine-reads";
import { getSessionUser } from "./auth";

const actionsRoute = new Hono();

/**
 * Registration fee approval amount (stablecoin base units, 6 decimals). Must equal the on-chain
 * `MachineRegistry.registrationFee()`, which the deploy script sets from the same REGISTRATION_FEE
 * variable (default 2 stablecoin).
 */
function registrationFee(): bigint {
  return BigInt(process.env.REGISTRATION_FEE ?? "2000000");
}

function toBytes32(val: string | undefined | null): Hash {
  if (!val || typeof val !== "string" || val.trim() === "" || val.trim() === "0x") {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  const trimmed = val.trim();
  if (isHex(trimmed)) {
    if (trimmed.length > 66) {
      return trimmed.slice(0, 66) as Hash;
    }
    return padHex(trimmed as Hex, { size: 32 });
  }
  return "0x0000000000000000000000000000000000000000000000000000000000000000";
}

function checkOperatorAuth(c: Context): string | null {
  const token =
    getCookie(c, "pinely_session") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  return getSessionUser(token);
}

/**
 * Every prepare route requires a valid operator session in every environment (fail-closed).
 * Returns the 401 response to send, or null when the caller is signed in.
 */
function requireOperatorSession(c: Context) {
  if (checkOperatorAuth(c)) return null;
  return c.json(
    { error: "Operator authentication session is invalid or expired. Please sign in with SIWE." },
    401,
  );
}

/**
 * Prepares registerMachine transaction calldata for the operator wallet to sign.
 */
actionsRoute.post("/register/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json<{
    account: Address;
    signer: Address;
    attestationHash?: Hash;
    maxStableOutPerSwap?: string;
    dailyStableOutCap?: string;
    signature?: Hex;
    accountSignature?: Hex;
    deadline?: string;
  }>();

  if (!body.account || !body.signer) {
    return c.json({ error: "account and signer parameters are required" }, 400);
  }

  const attestationHash = toBytes32(body.attestationHash);

  const spendPolicy = {
    maxStableOutPerSwap: BigInt(body.maxStableOutPerSwap ?? "10000000"), // $10 stablecoin
    dailyStableOutCap: BigInt(body.dailyStableOutCap ?? "50000000"), // $50 stablecoin
    enabled: true,
  };

  if (spendPolicy.maxStableOutPerSwap > spendPolicy.dailyStableOutCap) {
    return c.json({ error: "maxStableOutPerSwap cannot exceed dailyStableOutCap" }, 400);
  }

  const signature = body.accountSignature ?? body.signature;
  const deadline = BigInt(body.deadline ?? Math.floor(Date.now() / 1000) + 3600);

  let calldata: Hex;
  if (signature) {
    calldata = encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "registerMachineWithAuth",
      args: [body.account, body.signer, attestationHash, spendPolicy, deadline, signature],
    });
  } else {
    calldata = encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "registerMachine",
      args: [body.account, body.signer, attestationHash, spendPolicy],
    });
  }

  const approveCalldata = encodeFunctionData({
    abi: [
      {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
      },
    ],
    functionName: "approve",
    args: [requireDeployed("MachineRegistry"), registrationFee()],
  });

  return c.json({
    to: requireDeployed("MachineRegistry"),
    data: calldata,
    value: "0",
    chainId: getBackendChainId(),
    description: "Register Machine Account and session key to MachineRegistry",
    approvalStep: {
      to: requireDeployed("STABLECOIN"),
      data: approveCalldata,
      value: "0",
      description: `Approve ${formatUnits(registrationFee(), 6)} ${getChainProfile(getBackendChainId()).stablecoinSymbol} machine registration fee for MachineRegistry`,
    },
  });
});

/**
 * Prepares setPolicy transaction calldata for the operator wallet to sign.
 */
actionsRoute.post("/policy/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json<{
    machineId: Hash;
    maxStableOutPerSwap: string;
    dailyStableOutCap: string;
    enabled: boolean;
  }>();

  if (!body.machineId) {
    return c.json({ error: "machineId parameter is required" }, 400);
  }

  const spendPolicy = {
    maxStableOutPerSwap: BigInt(body.maxStableOutPerSwap),
    dailyStableOutCap: BigInt(body.dailyStableOutCap),
    enabled: body.enabled,
  };

  if (spendPolicy.maxStableOutPerSwap > spendPolicy.dailyStableOutCap) {
    return c.json({ error: "maxStableOutPerSwap cannot exceed dailyStableOutCap" }, 400);
  }

  const calldata = encodeFunctionData({
    abi: machineRegistryAbi,
    functionName: "setPolicy",
    args: [toBytes32(body.machineId), spendPolicy],
  });

  return c.json({
    to: requireDeployed("MachineRegistry"),
    data: calldata,
    value: "0",
    chainId: getBackendChainId(),
    description: "Update machine Spend Policy spend limits",
  });
});

/**
 * Prepares the freeze (kill switch) transaction calldata.
 */
actionsRoute.post("/freeze/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json<{
    machineId?: Hash;
    freezeFleet?: boolean;
  }>();

  if (body.freezeFleet) {
    const calldata = encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "freezeFleet",
      args: [],
    });

    return c.json({
      to: requireDeployed("MachineRegistry"),
      data: calldata,
      value: "0",
      chainId: getBackendChainId(),
      description: "Freeze entire operator fleet (Emergency Kill Switch)",
    });
  }

  if (!body.machineId) {
    return c.json({ error: "machineId parameter is required unless executing freezeFleet" }, 400);
  }

  const calldata = encodeFunctionData({
    abi: machineRegistryAbi,
    functionName: "freezeMachine",
    args: [toBytes32(body.machineId)],
  });

  return c.json({
    to: requireDeployed("MachineRegistry"),
    data: calldata,
    value: "0",
    chainId: getBackendChainId(),
    description: "Freeze individual machine",
  });
});

/**
 * Prepares calldata for the transaction that unfreezes a machine or fleet.
 */
actionsRoute.post("/unfreeze/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json<{
    machineId?: Hash;
    unfreezeFleet?: boolean;
  }>();

  if (body.unfreezeFleet) {
    const calldata = encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "unfreezeFleet",
      args: [],
    });

    return c.json({
      to: requireDeployed("MachineRegistry"),
      data: calldata,
      value: "0",
      chainId: getBackendChainId(),
      description: "Unfreeze operator fleet",
    });
  }

  if (!body.machineId) {
    return c.json({ error: "machineId parameter is required unless executing unfreezeFleet" }, 400);
  }

  const calldata = encodeFunctionData({
    abi: machineRegistryAbi,
    functionName: "unfreezeMachine",
    args: [toBytes32(body.machineId)],
  });

  return c.json({
    to: requireDeployed("MachineRegistry"),
    data: calldata,
    value: "0",
    chainId: getBackendChainId(),
    description: "Unfreeze individual machine",
  });
});

/**
 * Prepares SurplusSweeper configuration calldata for the operator wallet to sign.
 * Supports per-machine (setMachineConfig) and per-fleet (setFleetConfig) configuration.
 */
actionsRoute.post("/sweeper/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json<{
    machineId?: Hash;
    token?: Address;
    reserveThreshold?: string;
    destination?: Address;
    enabled?: boolean;
    fleet?: boolean;
  }>();

  if (!body.destination) {
    return c.json({ error: "destination parameter (stablecoin vault) is required" }, 400);
  }
  if (body.reserveThreshold === undefined) {
    return c.json({ error: "reserveThreshold parameter is required" }, 400);
  }

  const token = body.token ?? requireDeployed("STABLECOIN");
  const reserveThreshold = BigInt(body.reserveThreshold);
  const enabled = body.enabled ?? true;

  const calldata =
    body.fleet || !body.machineId
      ? encodeFunctionData({
          abi: surplusSweeperAbi,
          functionName: "setFleetConfig",
          args: [token, reserveThreshold, body.destination, enabled],
        })
      : encodeFunctionData({
          abi: surplusSweeperAbi,
          functionName: "setMachineConfig",
          args: [toBytes32(body.machineId), token, reserveThreshold, body.destination, enabled],
        });

  return c.json({
    to: requireDeployed("SurplusSweeper"),
    data: calldata,
    value: "0",
    chainId: getBackendChainId(),
    description:
      body.fleet || !body.machineId
        ? "Configure SurplusSweeper auto-sweep for fleet level"
        : "Configure SurplusSweeper auto-sweep for a single machine",
  });
});

/**
 * Reads the active SurplusSweeper configuration for one machine.
 */
actionsRoute.get("/sweeper/config", async (c) => {
  const machineId = c.req.query("machineId");
  if (!machineId) {
    return c.json({ error: "machineId parameter is required" }, 400);
  }

  try {
    const { createPublicClient, http } = await import("viem");
    const client = createPublicClient({
      chain: getActiveChain(getBackendChainId()),
      transport: http(process.env.RPC_URL),
    });
    const result = (await client.readContract({
      address: requireDeployed("SurplusSweeper"),
      abi: surplusSweeperAbi,
      functionName: "getMachineConfig",
      args: [machineId as Hash],
    })) as unknown as {
      token: Address;
      reserveThreshold: bigint;
      destination: Address;
      enabled: boolean;
    };

    return c.json({
      data: {
        token: result.token,
        reserveThreshold: result.reserveThreshold.toString(),
        destination: result.destination,
        enabled: result.enabled,
      },
    });
  } catch {
    return c.json({ data: null, status: "sweeper_unavailable" });
  }
});

/**
 * Prepares setAssetAllowed calldata for the operator wallet to sign.
 * One asset per call; the frontend sends them in sequence for an allowlist.
 */
actionsRoute.post("/allowlist/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json<{
    machineId?: Hash;
    asset?: Address;
    allowed?: boolean;
  }>();

  if (!body.machineId) {
    return c.json({ error: "machineId parameter is required" }, 400);
  }
  if (!body.asset || !/^0x[0-9a-fA-F]{40}$/.test(body.asset)) {
    return c.json({ error: "asset parameter must be a valid ERC-20 address" }, 400);
  }

  const calldata = encodeFunctionData({
    abi: machineRegistryAbi,
    functionName: "setAssetAllowed",
    args: [toBytes32(body.machineId), body.asset, body.allowed ?? true],
  });

  return c.json({
    to: requireDeployed("MachineRegistry"),
    data: calldata,
    value: "0",
    chainId: getBackendChainId(),
    description: `${body.allowed === false ? "Remove" : "Add"} ${body.asset} to machine asset allowlist`,
  });
});

// --- Machine keys and lifecycle ---------------------------------------------------------------

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
/** Session keys live at most 30 days. */
const MAX_SESSION_KEY_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

type MachineAuthorization =
  | { ok: true; user: string; machineId: Hash; machine: OnchainMachine }
  | { ok: false; response: Response };

/**
 * Checks, against the chain, that the signed-in wallet is the registry operator of `rawMachineId`.
 * The prepared transaction would fail onchain for anyone else; refusing here gives a clear error and
 * avoids handing out calldata for a machine that is not theirs.
 */
async function authorizeMachineOperator(
  c: Context,
  rawMachineId: unknown,
): Promise<MachineAuthorization> {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return { ok: false, response: unauthorized };
  const user = checkOperatorAuth(c) as string;

  if (typeof rawMachineId !== "string" || !BYTES32_PATTERN.test(rawMachineId)) {
    return {
      ok: false,
      response: c.json({ error: "machineId must be a 32-byte hex string" }, 400),
    };
  }
  const machineId = rawMachineId as Hash;
  const machine = await readMachine(machineId);
  if (!machine) {
    return { ok: false, response: c.json({ error: "Machine not found onchain" }, 404) };
  }
  if (machine.operator.toLowerCase() !== user.toLowerCase()) {
    return {
      ok: false,
      response: c.json({ error: "Forbidden: you are not the operator of this machine" }, 403),
    };
  }
  return { ok: true, user, machineId, machine };
}

/** The session key is managed on the machine's smart account, whose owner can differ from the registry operator. */
async function requireAccountOwner(
  c: Context,
  auth: Extract<MachineAuthorization, { ok: true }>,
): Promise<Response | null> {
  const owner = await readAccountOwner(auth.machine.account);
  if (owner.toLowerCase() === auth.user.toLowerCase()) return null;
  return c.json({ error: "Forbidden: you do not own this machine account" }, 403);
}

/**
 * Prepares `revokeSessionKey()` on the machine account. The machine can no longer sign UserOperations
 * until a new session key is set.
 */
actionsRoute.post("/session-key/revoke/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const auth = await authorizeMachineOperator(c, body.machineId);
  if (!auth.ok) return auth.response;
  const notOwner = await requireAccountOwner(c, auth);
  if (notOwner) return notOwner;

  return c.json({
    to: auth.machine.account,
    data: encodeFunctionData({ abi: pinelyAccountAbi, functionName: "revokeSessionKey" }),
    value: "0",
    chainId: getBackendChainId(),
    description:
      "Revoke the session key of this machine account. The machine cannot sign UserOperations until a new key is set.",
  });
});

/**
 * Prepares a key rotation: two transactions that must both succeed. First the account switches to the
 * new session key (the old one stops working at once), then the registry records it as the machine's
 * signer so the Facilitator and the Hook accept it.
 */
actionsRoute.post("/session-key/rotate/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const newKey = body.newKey;
  if (typeof newKey !== "string" || !isAddress(newKey) || newKey.toLowerCase() === zeroAddress) {
    return c.json({ error: "newKey must be a non-zero address" }, 400);
  }
  const days = body.validForDays ?? MAX_SESSION_KEY_DAYS;
  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > MAX_SESSION_KEY_DAYS
  ) {
    return c.json(
      { error: `validForDays must be a whole number from 1 to ${MAX_SESSION_KEY_DAYS}` },
      400,
    );
  }

  const auth = await authorizeMachineOperator(c, body.machineId);
  if (!auth.ok) return auth.response;
  const notOwner = await requireAccountOwner(c, auth);
  if (notOwner) return notOwner;

  const validUntil = Math.floor(Date.now() / 1000) + days * SECONDS_PER_DAY;
  const registry = requireDeployed("MachineRegistry");

  return c.json({
    to: registry,
    data: encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "setSigner",
      args: [auth.machineId, newKey],
    }),
    value: "0",
    chainId: getBackendChainId(),
    description:
      "Step 2 of 2: record the new session key as this machine's signer in MachineRegistry",
    approvalStep: {
      to: auth.machine.account,
      data: encodeFunctionData({
        abi: pinelyAccountAbi,
        functionName: "setSessionKey",
        args: [newKey, validUntil, 0],
      }),
      value: "0",
      description: `Step 1 of 2: set the new session key on the machine account, valid for ${days} day${days === 1 ? "" : "s"}. The old key stops working.`,
    },
  });
});

/** Prepares `deregisterMachine`. Irreversible: the registration and spend policy are deleted. */
actionsRoute.post("/deregister/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const auth = await authorizeMachineOperator(c, body.machineId);
  if (!auth.ok) return auth.response;

  return c.json({
    to: requireDeployed("MachineRegistry"),
    data: encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "deregisterMachine",
      args: [auth.machineId],
    }),
    value: "0",
    chainId: getBackendChainId(),
    description:
      "Permanently remove this machine from the registry. Its registration and spend policy are deleted and cannot be restored; registering it again costs the registration fee.",
  });
});

/**
 * Prepares `setGuardian`. A null or zero-address guardian clears it. A guardian can freeze machines
 * and the fleet and report violations; it cannot unfreeze, change policy or move funds.
 */
actionsRoute.post("/guardian/prepare", async (c) => {
  const unauthorized = requireOperatorSession(c);
  if (unauthorized) return unauthorized;
  const user = checkOperatorAuth(c) as string;
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const raw = body.guardian;
  let guardian: Address;
  if (raw === null || raw === undefined) {
    guardian = zeroAddress;
  } else if (typeof raw === "string" && isAddress(raw)) {
    guardian = raw;
  } else {
    return c.json({ error: "guardian must be an address, or null to remove it" }, 400);
  }
  if (guardian !== zeroAddress && guardian.toLowerCase() === user.toLowerCase()) {
    return c.json({ error: "The guardian must be a different address from the operator" }, 400);
  }

  return c.json({
    to: requireDeployed("MachineRegistry"),
    data: encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "setGuardian",
      args: [guardian],
    }),
    value: "0",
    chainId: getBackendChainId(),
    description:
      guardian === zeroAddress
        ? "Remove the guardian of your fleet"
        : `Set ${guardian} as the guardian of your fleet. A guardian can freeze machines and your fleet and report violations, which lowers a machine's tier. It cannot unfreeze, change policy or move funds.`,
  });
});

/** Reads whether an asset is on a machine's allowlist. Public chain data, so no session is needed. */
actionsRoute.get("/allowlist/status", async (c) => {
  const machineId = c.req.query("machineId");
  const asset = c.req.query("asset");
  if (!machineId || !BYTES32_PATTERN.test(machineId)) {
    return c.json({ error: "machineId must be a 32-byte hex string" }, 400);
  }
  if (!asset || !isAddress(asset)) {
    return c.json({ error: "asset must be a valid address" }, 400);
  }
  const allowed = await readAssetAllowed(machineId as Hash, asset);
  return c.json({ data: { machineId, asset, allowed } });
});

export default actionsRoute;
