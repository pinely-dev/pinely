// Fails when a tracked (or new, not ignored) file still carries a label from the previous chain.
//
//   bun run check:legacy
//
// The migration to Robinhood Chain is only complete when this reports zero findings outside the allowlist.
// Ignored files (a local .env) are not scanned; clean those by hand.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Case-insensitive words, plus the old chain ids and the claims that only held for the old chain.
const WORDS =
  /elysium|kinetiq|hyperliquid|hyperevm|hypercore|\b99801\b|\b99901\b|nitro orbit|100[–-]200 ?ms/i;
// Case-sensitive: the old gas token and its wrapped form.
const TOKEN = /\bHYPE\b|WHYPE|Hype[A-Z]/;

// History and the plan that describes the migration may name the old chain. Remove entries as they are archived.
const ALLOWED_PREFIXES = ["docs/archive/"];
const ALLOWED_FILES = new Set([
  "docs/plans/09-robinhood-chain-migration.md", // moves to docs/archive/ at the end of the migration (Phase 7)
  "scripts/check-no-legacy-chain.mjs",
]);
// The archive folder is itself named after the old chain; a reference to it is allowed.
const ARCHIVE_PATH = "archive/elysium-era";
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|glb|woff2?|ttf|otf|pdf|lock|lockb)$/i;
const SKIP_NAMES = new Set(["bun.lock"]);

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const files = [
  ...new Set(
    git("ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean),
  ),
];

const findings = [];
for (const file of files) {
  if (ALLOWED_FILES.has(file) || ALLOWED_PREFIXES.some((p) => file.startsWith(p))) continue;
  if (SKIP_EXT.test(file) || SKIP_NAMES.has(file.split("/").pop())) continue;
  if (!existsSync(join(root, file))) continue; // deleted in the working tree, still listed by git until committed
  if (WORDS.test(file)) findings.push(`${file}  (file name)`);
  let text;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    continue; // deleted in the working tree but still listed, or unreadable
  }
  if (text.includes("\u0000")) continue; // binary
  text.split(/\r?\n/).forEach((line, i) => {
    const checked = line.replaceAll(ARCHIVE_PATH, ""); // a link into the archive is not a legacy label
    if (WORDS.test(checked) || TOKEN.test(checked))
      findings.push(`${file}:${i + 1}  ${line.trim().slice(0, 140)}`);
  });
}

if (findings.length === 0) {
  console.log("No legacy chain labels found.");
} else {
  console.log(findings.join("\n"));
  const fileCount = new Set(findings.map((f) => f.split(/[:\s]/)[0])).size;
  console.log(
    `\n${findings.length} finding(s) in ${fileCount} file(s). Allowed: ${[...ALLOWED_PREFIXES, ...ALLOWED_FILES].join(", ")}`,
  );
  process.exit(1);
}
