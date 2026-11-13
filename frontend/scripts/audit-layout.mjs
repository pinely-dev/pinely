// Layout audit: finds grid children that overflow their grid or overlap each other.
//
//   BASE_URL=http://localhost:3000 bun run audit:layout
//
// It exists because the other automated checks (horizontal overflow, clipped text, tap targets) did
// not notice that the Field Scenarios grid was broken: its cards sat in implicit zero-width columns,
// stuck out past the content edge and left gaps between each other. This check looks at where every
// grid child actually is.
//
// Environment: BASE_URL (default http://localhost:3000), CHROME_PATH (default: common install paths),
// ONLY_ROUTES and ONLY_WIDTHS (comma separated), SELFTEST=bento (proves the check catches the old broken grid).
// Exit code: 0 when no issue is found, 1 otherwise.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PORT = 9399;
const ALL_ROUTES = [
  "/",
  "/machines",
  "/fleet",
  "/map",
  "/passport",
  "/stake",
  "/burn",
  "/pilot",
  "/docs",
  "/legal",
  "/page-does-not-exist",
];
// ONLY_ROUTES=/,/stake limits the run (useful while fixing one page).
const ROUTES = process.env.ONLY_ROUTES ? process.env.ONLY_ROUTES.split(",") : ALL_ROUTES;
const ALL_WIDTHS = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "768", width: 768, height: 1000, mobile: false },
  { name: "375", width: 375, height: 800, mobile: true },
];
// ONLY_WIDTHS=1440,375 limits the widths; a full run can take several minutes against a dev server.
const WIDTHS = process.env.ONLY_WIDTHS
  ? ALL_WIDTHS.filter((w) => process.env.ONLY_WIDTHS.split(",").includes(w.name))
  : ALL_WIDTHS;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error("Chrome was not found. Set CHROME_PATH.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs in the page. Returns one entry per problem. */
const CHECK = `(() => {
  const issues = [];
  const describe = (el) => {
    const parts = [];
    for (let e = el; e && e.tagName !== "BODY" && parts.length < 3; e = e.parentElement) {
      parts.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : ""));
    }
    return parts.join(" > ");
  };
  const inFlow = (el) => {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return c.display !== "none" && c.visibility !== "hidden" && c.position !== "absolute" && c.position !== "fixed" && r.width > 2 && r.height > 2;
  };
  for (const parent of document.querySelectorAll("*")) {
    const pc = getComputedStyle(parent);
    if (pc.display !== "grid" && pc.display !== "inline-grid") continue;
    // A grid that scrolls or clips its own content may legitimately hold wider children.
    if (/(auto|scroll|hidden|clip)/.test(pc.overflowX)) continue;
    const kids = [...parent.children].filter(inFlow);
    const pb = parent.getBoundingClientRect();
    for (const kid of kids) {
      const b = kid.getBoundingClientRect();
      if (b.left < pb.left - 2 || b.right > pb.right + 2) {
        issues.push({ type: "outside-grid", where: describe(kid), left: Math.round(b.left), right: Math.round(b.right), gridLeft: Math.round(pb.left), gridRight: Math.round(pb.right) });
      }
    }
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 4 && h > 4) issues.push({ type: "overlap", where: describe(kids[i]) + "  x  " + describe(kids[j]), overlap: Math.round(w) + "x" + Math.round(h) });
      }
    }
  }
  return JSON.stringify(issues);
})()`;

const userDir = mkdtempSync(join(tmpdir(), "audit-layout-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    `--user-data-dir=${userDir}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let targets;
for (let i = 0; i < 50; i += 1) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    if (targets.length) break;
  } catch {
    // Chrome is still starting.
  }
  await sleep(300);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let nextId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) pending.get(data.id)(data.result);
};
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression })).result
    .value;

await send("Page.enable");
await send("Runtime.enable");

/** Scrolls through the page so every reveal animation has run, then waits for it to settle. */
async function revealAll(height) {
  const total = await evaluate("document.documentElement.scrollHeight");
  for (let y = 0; y < total + height; y += Math.round(height * 0.6)) {
    await evaluate(`window.scrollTo({ top: ${y}, behavior: "instant" })`);
    await sleep(250);
  }
  await evaluate('window.scrollTo({ top: 0, behavior: "instant" })');
  await sleep(1500);
}

const results = [];
for (const viewport of WIDTHS) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  for (const route of ROUTES) {
    await send("Page.navigate", { url: BASE + route });
    await sleep(route === "/" ? 9000 : 5000);
    await revealAll(viewport.height);
    // SELFTEST=bento puts the Field Scenarios wrappers back into the old broken state (grid-column
    // set to a line number, which is what Tailwind's col-N did). The audit must then report issues.
    if (process.env.SELFTEST === "bento") {
      await evaluate(
        `document.querySelectorAll(".bento-card-wrapper").forEach((w, i) => { w.style.gridColumn = ["7", "5", "12"][i] ?? "auto"; })`,
      );
      await sleep(300);
    }
    const issues = JSON.parse(await evaluate(CHECK));
    results.push({ viewport: viewport.name, route, issues });
  }
}

ws.close();
chrome.kill();

let total = 0;
for (const { viewport, route, issues } of results) {
  total += issues.length;
  if (issues.length) {
    console.log(`\n${viewport}px ${route}: ${issues.length} issue(s)`);
    for (const issue of issues.slice(0, 8)) console.log("  ", JSON.stringify(issue));
  }
}
console.log(
  `\nLayout audit: ${results.length} measurements (${ROUTES.length} routes x ${WIDTHS.length} widths), ${total} issue(s).`,
);
process.exit(total === 0 ? 0 : 1);
