import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// The published package is self-contained: the internal workspace package @pinely/shared is inlined
// (its ABIs, chain profiles and address book), while viem and zod stay regular npm dependencies.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "keystore/index": "src/keystore/index.ts",
    "types/index": "src/types/index.ts",
    "bin/pinely": "bin/pinely.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: ".publish/dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  dts: { entry: ["src/index.ts", "src/keystore/index.ts", "src/types/index.ts"], resolve: true },
  noExternal: ["@pinely/shared"],
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
});
