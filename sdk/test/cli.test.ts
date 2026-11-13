import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "bin", "pinely.ts");

function runCli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("pinely CLI", () => {
  it("prints the version and exits 0", () => {
    const { code, stdout } = runCli(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("exits non-zero for an unknown command", () => {
    const { code, stderr } = runCli(["bogus"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command");
  });

  it("exits non-zero when a payment fails (never reports success to scripts)", () => {
    // Nothing listens on port 9, so the 402 challenge cannot be read and the payment must fail.
    const { code, stdout } = runCli([
      "pay",
      "--url",
      "http://127.0.0.1:9/v1/charge/x",
      "--max-amount",
      "1000",
      "--facilitator",
      "http://127.0.0.1:9",
    ]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).status).toBe("failed");
  });

  it("prints a concise error without a stack trace unless PINELY_DEBUG is set", () => {
    const args = [
      "swap",
      "--amount-in",
      "1000000",
      "--min-out",
      "990000",
      "--token-in",
      "0x7ddbb739c5c81cee5872571579225764d925025b",
    ];
    const concise = runCli(args);
    expect(concise.code).toBe(1);
    expect(concise.stderr).toContain("Error:");
    expect(concise.stderr).not.toMatch(/\n\s+at /);

    const debug = runCli(args, { PINELY_DEBUG: "1" });
    expect(debug.code).toBe(1);
    expect(debug.stderr).toMatch(/\n\s+at /);
  });
});
