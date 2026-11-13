// Builds the publishable package directory (sdk/.publish) next to the tsup output (sdk/.publish/dist).
//
// The workspace manifest (sdk/package.json) points at TypeScript sources so that backend and tests can
// import the SDK without a build step. That manifest must never be published as-is. This script writes a
// separate, consumer-facing manifest that points at the compiled files and drops workspace-only fields.
//
// Publish with:  cd sdk/.publish && npm publish --tag beta
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sdkDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(sdkDir, ".publish");
const src = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8"));

if (!existsSync(join(outDir, "dist", "index.js"))) {
  throw new Error("sdk/.publish/dist/index.js is missing. Run tsup before prepare-publish.");
}

// Keep only dependencies that exist on npm. Internal workspace packages are inlined by tsup.
const dependencies = Object.fromEntries(
  Object.entries(src.dependencies ?? {}).filter(
    ([, range]) => !String(range).startsWith("workspace:"),
  ),
);

const manifest = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: src.license,
  keywords: src.keywords,
  homepage: src.homepage,
  bugs: src.bugs,
  repository: src.repository,
  type: "module",
  sideEffects: false,
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  // A single bin lets `npx @pinely-protocol/sdk` resolve the executable without -p.
  bin: { pinely: "./dist/bin/pinely.js" },
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./keystore": { types: "./dist/keystore/index.d.ts", import: "./dist/keystore/index.js" },
    "./types": { types: "./dist/types/index.d.ts", import: "./dist/types/index.js" },
    "./package.json": "./package.json",
  },
  files: ["dist", "README.md", "LICENSE"],
  engines: src.engines,
  dependencies,
  publishConfig: { access: "public" },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(sdkDir, "README.md"), join(outDir, "README.md"));
cpSync(join(sdkDir, "..", "LICENSE"), join(outDir, "LICENSE"));
console.log(`Publish directory ready: ${outDir} (${manifest.name}@${manifest.version})`);
