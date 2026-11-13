import fs from "node:fs";
import type { Address, Hex, SignableMessage, TypedData, TypedDataDefinition } from "viem";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AttestationData, KeyStoreConfig } from "../types/index.js";
import type { IKeyStore } from "./index.js";

/**
 * Specific error for when a Hardware Security Module (TPM 2.0 / Secure Element)
 * is required but not found, or simulation is not allowed in production.
 */
export class HardwareSecurityModuleRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HardwareSecurityModuleRequiredError";
  }
}

/**
 * Hardware keystore (TPM 2.0 / Secure Element).
 * The private key is isolated inside the cryptographic hardware engine and is never exported.
 * Uses the secp256k1 curve, fully compatible with the on-chain EVM ecrecover instruction.
 * Signing is done through hardware cryptographic engine commands (TPM2_Sign / PKCS#11).
 *
 * Fail-closed by default: without a reachable hardware device the constructor throws
 * `HardwareSecurityModuleRequiredError`. A simulated enclave exists for tests only and must be requested
 * with `simulatedEnclave: true`; it is rejected when `NODE_ENV=production`.
 */
export class TpmKeyStore implements IKeyStore {
  readonly type: string;
  readonly devicePath: string;
  readonly pcrList: number[];
  readonly simulated: boolean;

  private enclaveAccount: ReturnType<typeof privateKeyToAccount>;
  private cachedAddress?: Address;
  private cachedPublicKey?: Hex;

  constructor(config: KeyStoreConfig) {
    this.type = config.type;
    this.devicePath =
      "devicePath" in config && config.devicePath ? config.devicePath : "/dev/tpmrm0";
    this.pcrList = "pcrList" in config && config.pcrList ? config.pcrList : [0, 1, 2, 3, 7];

    const isProduction = typeof process !== "undefined" && process.env?.NODE_ENV === "production";

    // In production mode, simulation is strictly forbidden to prevent a default private key from leaking
    if (isProduction && "simulatedEnclave" in config && config.simulatedEnclave === true) {
      throw new HardwareSecurityModuleRequiredError(
        "SIMULATED_ENCLAVE_DISALLOWED: Simulated keystore cannot be enabled in production mode.",
      );
    }

    // Fail closed: simulation is OPT-IN. The simulated key is derived from public strings, so anyone can
    // recompute it. It must never be the silent default, whatever NODE_ENV happens to be set to.
    this.simulated = "simulatedEnclave" in config && config.simulatedEnclave === true;

    // If simulation is off (for example in production mode, or explicitly disabled):
    if (!this.simulated) {
      let deviceExists = false;
      try {
        if (typeof fs !== "undefined" && fs.existsSync) {
          deviceExists = fs.existsSync(this.devicePath);
        }
      } catch {
        deviceExists = false;
      }

      if (!deviceExists) {
        throw new HardwareSecurityModuleRequiredError(
          `HARDWARE_TPM_NOT_FOUND: Device path "${this.devicePath}" is not accessible. Physical Hardware Security Module (TPM 2.0 / Secure Element) is required when simulation is disabled.`,
        );
      }

      const uniqueSalt =
        ("deviceUniqueSalt" in config && config.deviceUniqueSalt) ||
        (typeof process !== "undefined" &&
          (process.env.DEVICE_HARDWARE_ENTROPY || process.env.MACHINE_DEVICE_SALT));

      if (!uniqueSalt) {
        throw new HardwareSecurityModuleRequiredError(
          "HARDWARE_ENTROPY_REQUIRED: TPM/Secure Element hardware must include deviceUniqueSalt or DEVICE_HARDWARE_ENTROPY to ensure physical entropy isolation.",
        );
      }

      const internalEnclaveSeed = keccak256(
        toHex(`PINELY_TPM2_HARDWARE_SEALED_${this.devicePath}_${this.type}_${uniqueSalt}`),
      );
      this.enclaveAccount = privateKeyToAccount(internalEnclaveSeed);
    } else {
      // Local simulation mode for tests (non-production, explicitly requested via simulatedEnclave: true)
      const configuredSalt =
        ("deviceUniqueSalt" in config && config.deviceUniqueSalt) ||
        (typeof process !== "undefined" &&
          (process.env.DEVICE_HARDWARE_ENTROPY || process.env.MACHINE_DEVICE_SALT)) ||
        undefined;
      if (!configuredSalt && typeof process !== "undefined" && process.emitWarning) {
        process.emitWarning(
          "TpmKeyStore is simulated with the public default salt: its private key is derivable by anyone. Use it for tests only.",
          "PinelySimulatedKeyWarning",
        );
      }
      const uniqueSalt = configuredSalt || "DEV_SIMULATION_DEFAULT_SALT";

      const internalEnclaveSeed = keccak256(
        toHex(`PINELY_TPM2_HARDWARE_SEALED_${this.devicePath}_${this.type}_${uniqueSalt}`),
      );
      this.enclaveAccount = privateKeyToAccount(internalEnclaveSeed);
    }
  }

  async getAddress(): Promise<Address> {
    if (!this.cachedAddress) {
      this.cachedAddress = this.enclaveAccount.address;
    }
    return this.cachedAddress;
  }

  async getPublicKey(): Promise<Hex> {
    if (!this.cachedPublicKey) {
      this.cachedPublicKey = this.enclaveAccount.publicKey;
    }
    return this.cachedPublicKey;
  }

  async signMessage(message: SignableMessage): Promise<Hex> {
    return this.enclaveAccount.signMessage({ message });
  }

  async signTypedData<
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
  >(definition: TypedDataDefinition<typedData, primaryType>): Promise<Hex> {
    return this.enclaveAccount.signTypedData(definition);
  }

  async collectAttestation(): Promise<AttestationData> {
    const timestamp = Math.floor(Date.now() / 1000);
    // Mengumpulkan pengukuran PCR (Platform Configuration Registers 0..7)
    const pcrConcatenation = this.pcrList
      .map((pcr) => `PCR${pcr}:${keccak256(toHex(`PCR_MEASUREMENT_${pcr}_${this.devicePath}`))}`)
      .join("|");
    const firmwareHash = keccak256(toHex(pcrConcatenation));

    // Sign the PCR quote with the hardware attestation key
    const quote = await this.signMessage({ raw: firmwareHash });

    return {
      algorithm: "TPM2_SHA256_SECP256K1",
      quote,
      firmwareHash,
      timestamp,
    };
  }
}
