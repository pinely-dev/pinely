import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { getUserOperationHash } from "viem/account-abstraction";
import {
  decodeAbiParameters,
  decodeFunctionData,
  hashTypedData,
  keccak256,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { machineRegistryAbi, surplusSweeperAbi } from "@pinely/shared/contracts";
import {
  computeAttestationHash,
  computeMachineId,
  DevKeyStore,
  Pinely,
  getPinelyDomain,
  getPinelyFacilitatorDomain,
  PAYMENT_402_TYPES,
  SWAP_INTENT_ABI_PARAM,
  SWAP_INTENT_TYPES,
  buildSettlementCallData,
  buildSettlementUserOp,
  deserializeUserOperation,
  getUserOpHash,
  serializeUserOperation,
  type PackedUserOperation,
  type PreparedSettlement,
} from "../src/index.js";
import { computePoolId, encodeHookData } from "../src/utils/eip712.js";

// Deterministic dev private key
const TEST_PRIVATE_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPECTED_SIGNER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const MOCK_REGISTRY: Address = "0x1111111111111111111111111111111111111111";
const MOCK_ROUTER: Address = "0x2222222222222222222222222222222222222222";
const MOCK_HOOK: Address = "0x3333333333333333333333333333333333333333";
const MOCK_STABLECOIN: Address = "0x4444444444444444444444444444444444444444";
const GOLDEN_CALLDATA_HASH = "0x51a40e774fc4e5cc855cdfbddb43ae79bc867c6af30ca6643b22db561d5a2949";
const GOLDEN_USEROP_HASH = "0xda0a784d712154dc66aea36f8be70a775ad46be734e223e5447ee6d85d909e0f";
const GOLDEN_BATCH_CALLDATA_HASH =
  "0x01b762d1f0d0054a8d9d718fbc38a7ee5025e0569c5be95941ac88fe6b0bbe24";
const OPERATOR_ADDRESS: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("PINELY SDK: unit and integration test suite", () => {
  describe("Keystore & DevKeyStore", () => {
    it("should initialize DevKeyStore and derive correct address", async () => {
      const keystore = new DevKeyStore(TEST_PRIVATE_KEY);
      expect(keystore.type).toBe("file-dev-only");
      const address = await keystore.getAddress();
      expect(address.toLowerCase()).toBe(EXPECTED_SIGNER.toLowerCase());
    });

    it("should sign arbitrary messages", async () => {
      const keystore = new DevKeyStore(TEST_PRIVATE_KEY);
      const signature = await keystore.signMessage("Hello PINELY");
      expect(signature).toBeDefined();
      expect(signature.startsWith("0x")).toBe(true);
      expect(signature.length).toBe(132); // 65 bytes in hex
    });

    it("should initialize TpmKeyStore and sign without exporting private key", async () => {
      const { TpmKeyStore } = await import("../src/keystore/tpm-keystore.js");
      const tpm = new TpmKeyStore({ type: "tpm", pcrList: [0, 1, 2, 7] });
      expect(tpm.type).toBe("tpm");

      const address = await tpm.getAddress();
      expect(address).toBeDefined();
      expect(address.startsWith("0x")).toBe(true);
      expect(address.length).toBe(42);

      const pubKey = await tpm.getPublicKey();
      expect(pubKey.startsWith("0x")).toBe(true);

      const sig = await tpm.signMessage("Hardware Enclave Verification");
      expect(sig.startsWith("0x")).toBe(true);

      const attestation = await tpm.collectAttestation();
      expect(attestation.algorithm).toBe("TPM2_SHA256_SECP256K1");
      expect(attestation.quote.startsWith("0x")).toBe(true);
      expect(attestation.firmwareHash.startsWith("0x")).toBe(true);
      expect(attestation.timestamp).toBeGreaterThan(0);
    });

    it("should throw HardwareSecurityModuleRequiredError in production mode without hardware TPM", async () => {
      const { TpmKeyStore, HardwareSecurityModuleRequiredError } =
        await import("../src/keystore/tpm-keystore.js");
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        expect(() => {
          new TpmKeyStore({ type: "tpm" });
        }).toThrow(HardwareSecurityModuleRequiredError);
      } finally {
        if (prevEnv !== undefined) {
          process.env.NODE_ENV = prevEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });

    it("should throw HardwareSecurityModuleRequiredError when simulation is explicitly disabled without hardware TPM", async () => {
      const { TpmKeyStore, HardwareSecurityModuleRequiredError } =
        await import("../src/keystore/tpm-keystore.js");
      expect(() => {
        new TpmKeyStore({ type: "tpm", simulatedEnclave: false });
      }).toThrow(HardwareSecurityModuleRequiredError);
    });

    it("should reject simulation in production mode", async () => {
      const { TpmKeyStore, HardwareSecurityModuleRequiredError } =
        await import("../src/keystore/tpm-keystore.js");
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        expect(() => {
          new TpmKeyStore({ type: "tpm", simulatedEnclave: true });
        }).toThrow(HardwareSecurityModuleRequiredError);
      } finally {
        if (prevEnv !== undefined) {
          process.env.NODE_ENV = prevEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });
  });

  describe("EIP-712 Utilities & Encoding", () => {
    it("should generate canonical Pinely domain", () => {
      const domain = getPinelyDomain(MOCK_HOOK, 46630n);
      expect(domain.name).toBe("PINELY");
      expect(domain.version).toBe("1");
      expect(domain.chainId).toBe(46630);
      expect(domain.verifyingContract).toBe(MOCK_HOOK);
    });

    it("should generate canonical Pinely Facilitator domain", () => {
      const domain = getPinelyFacilitatorDomain(MOCK_ROUTER, 46630n);
      expect(domain.name).toBe("PINELYFacilitator");
      expect(domain.version).toBe("1");
      expect(domain.chainId).toBe(46630);
      expect(domain.verifyingContract).toBe(MOCK_ROUTER);
    });

    it("should compute deterministic PoolId matching Uniswap v4 specification", () => {
      const poolKey = {
        currency0: "0x1111111111111111111111111111111111111111" as Address,
        currency1: "0x2222222222222222222222222222222222222222" as Address,
        fee: 0x800000,
        tickSpacing: 60,
        hooks: MOCK_HOOK,
      };

      const poolId = computePoolId(poolKey);
      expect(poolId.startsWith("0x")).toBe(true);
      expect(poolId.length).toBe(66);
    });

    it("should encode and decode hookData matching contract tuple schema", () => {
      const intent = {
        machineId: keccak256(toBytes("machine-1")),
        poolId: keccak256(toBytes("pool-1")),
        tokenIn: MOCK_STABLECOIN,
        tokenOut: OPERATOR_ADDRESS,
        amountIn: 10_000_000n,
        minAmountOut: 9_950_000n,
        nonce: 1n,
        deadline: 1893456000n,
        chainId: 46630n,
      };
      const mockSignature: Hex = `0x${"aa".repeat(65)}`;

      const hookData = encodeHookData(intent, mockSignature);
      expect(hookData.startsWith("0x")).toBe(true);

      const decoded = decodeAbiParameters([SWAP_INTENT_ABI_PARAM, { type: "bytes" }], hookData);
      expect(decoded[0].machineId).toBe(intent.machineId);
      expect(decoded[0].amountIn).toBe(10_000_000n);
      expect(decoded[1]).toBe(mockSignature);
    });
  });

  describe("Pinely Client & Machine Onboarding", () => {
    it("should connect to Pinely and derive machineId", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: {
          type: "file-dev-only",
          privateKey: TEST_PRIVATE_KEY,
        },
      });

      expect(pinely.chainId).toBe(46630n);

      const machine = await pinely.machines.create({
        name: "charger-01",
        operator: OPERATOR_ADDRESS,
      });

      expect(machine.name).toBe("charger-01");
      expect(machine.operator).toBe(OPERATOR_ADDRESS);
      expect(machine.machineId).toBeDefined();

      const expectedId = computeMachineId(EXPECTED_SIGNER);
      expect(machine.machineId).toBe(expectedId);
    });

    it("should build valid registration transaction calldata for MachineRegistry", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: {
          type: "file-dev-only",
          privateKey: TEST_PRIVATE_KEY,
        },
      });

      const tx = pinely.machines.buildRegistrationTx({
        account: EXPECTED_SIGNER,
        signer: EXPECTED_SIGNER,
        policy: {
          maxStableOutPerSwap: 5_000_000n,
          dailyStableOutCap: 20_000_000n,
          enabled: true,
        },
      });

      expect(tx.to).toBe(MOCK_REGISTRY);
      expect(tx.value).toBe(0n);

      const decoded = decodeFunctionData({
        abi: machineRegistryAbi,
        data: tx.data,
      });

      expect(decoded.functionName).toBe("registerMachine");
      expect(decoded.args[0]).toBe(EXPECTED_SIGNER);
      expect(decoded.args[1]).toBe(EXPECTED_SIGNER);
      expect(decoded.args[3].maxStableOutPerSwap).toBe(5_000_000n);
      expect(decoded.args[3].dailyStableOutCap).toBe(20_000_000n);
    });
  });

  describe("Machine Swap Lifecycle & EIP-712 Verification", () => {
    it("should calculate correct fee quotes for tiers", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: {
          type: "file-dev-only",
          privateKey: TEST_PRIVATE_KEY,
        },
      });

      const machine = await pinely.machines.create({
        name: "test-bot",
        operator: OPERATOR_ADDRESS,
      });

      // Default Bronze: 0.30% LP fee + 0.05% Protocol fee = 0.35% total
      const quote = await machine.quoteSwap({
        tokenIn: OPERATOR_ADDRESS,
        amountIn: 1_000_000n,
      });

      expect(quote.amountIn).toBe(1_000_000n);
      expect(quote.lpFee).toBe(3000n); // 0.30% of 1,000,000
      expect(quote.protocolFee).toBe(500n); // 0.05% of 1,000,000
      expect(quote.amountOut).toBe(996_500n);
    });

    it("should prepare SwapIntent and sign EIP-712 verifiable cryptographically", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: {
          type: "file-dev-only",
          privateKey: TEST_PRIVATE_KEY,
        },
      });

      const machine = await pinely.machines.create({
        name: "test-bot",
        operator: OPERATOR_ADDRESS,
      });

      const prepared = await machine.prepareSwap({
        tokenIn: OPERATOR_ADDRESS,
        amountIn: 10_000_000n,
        minAmountOut: 9_900_000n,
        deadlineSeconds: 600,
        nonce: 42n,
      });

      expect(prepared.intent.amountIn).toBe(10_000_000n);
      expect(prepared.intent.minAmountOut).toBe(9_900_000n);
      expect(prepared.intent.nonce).toBe(42n);
      expect(prepared.signature).toBeDefined();

      // Cryptographic roundtrip verification:
      // Verify that the signature resolves to our keystore address
      const recoveredSigner = await recoverTypedDataAddress({
        domain: getPinelyDomain(MOCK_HOOK, 46630n),
        types: SWAP_INTENT_TYPES,
        primaryType: "SwapIntent",
        message: prepared.intent,
        signature: prepared.signature,
      });

      expect(recoveredSigner.toLowerCase()).toBe(EXPECTED_SIGNER.toLowerCase());
    });
  });

  describe("HTTP 402 Facilitator Payment & Admin Calldata", () => {
    it("never simulates a payment when no facilitator is configured (fail-closed)", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: { type: "file-dev-only", privateKey: TEST_PRIVATE_KEY },
      });
      const machine = await pinely.machines.create({ name: "pay-bot", operator: OPERATOR_ADDRESS });

      const result = await machine.pay({
        url: "https://api.merchant.com/charge",
        maxAmount: 250_000n,
      });

      expect(result.status).toBe("failed");
      expect(result.accessToken).toBeUndefined();
      expect(result.txHash).toBeUndefined();
      expect(result.error).toContain("facilitatorUrl is required");
    });

    const MERCHANT: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const OTHER: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
    const MOCK_PAYMASTER: Address = "0x5555555555555555555555555555555555555555";
    const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    const RESOURCE = "https://facilitator.example/v1/charge/dock-001";

    async function payClient(config: { paymasterAddress?: Address | null } = {}) {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        paymasterAddress:
          config.paymasterAddress === null ? null : (config.paymasterAddress ?? MOCK_PAYMASTER),
        keyStore: { type: "file-dev-only", privateKey: TEST_PRIVATE_KEY },
      });
      return pinely.machines.create({
        name: "pay-bot",
        operator: OPERATOR_ADDRESS,
        account: OPERATOR_ADDRESS,
      });
    }

    /** A UserOperation plus a hash that is consistent with it, as a malicious facilitator would send. */
    function consistent(
      op: PackedUserOperation,
      extra: Partial<PreparedSettlement> = {},
      entryPoint: Address = ENTRY_POINT,
    ): PreparedSettlement {
      return {
        userOp: serializeUserOperation(op),
        userOpHash: getUserOpHash(op, entryPoint, 46630),
        entryPoint,
        chainId: 46630,
        ...extra,
      };
    }

    interface PrepareRequest {
      machineAccount: Address;
      merchantAddress: Address;
      intent: { amountStable: string };
    }

    /**
     * Installs a fake facilitator: GET returns the x402 challenge, POST /v1/settle/prepare builds the
     * UserOperation (optionally a tampered one), POST /v1/settle records the submission.
     */
    function fakeFacilitator(options: {
      challenge?: Record<string, unknown>;
      challengeStatus?: number;
      fee?: bigint;
      feeRecipient?: Address;
      /** Returns the prepared settlement a malicious facilitator would send instead of the honest one. */
      tamper?: (honest: PackedUserOperation, request: PrepareRequest) => PreparedSettlement;
      prepareStatus?: number;
      settle?: Record<string, unknown>;
      settleStatus?: number;
    }) {
      const originalFetch = globalThis.fetch;
      const seen: {
        prepareCalls: number;
        settleCalls: number;
        settleBody?: Record<string, unknown>;
        prepared?: PreparedSettlement;
      } = { prepareCalls: 0, settleCalls: 0 };
      const accept = {
        asset: MOCK_STABLECOIN,
        payTo: MERCHANT,
        maxAmountRequired: "250000",
        resource: RESOURCE,
        extra: { chainId: 46630 },
        ...(options.challenge ?? {}),
      };

      globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
        const target = String(url);
        if (init?.method === "POST" && target.endsWith("/v1/settle/prepare")) {
          seen.prepareCalls++;
          if (options.prepareStatus) return new Response("{}", { status: options.prepareStatus });
          const request = JSON.parse(init.body ?? "{}") as PrepareRequest;
          const gross = BigInt(request.intent.amountStable);
          const fee = options.fee ?? 0n;
          const honest = buildSettlementUserOp({
            sender: request.machineAccount,
            nonce: 5n,
            stablecoin: MOCK_STABLECOIN,
            merchant: request.merchantAddress,
            amount: gross - fee,
            paymaster: MOCK_PAYMASTER,
            feeRecipient: options.feeRecipient,
            feeAmount: fee,
          });
          seen.prepared = options.tamper
            ? options.tamper(honest, request)
            : consistent(honest, {
                facilitatorFee: fee.toString(),
                feeRecipient: options.feeRecipient,
              });
          return new Response(JSON.stringify(seen.prepared), { status: 200 });
        }
        if (init?.method === "POST") {
          seen.settleCalls++;
          seen.settleBody = JSON.parse(init.body ?? "{}");
          return new Response(
            JSON.stringify(
              options.settle ?? {
                status: "settled",
                txHash: `0x${"ab".repeat(32)}`,
                accessToken: "tok",
              },
            ),
            { status: options.settleStatus ?? 200 },
          );
        }
        return new Response(JSON.stringify({ accepts: [accept] }), {
          status: options.challengeStatus ?? 402,
        });
      }) as typeof fetch;
      return { seen, restore: () => (globalThis.fetch = originalFetch) };
    }

    const PAY = {
      url: RESOURCE,
      maxAmount: 300_000n,
      facilitatorUrl: "https://facilitator.example",
    };

    it("signs the intent, verifies the prepared UserOperation, signs its hash and settles", async () => {
      const machine = await payClient();
      const fake = fakeFacilitator({});
      try {
        const result = await machine.pay(PAY);

        expect(result.status).toBe("settled");
        expect(result.amountStable).toBe(250_000n); // the challenge amount, not the cap
        expect(result.accessToken).toBe("tok");
        expect(fake.seen.prepareCalls).toBe(1);

        const body = fake.seen.settleBody as {
          intent: Record<string, string>;
          signature: Hex;
          machineAccount: Address;
          merchantAddress: Address;
          userOp: PreparedSettlement["userOp"];
          userOpSignature: Hex;
        };
        expect(body.merchantAddress).toBe(MERCHANT);
        expect(body.machineAccount.toLowerCase()).toBe(machine.account.toLowerCase());

        // The intent signature recovers to the session key under the PINELYFacilitator domain.
        const intentSigner = await recoverTypedDataAddress({
          domain: getPinelyFacilitatorDomain(MOCK_REGISTRY, 46630n),
          types: PAYMENT_402_TYPES,
          primaryType: "Payment402Intent",
          message: {
            machineId: body.intent.machineId as Hex,
            resource: body.intent.resource,
            amountStable: BigInt(body.intent.amountStable),
            nonce: BigInt(body.intent.nonce),
            deadline: BigInt(body.intent.deadline),
          },
          signature: body.signature,
        });
        expect(intentSigner.toLowerCase()).toBe(EXPECTED_SIGNER.toLowerCase());

        // The UserOperation signature is personal_sign over the raw userOpHash, which is what
        // PinelyAccount.validateUserOp recovers.
        const opSigner = await recoverMessageAddress({
          message: { raw: fake.seen.prepared!.userOpHash },
          signature: body.userOpSignature,
        });
        expect(opSigner.toLowerCase()).toBe(EXPECTED_SIGNER.toLowerCase());
        expect(body.userOp).toEqual(fake.seen.prepared!.userOp);
      } finally {
        fake.restore();
      }
    });

    it("accepts a small facilitator fee paid in the same UserOperation", async () => {
      const machine = await payClient();
      const fake = fakeFacilitator({ fee: 250n, feeRecipient: OTHER }); // 0.10% of 250,000
      try {
        const result = await machine.pay(PAY);
        expect(result.status).toBe("settled");
        expect(fake.seen.settleCalls).toBe(1);
      } finally {
        fake.restore();
      }
    });

    // Each case below is a UserOperation that is internally consistent (its hash matches), so only
    // checking its content against the agreed payment can catch it.
    const GROSS = 250_000n;
    const maliciousOps: [string, NonNullable<Parameters<typeof fakeFacilitator>[0]["tamper"]>][] = [
      [
        "pays another recipient",
        (h, r) =>
          consistent(
            buildSettlementUserOp({
              sender: r.machineAccount,
              nonce: h.nonce,
              stablecoin: MOCK_STABLECOIN,
              merchant: OTHER,
              amount: GROSS,
              paymaster: MOCK_PAYMASTER,
            }),
          ),
      ],
      [
        "pays more than agreed",
        (h, r) =>
          consistent(
            buildSettlementUserOp({
              sender: r.machineAccount,
              nonce: h.nonce,
              stablecoin: MOCK_STABLECOIN,
              merchant: MERCHANT,
              amount: GROSS * 2n,
              paymaster: MOCK_PAYMASTER,
            }),
          ),
      ],
      [
        "pays a different token",
        (h, r) =>
          consistent(
            buildSettlementUserOp({
              sender: r.machineAccount,
              nonce: h.nonce,
              stablecoin: OTHER,
              merchant: MERCHANT,
              amount: GROSS,
              paymaster: MOCK_PAYMASTER,
            }),
          ),
      ],
      [
        "uses another paymaster",
        (h, r) =>
          consistent(
            buildSettlementUserOp({
              sender: r.machineAccount,
              nonce: h.nonce,
              stablecoin: MOCK_STABLECOIN,
              merchant: MERCHANT,
              amount: GROSS,
              paymaster: OTHER,
            }),
          ),
      ],
      [
        "is sent from another account",
        (h) =>
          consistent(
            buildSettlementUserOp({
              sender: OTHER,
              nonce: h.nonce,
              stablecoin: MOCK_STABLECOIN,
              merchant: MERCHANT,
              amount: GROSS,
              paymaster: MOCK_PAYMASTER,
            }),
          ),
      ],
      ["is bound to another EntryPoint", (h) => consistent(h, {}, OTHER)],
      [
        "inflates the gas fees (drains the machine's paymaster credit)",
        (h) => consistent({ ...h, gasFees: `0x${"00".repeat(15)}01${"00".repeat(15)}ff` as Hex }),
      ],
      [
        "inflates the gas limits",
        (h) => consistent({ ...h, accountGasLimits: `0x${"ff".repeat(32)}` as Hex }),
      ],
      [
        "deploys code through initCode",
        (h) => consistent({ ...h, initCode: `0x${"11".repeat(24)}` as Hex }),
      ],
      [
        "arrives already signed",
        (h) => consistent({ ...h, signature: `0x${"22".repeat(65)}` as Hex }),
      ],
      [
        "lies about the userOpHash",
        (h) => ({ ...consistent(h), userOpHash: `0x${"33".repeat(32)}` as Hex }),
      ],
      [
        "charges a fee above the accepted cap (5%)",
        (h, r) =>
          consistent(
            buildSettlementUserOp({
              sender: r.machineAccount,
              nonce: h.nonce,
              stablecoin: MOCK_STABLECOIN,
              merchant: MERCHANT,
              amount: GROSS - 12_500n,
              paymaster: MOCK_PAYMASTER,
              feeRecipient: OTHER,
              feeAmount: 12_500n,
            }),
            { facilitatorFee: "12500", feeRecipient: OTHER },
          ),
      ],
      [
        "hides a fee transfer that it does not declare",
        (h, r) =>
          consistent(
            buildSettlementUserOp({
              sender: r.machineAccount,
              nonce: h.nonce,
              stablecoin: MOCK_STABLECOIN,
              merchant: MERCHANT,
              amount: GROSS - 100n,
              paymaster: MOCK_PAYMASTER,
              feeRecipient: OTHER,
              feeAmount: 100n,
            }),
          ),
      ],
    ];
    for (const [label, tamper] of maliciousOps) {
      it(`never signs a UserOperation that ${label}`, async () => {
        const machine = await payClient();
        const fake = fakeFacilitator({ tamper });
        try {
          const result = await machine.pay(PAY);
          expect(result.status).toBe("failed");
          expect(result.error).toContain("Refused to sign the UserOperation");
          expect(fake.seen.settleCalls).toBe(0); // nothing signed, nothing submitted
        } finally {
          fake.restore();
        }
      });
    }

    it("refuses to continue without a configured paymaster", async () => {
      const machine = await payClient({ paymasterAddress: null });
      const fake = fakeFacilitator({});
      try {
        const result = await machine.pay(PAY);
        expect(result.status).toBe("failed");
        expect(result.error).toContain("PinelyPaymaster address is required");
        expect(fake.seen.prepareCalls).toBe(0);
      } finally {
        fake.restore();
      }
    });

    it("reports a failed prepare instead of pretending to settle", async () => {
      const machine = await payClient();
      const fake = fakeFacilitator({ prepareStatus: 403 });
      try {
        const result = await machine.pay(PAY);
        expect(result.status).toBe("failed");
        expect(result.error).toContain("HTTP 403");
        expect(fake.seen.settleCalls).toBe(0);
      } finally {
        fake.restore();
      }
    });

    const badChallenges: [string, Parameters<typeof fakeFacilitator>[0]][] = [
      ["a different asset", { challenge: { asset: "0x9999999999999999999999999999999999999999" } }],
      ["a different network", { challenge: { extra: { chainId: 4663 } } }],
      ["more than maxAmount", { challenge: { maxAmountRequired: "300001" } }],
      ["a zero amount", { challenge: { maxAmountRequired: "0" } }],
      ["no payTo", { challenge: { payTo: undefined } }],
      ["a non-402 status", { challengeStatus: 200 }],
    ];
    for (const [label, options] of badChallenges) {
      it(`refuses to sign when the challenge asks for ${label}`, async () => {
        const machine = await payClient();
        const fake = fakeFacilitator(options);
        try {
          const result = await machine.pay(PAY);
          expect(result.status).toBe("failed");
          expect(fake.seen.prepareCalls).toBe(0);
          expect(fake.seen.settleCalls).toBe(0);
        } finally {
          fake.restore();
        }
      });
    }

    it("reports failure when the facilitator does not confirm settlement", async () => {
      const machine = await payClient();
      const fake = fakeFacilitator({ settle: { status: "settled" } }); // no txHash, no accessToken
      try {
        const result = await machine.pay(PAY);
        expect(result.status).toBe("failed");
        expect(result.accessToken).toBeUndefined();
      } finally {
        fake.restore();
      }
    });

    it("reports the facilitator error status instead of pretending to settle", async () => {
      const machine = await payClient();
      const fake = fakeFacilitator({ settle: { status: "failed" }, settleStatus: 409 });
      try {
        const result = await machine.pay(PAY);
        expect(result.status).toBe("failed");
        expect(result.error).toContain("HTTP 409");
      } finally {
        fake.restore();
      }
    });

    it("should build valid setPolicy, freeze, and unfreeze calldata", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: {
          type: "file-dev-only",
          privateKey: TEST_PRIVATE_KEY,
        },
      });

      const machine = await pinely.machines.create({
        name: "admin-bot",
        operator: OPERATOR_ADDRESS,
      });

      const setPolicyTx = machine.buildSetPolicyTx({
        maxStableOutPerSwap: 100_000n,
        dailyStableOutCap: 500_000n,
        enabled: true,
      });
      const decodedPolicy = decodeFunctionData({
        abi: machineRegistryAbi,
        data: setPolicyTx.data,
      });
      expect(decodedPolicy.functionName).toBe("setPolicy");
      expect(decodedPolicy.args[1].maxStableOutPerSwap).toBe(100_000n);

      const freezeTx = machine.buildFreezeTx();
      const decodedFreeze = decodeFunctionData({
        abi: machineRegistryAbi,
        data: freezeTx.data,
      });
      expect(decodedFreeze.functionName).toBe("freezeMachine");

      const unfreezeTx = machine.buildUnfreezeTx();
      const decodedUnfreeze = decodeFunctionData({
        abi: machineRegistryAbi,
        data: unfreezeTx.data,
      });
      expect(decodedUnfreeze.functionName).toBe("unfreezeMachine");
    });

    it("should build valid SurplusSweeper config, sweep, and approval calldata", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: {
          type: "file-dev-only",
          privateKey: TEST_PRIVATE_KEY,
        },
      });

      const machine = await pinely.machines.create({
        name: "sweeper-bot",
        operator: OPERATOR_ADDRESS,
      });

      const mockSweeper = "0x8888888888888888888888888888888888888888" as Address;
      const mockVault = "0x9999999999999999999999999999999999999999" as Address;

      // 1. Config TX
      const configTx = machine.buildSetSweepConfigTx(mockSweeper, {
        reserveThreshold: 50_000_000n,
        destination: mockVault,
        enabled: true,
      });
      expect(configTx.to).toBe(mockSweeper);
      const decodedConfig = decodeFunctionData({
        abi: surplusSweeperAbi,
        data: configTx.data,
      });
      expect(decodedConfig.functionName).toBe("setMachineConfig");
      expect(decodedConfig.args[0]).toBe(machine.machineId);
      expect(decodedConfig.args[2]).toBe(50_000_000n);
      expect(decodedConfig.args[3]).toBe(mockVault);

      // 2. Sweep TX
      const sweepTx = machine.buildSweepTx(mockSweeper);
      expect(sweepTx.to).toBe(mockSweeper);
      const decodedSweep = decodeFunctionData({
        abi: surplusSweeperAbi,
        data: sweepTx.data,
      });
      expect(decodedSweep.functionName).toBe("sweep");
      expect(decodedSweep.args[0]).toBe(machine.machineId);

      // 3. Approval TX
      const approveTx = machine.buildApproveSweeperTx(MOCK_STABLECOIN, mockSweeper);
      expect(approveTx.to).toBe(MOCK_STABLECOIN);
      expect(approveTx.data).toBeDefined();
    });
  });

  describe("Pinely Client on Robinhood Chain Testnet (46630)", () => {
    it("should initialize Pinely with Robinhood Chain Testnet chainId and stablecoin settlement", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        routerAddress: MOCK_ROUTER,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN, // using 6-decimal token
        keyStore: {
          type: "file-dev-only",
          privateKey: TEST_PRIVATE_KEY,
        },
      });

      expect(pinely.chainId).toBe(46630n);

      const machine = await pinely.machines.create({
        name: "test-drone-01",
        operator: OPERATOR_ADDRESS,
      });

      expect(machine.chainId).toBe(46630n);
      expect(machine.stablecoinAddress).toBe(MOCK_STABLECOIN);

      const prepared = await machine.prepareSwap({
        tokenIn: OPERATOR_ADDRESS,
        amountIn: 5_000_000n,
        minAmountOut: 4_950_000n,
      });

      expect(prepared.intent.chainId).toBe(46630n);
      expect(prepared.intent.amountIn).toBe(5_000_000n);

      const recoveredSigner = await recoverTypedDataAddress({
        domain: getPinelyDomain(MOCK_HOOK, 46630n),
        types: SWAP_INTENT_TYPES,
        primaryType: "SwapIntent",
        message: prepared.intent,
        signature: prepared.signature,
      });

      expect(recoveredSigner.toLowerCase()).toBe(EXPECTED_SIGNER.toLowerCase());
    });
  });
  describe("Anti-replay and fail-closed behaviour", () => {
    it("rejects a signature made under a different EIP-712 domain name", async () => {
      const keystore = new DevKeyStore(TEST_PRIVATE_KEY);
      const message = {
        machineId: keccak256(toBytes("m")),
        poolId: keccak256(toBytes("p")),
        tokenIn: MOCK_STABLECOIN,
        tokenOut: OPERATOR_ADDRESS,
        amountIn: 1n,
        minAmountOut: 1n,
        nonce: 1n,
        deadline: 1893456000n,
        chainId: 46630n,
      };
      const foreignDomain = { ...getPinelyDomain(MOCK_HOOK, 46630n), name: "OTHER" } as const;
      const signature = await keystore.signTypedData({
        domain: foreignDomain,
        types: SWAP_INTENT_TYPES,
        primaryType: "SwapIntent",
        message,
      });
      const recovered = await recoverTypedDataAddress({
        domain: getPinelyDomain(MOCK_HOOK, 46630n),
        types: SWAP_INTENT_TYPES,
        primaryType: "SwapIntent",
        message,
        signature: signature as Hex,
      });
      expect(recovered.toLowerCase()).not.toBe(EXPECTED_SIGNER.toLowerCase());
    });

    it("refuses unsupported chains instead of defaulting to testnet", async () => {
      await expect(
        Pinely.connect({
          chain: "unknownChain" as never,
          registryAddress: MOCK_REGISTRY,
          keyStore: { type: "file-dev-only", privateKey: TEST_PRIVATE_KEY },
        }),
      ).rejects.toThrow("Unsupported chain");
    });

    it("fails closed on swaps while PinelyHook is not deployed (Stage 1)", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: { type: "file-dev-only", privateKey: TEST_PRIVATE_KEY },
      });
      const machine = await pinely.machines.create({ name: "stage1", operator: OPERATOR_ADDRESS });
      await expect(
        machine.prepareSwap({ tokenIn: OPERATOR_ADDRESS, amountIn: 1n, minAmountOut: 1n }),
      ).rejects.toThrow("PinelyHook is not deployed");
    });

    it("does not report 'not frozen' when the kill-switch state is unknown", async () => {
      const pinely = await Pinely.connect({
        chain: "robinhoodTestnet",
        registryAddress: MOCK_REGISTRY,
        hookAddress: MOCK_HOOK,
        stablecoinAddress: MOCK_STABLECOIN,
        keyStore: { type: "file-dev-only", privateKey: TEST_PRIVATE_KEY },
      });
      const machine = await pinely.machines.create({ name: "ks", operator: OPERATOR_ADDRESS });
      await expect(machine.isFrozen()).rejects.toThrow("kill-switch state is unknown");
    });
  });
  describe("Cross-package parity (contract, TypeScript, Python)", () => {
    it("builds the same EIP-712 type string as the SWAP_INTENT_TYPEHASH in PinelyHook.sol", () => {
      const source = readFileSync(
        new URL("../../contracts/src/PinelyHook.sol", import.meta.url),
        "utf8",
      );
      const onChain = source.match(/SWAP_INTENT_TYPEHASH\s*=\s*keccak256\(\s*"([^"]+)"/)?.[1];
      expect(onChain).toBeDefined();

      const fields = SWAP_INTENT_TYPES.SwapIntent.map((f) => `${f.type} ${f.name}`).join(",");
      expect(`SwapIntent(${fields})`).toBe(onChain!);
    });

    // The same two digests are asserted in sdk-python/tests/test_pinely_sdk.py. If either SDK changes
    // a type, a field or a domain, one of the two suites fails.
    const HOOK: Address = "0x00000000000000000000000000000000000000c0";
    const REGISTRY: Address = "0x1111111111111111111111111111111111111111";
    const MACHINE_ID: Hex = `0x${"ab".repeat(32)}`;

    it("produces the golden SwapIntent digest", () => {
      const digest = hashTypedData({
        domain: getPinelyDomain(HOOK, 46630n),
        types: SWAP_INTENT_TYPES,
        primaryType: "SwapIntent",
        message: {
          machineId: MACHINE_ID,
          poolId: `0x${"cd".repeat(32)}`,
          tokenIn: "0x7777777777777777777777777777777777777777",
          tokenOut: "0x5555555555555555555555555555555555555555",
          amountIn: 5_000_000n,
          minAmountOut: 4_950_000n,
          nonce: 12345n,
          deadline: 1893456000n,
          chainId: 46630n,
        },
      });
      expect(digest).toBe("0x7a138613a85ff1dcba3c0443ee7c8f1db83674bbd9eea60361647cc58e1b37d8");
    });

    it("produces the golden Payment402Intent digest", () => {
      const digest = hashTypedData({
        domain: getPinelyFacilitatorDomain(REGISTRY, 46630n),
        types: PAYMENT_402_TYPES,
        primaryType: "Payment402Intent",
        message: {
          machineId: MACHINE_ID,
          resource: "https://facilitator.example/v1/charge/dock-001",
          amountStable: 250_000n,
          nonce: 777n,
          deadline: 1893456000n,
        },
      });
      expect(digest).toBe("0x13843d93774423f08e658920ed748443d9a203c5d002e6a54310d05ad5adf5d8");
    });
  });
  describe("UserOperation helpers", () => {
    const sender: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const stablecoin: Address = "0x5555555555555555555555555555555555555555";
    const merchant: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const paymaster: Address = "0x3333333333333333333333333333333333333333";
    const entryPoint: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

    it("computes the same userOpHash as viem's EntryPoint v0.7 implementation", () => {
      const op = buildSettlementUserOp({
        sender,
        nonce: 7n,
        stablecoin,
        merchant,
        amount: 99_900n,
        paymaster,
      });
      const callGasLimit = BigInt(`0x${op.accountGasLimits.slice(34)}`);
      const verificationGasLimit = BigInt(`0x${op.accountGasLimits.slice(2, 34)}`);
      const maxPriorityFeePerGas = BigInt(`0x${op.gasFees.slice(2, 34)}`);
      const maxFeePerGas = BigInt(`0x${op.gasFees.slice(34)}`);

      const viemHash = getUserOperationHash({
        chainId: 46630,
        entryPointAddress: entryPoint,
        entryPointVersion: "0.7",
        userOperation: {
          sender: op.sender,
          nonce: op.nonce,
          callData: op.callData,
          callGasLimit,
          verificationGasLimit,
          preVerificationGas: op.preVerificationGas,
          maxFeePerGas,
          maxPriorityFeePerGas,
          paymaster,
          paymasterVerificationGasLimit: 100_000n,
          paymasterPostOpGasLimit: 50_000n,
          signature: "0x",
        },
      });
      expect(getUserOpHash(op, entryPoint, 46630)).toBe(viemHash);
    });

    it("is unaffected by the signature and sensitive to every other field", () => {
      const op = buildSettlementUserOp({
        sender,
        nonce: 7n,
        stablecoin,
        merchant,
        amount: 1n,
        paymaster,
      });
      const hash = getUserOpHash(op, entryPoint, 46630);
      expect(getUserOpHash({ ...op, signature: `0x${"11".repeat(65)}` }, entryPoint, 46630)).toBe(
        hash,
      );
      expect(getUserOpHash({ ...op, nonce: 8n }, entryPoint, 46630)).not.toBe(hash);
      expect(getUserOpHash(op, entryPoint, 4663)).not.toBe(hash);
    });

    it("rejects malformed serialized operations", () => {
      expect(() => deserializeUserOperation({ sender: "nope" } as never)).toThrow();
      const op = serializeUserOperation(
        buildSettlementUserOp({ sender, nonce: 1n, stablecoin, merchant, amount: 1n, paymaster }),
      );
      expect(() => deserializeUserOperation({ ...op, nonce: "7" })).toThrow("hex quantity");
      expect(() => deserializeUserOperation({ ...op, callData: "xyz" as Hex })).toThrow("not hex");
    });

    // The same two values are asserted in sdk-python/tests/test_pinely_sdk.py.
    it("produces the golden settlement callData and userOpHash", () => {
      const op = buildSettlementUserOp({
        sender,
        nonce: 7n,
        stablecoin,
        merchant,
        amount: 99_900n,
        paymaster,
      });
      expect(keccak256(op.callData)).toBe(GOLDEN_CALLDATA_HASH);
      expect(getUserOpHash(op, entryPoint, 46630)).toBe(GOLDEN_USEROP_HASH);

      const withFee = buildSettlementCallData({
        stablecoin,
        merchant,
        amount: 99_800n,
        feeRecipient: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        feeAmount: 100n,
      });
      expect(keccak256(withFee)).toBe(GOLDEN_BATCH_CALLDATA_HASH);
    });
  });
});
