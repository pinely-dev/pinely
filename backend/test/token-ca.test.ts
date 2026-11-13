import { describe, expect, it } from "bun:test";
import { getAddress } from "viem";
import { resolvePinelyTokenCa } from "@pinely/shared/contracts";

// Checksummed form of an arbitrary address, used only as a test value.
const CHECKSUMMED = getAddress("0x5fc5360d0400a0fd4f2af552add042d716f1d168");

describe("resolvePinelyTokenCa", () => {
  it("accepts the committed configuration: mainnet is TBA or a checksummed address", () => {
    const mainnet = resolvePinelyTokenCa(4663);
    if (mainnet.status === "live") {
      expect(getAddress(mainnet.address)).toBe(mainnet.address);
    } else {
      expect(mainnet).toEqual({ status: "tba" });
    }
  });

  it("stays TBA on testnet and for an unknown chain: the token exists on mainnet only", () => {
    expect(resolvePinelyTokenCa(46630)).toEqual({ status: "tba" });
    expect(resolvePinelyTokenCa(undefined)).toEqual({ status: "tba" });
  });

  it("is TBA for an unset or empty key", () => {
    expect(resolvePinelyTokenCa(4663, { "4663": {} })).toEqual({ status: "tba" });
    expect(resolvePinelyTokenCa(4663, { "4663": { PINELY: "" } })).toEqual({ status: "tba" });
  });

  it("returns a valid checksummed address as live", () => {
    expect(resolvePinelyTokenCa(4663, { "4663": { PINELY: CHECKSUMMED } })).toEqual({
      status: "live",
      address: CHECKSUMMED,
    });
  });

  it("only reads the requested chain", () => {
    expect(resolvePinelyTokenCa(46630, { "4663": { PINELY: CHECKSUMMED } })).toEqual({
      status: "tba",
    });
  });

  it("rejects a lowercase address", () => {
    expect(() =>
      resolvePinelyTokenCa(4663, { "4663": { PINELY: CHECKSUMMED.toLowerCase() } }),
    ).toThrow(/EIP-55/);
  });

  it("rejects a wrongly cased address", () => {
    const wrong = CHECKSUMMED.replace(/[a-f]/, (c) => c.toUpperCase());
    // Only meaningful when the swap actually changed the casing.
    if (wrong !== CHECKSUMMED) {
      expect(() => resolvePinelyTokenCa(4663, { "4663": { PINELY: wrong } })).toThrow(/EIP-55/);
    }
  });

  it("rejects the zero address and malformed values", () => {
    const zero = "0x0000000000000000000000000000000000000000";
    expect(() => resolvePinelyTokenCa(4663, { "4663": { PINELY: zero } })).toThrow();
    expect(() => resolvePinelyTokenCa(4663, { "4663": { PINELY: "0x1234" } })).toThrow();
    expect(() => resolvePinelyTokenCa(4663, { "4663": { PINELY: "not-an-address" } })).toThrow();
  });
});
