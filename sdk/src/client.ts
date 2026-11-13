import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type PublicClient,
} from "viem";
import { robinhoodTestnet, robinhoodMainnet } from "@pinely/shared/chains";
import { machineRegistryAbi, pinelyAccountFactoryAbi } from "@pinely/shared/contracts";
import { createKeyStore, type IKeyStore } from "./keystore/index.js";
import { MachineClient } from "./machine.js";
import type {
  AttestationData,
  PinelyConfig,
  MachineOnboardParams,
  MachinePolicy,
  MachineRegistrationPayload,
} from "./types/index.js";
import { computePoolId } from "./utils/eip712.js";

/**
 * Computes the canonical machineId: keccak256(abi.encode(account)).
 * The id depends only on the machine account, so it survives operator transfers.
 */
export function computeMachineId(account: Address): Hash {
  return keccak256(encodeAbiParameters([{ type: "address" }], [account]));
}

/**
 * Computes hash of hardware attestation payload.
 */
export function computeAttestationHash(attestation?: AttestationData): Hash {
  if (!attestation) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes" }, { type: "bytes32" }, { type: "uint64" }],
      [
        attestation.algorithm,
        attestation.quote,
        attestation.firmwareHash,
        BigInt(attestation.timestamp),
      ],
    ),
  );
}

export class Pinely {
  readonly config: PinelyConfig;
  readonly keyStore: IKeyStore;
  readonly chainId: bigint;
  readonly publicClient?: PublicClient;

  private constructor(config: PinelyConfig, keyStore: IKeyStore) {
    this.config = config;
    this.keyStore = keyStore;

    const selectedChain =
      config.chain === "robinhoodMainnet"
        ? robinhoodMainnet
        : config.chain === "robinhoodTestnet"
          ? robinhoodTestnet
          : undefined;
    if (!selectedChain) {
      // Fail closed: never guess a network.
      throw new Error(
        `[PINELY] Unsupported chain "${String(config.chain)}" (expected robinhoodTestnet or robinhoodMainnet).`,
      );
    }
    this.chainId = BigInt(selectedChain.id);

    if (config.rpcUrl) {
      this.publicClient = createPublicClient({
        chain: selectedChain,
        transport: http(config.rpcUrl),
      });
    }
  }

  /**
   * Connects SDK to the network and chosen keystore module.
   */
  static async connect(config: PinelyConfig): Promise<Pinely> {
    const keyStore = createKeyStore(config.keyStore);
    return new Pinely(config, keyStore);
  }

  /**
   * Machine device management module.
   */
  get machines() {
    return {
      /**
       * Prepares a new MachineClient with deterministic identity.
       */
      create: async (params: MachineOnboardParams): Promise<MachineClient> => {
        const signerAddress = await this.keyStore.getAddress();

        // Determine machine account address:
        // If not explicitly provided, use predicted counterfactual factory address or signer
        let accountAddress = params.account;
        if (!accountAddress) {
          if (this.config.factoryAddress && this.publicClient) {
            try {
              const salt = params.salt ?? 0n;
              const validUntil = 0; // unlimited
              const validAfter = 0;
              accountAddress = (await this.publicClient.readContract({
                address: this.config.factoryAddress,
                abi: pinelyAccountFactoryAbi,
                functionName: "getAddress",
                args: [params.operator, signerAddress, validUntil, validAfter, salt],
              })) as Address;
            } catch (error) {
              // Fail closed: a wrong account address would silently yield a wrong machineId.
              throw new Error(
                `[PINELY] Could not predict the machine account from the factory: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          } else {
            accountAddress = signerAddress;
          }
        }

        const machineId = computeMachineId(accountAddress);

        return new MachineClient({
          machineId,
          name: params.name,
          operator: params.operator,
          account: accountAddress,
          keyStore: this.keyStore,
          routerAddress: this.config.routerAddress,
          registryAddress: this.config.registryAddress,
          hookAddress: this.config.hookAddress,
          stablecoinAddress: this.config.stablecoinAddress,
          paymasterAddress: this.config.paymasterAddress,
          chainId: this.chainId,
          publicClient: this.publicClient,
        });
      },

      /**
       * Builds transaction payload and calldata to register the machine
       * on MachineRegistry by the fleet operator.
       */
      buildRegistrationTx: (payload: {
        account: Address;
        signer: Address;
        attestationHash?: Hash;
        policy?: MachinePolicy;
        signature?: Hex;
        accountSignature?: Hex;
        deadline?: bigint;
      }) => {
        const attestationHash =
          payload.attestationHash ??
          "0x0000000000000000000000000000000000000000000000000000000000000000";

        const maxSpend = payload.policy?.maxStableOutPerSwap ?? 10_000_000n; // $10 stablecoin (6 decimals)
        const dailyCap = payload.policy?.dailyStableOutCap ?? 50_000_000n; // $50 stablecoin

        const spendPolicy = {
          maxStableOutPerSwap: maxSpend,
          dailyStableOutCap: dailyCap,
          enabled: payload.policy?.enabled ?? true,
        };

        const signature = payload.accountSignature ?? payload.signature;
        const deadline = payload.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);

        let calldata: Hex;
        if (signature) {
          calldata = encodeFunctionData({
            abi: machineRegistryAbi,
            functionName: "registerMachineWithAuth",
            args: [
              payload.account,
              payload.signer,
              attestationHash,
              spendPolicy,
              deadline,
              signature,
            ],
          });
        } else {
          calldata = encodeFunctionData({
            abi: machineRegistryAbi,
            functionName: "registerMachine",
            args: [payload.account, payload.signer, attestationHash, spendPolicy],
          });
        }

        return {
          to: this.config.registryAddress ?? "0x0000000000000000000000000000000000000000",
          data: calldata,
          value: 0n,
        };
      },

      /**
       * Returns a MachineClient instance for an already-registered machine.
       */
      get: async (
        machineId: Hash,
        options: {
          name?: string;
          operator: Address;
          account: Address;
        },
      ): Promise<MachineClient> => {
        return new MachineClient({
          machineId,
          name: options.name ?? `machine-${machineId.slice(0, 8)}`,
          operator: options.operator,
          account: options.account,
          keyStore: this.keyStore,
          routerAddress: this.config.routerAddress,
          registryAddress: this.config.registryAddress,
          hookAddress: this.config.hookAddress,
          stablecoinAddress: this.config.stablecoinAddress,
          paymasterAddress: this.config.paymasterAddress,
          chainId: this.chainId,
          publicClient: this.publicClient,
        });
      },
    };
  }

  /**
   * Hardware attestation collection module.
   */
  get attestation() {
    return {
      collect: async (): Promise<AttestationData | undefined> => {
        if (this.keyStore.collectAttestation) {
          return this.keyStore.collectAttestation();
        }
        return undefined;
      },
      hash: (attestation?: AttestationData): Hash => {
        return computeAttestationHash(attestation);
      },
    };
  }
}
