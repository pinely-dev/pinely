import {
  type Address,
  type Hex,
  type SignableMessage,
  type TypedData,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AttestationData } from "../types/index.js";
import type { IKeyStore } from "./index.js";

/**
 * Keystore for local development and testing.
 * WARNING: never use this mode in a production environment!
 */
export class DevKeyStore implements IKeyStore {
  readonly type = "file-dev-only";
  private account;

  constructor(privateKey: Hex) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CRITICAL: DevKeyStore (file-dev-only) must not be used in a production environment!",
      );
    }
    this.account = privateKeyToAccount(privateKey);
  }

  async getAddress(): Promise<Address> {
    return this.account.address;
  }

  async getPublicKey(): Promise<Hex> {
    return this.account.publicKey;
  }

  async signMessage(message: SignableMessage): Promise<Hex> {
    return this.account.signMessage({ message });
  }

  async signTypedData<
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
  >(definition: TypedDataDefinition<typedData, primaryType>): Promise<Hex> {
    return this.account.signTypedData(definition as any);
  }

  async collectAttestation(): Promise<AttestationData> {
    return {
      algorithm: "dev-mock-sha256",
      quote: "0x00" as Hex,
      firmwareHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }
}
