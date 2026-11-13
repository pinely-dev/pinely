import type { Address, Hash, Hex, SignableMessage, TypedData, TypedDataDefinition } from "viem";
import type { AttestationData, KeyStoreConfig } from "../types/index.js";
import { DevKeyStore } from "./dev-keystore.js";
import { HardwareSecurityModuleRequiredError, TpmKeyStore } from "./tpm-keystore.js";

export interface IKeyStore {
  readonly type: string;
  getAddress(): Promise<Address>;
  getPublicKey(): Promise<Hex>;
  signMessage(message: SignableMessage): Promise<Hex>;
  signTypedData<
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
  >(
    definition: TypedDataDefinition<typedData, primaryType>,
  ): Promise<Hex>;
  collectAttestation?(): Promise<AttestationData>;
}

export function createKeyStore(config: KeyStoreConfig): IKeyStore {
  switch (config.type) {
    case "file-dev-only":
      return new DevKeyStore(config.privateKey);
    case "tpm":
    case "secure-element":
      return new TpmKeyStore(config);
    default:
      throw new Error(`Unsupported keystore type: ${(config as { type: string }).type}`);
  }
}

export { DevKeyStore, HardwareSecurityModuleRequiredError, TpmKeyStore };
