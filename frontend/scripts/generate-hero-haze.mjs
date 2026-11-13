// Generates the hero background texture: a fractal haze (domain-warped fractional Brownian motion),
// dithered with an ordered Bayer matrix to three tones, and written as an indexed PNG.
//
//   bun run generate:haze
//
// Design intent: a static, monochrome, dithered
// texture. It reads as printed material, not as a neon glow, it needs no JavaScript or WebGL at runtime,
// and its brightest tone is dark enough to keep the headline above 4.5:1 contrast. The edges fade to
// transparent inside the image, so the page needs no CSS gradient or mask to blend it.
//
// The output is deterministic: the same SEED always produces the same file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// Each variant is a deterministic image. `hero` is the landing page and must stay byte-identical.
// The page variants are short, wide strips for the header of an inner page: a lower `strength`
// does not dim them (that would only push every pixel to the near-black tone; the page dims them
// with CSS opacity instead), and `noise` keeps the folds as tall as they are wide (the hero maps 640
// cells to 2.3 noise units across and 360 cells to 1.3 down, so a strip that is shorter maps fewer).
//
//   bun run generate:haze              the hero
//   bun run generate:haze page-fleet   the fleet page header (one run per variant)
//
// Every page strip has its own seed, so the pages share a look but not a picture.
const strip = (seed, file) => ({
  seed,
  cellsX: 640,
  cellsY: 200,
  noise: [1.8, 0.56],
  strength: 1.5,
  fade: [0.7, 1.7],
  file,
});

const VARIANTS = {
  hero: {
    seed: 20261111,
    cellsX: 640, // logical dither grid
    cellsY: 360,
    noise: [2.3, 1.3],
    strength: 1,
    fade: [0.8, 1.5],
    file: "hero-haze.png",
  },
  "page-fleet": strip(20261113, "page-haze-fleet.png"),
  // The seeds below were picked, not drawn at random: the strips have roughly the fleet strip's
  // coverage of the three tones, and their brightest folds sit in different places.
  "page-machines": strip(20261238, "page-haze-machines.png"),
  "page-passport": strip(20261254, "page-haze-passport.png"),
  "page-stake": strip(20261245, "page-haze-stake.png"),
  "page-burn": strip(20261220, "page-haze-burn.png"),
  "page-pilot": strip(20261239, "page-haze-pilot.png"),
  "page-map": strip(20261253, "page-haze-map.png"),
  "page-docs": strip(20261200, "page-haze-docs.png"),
  // A dithered horizon that rises from the bottom edge, for the anchor behind the footer.
  "band-bottom": {
    kind: "band",
    seed: 20261301,
    cellsX: 640,
    cellsY: 120,
    noise: [3, 1.1],
    strength: 1.3,
    fade: [0, 0],
    file: "band-bottom.png",
  },
};

const variantName = process.argv[2] ?? "hero";
const variant = VARIANTS[variantName];
if (!variant) {
  console.error(
    `Unknown variant "${variantName}". Use one of: ${Object.keys(VARIANTS).join(", ")}.`,
  );
  process.exit(1);
}

// Optional, for trying a seed without editing this file:
//   bun run generate:haze page-fleet --seed=123 --out=C:/tmp/try.png
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const seedFlag = flag("seed");
const outFlag = flag("out");

const SEED = seedFlag ? Number(seedFlag) : variant.seed;
const CELLS_X = variant.cellsX;
const CELLS_Y = variant.cellsY;
const CELL = 2; // each logical cell is CELL x CELL pixels
const WIDTH = CELLS_X * CELL;
const HEIGHT = CELLS_Y * CELL;

// Index 0 is transparent so the page background and its grid show through. The three solid tones
// step up to an oxblood slightly darker than the brand #6d001a.
const PALETTE = [
  { rgb: [0, 0, 0], alpha: 0 },
  { rgb: [26, 3, 9], alpha: 255 },
  { rgb: [52, 6, 18], alpha: 255 },
  { rgb: [94, 0, 22], alpha: 255 },
];
const TONES = PALETTE.length - 1;

const OUT = outFlag
  ? resolve(outFlag)
  : resolve(dirname(fileURLToPath(import.meta.url)), "../public/textures", variant.file);

// ---------- noise ----------

function hash(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(SEED, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x, y) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let octave = 0; octave < 6; octave += 1) {
    sum += amp * valueNoise(x * freq + octave * 17.3, y * freq - octave * 9.1);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum; // 0..~0.98
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Domain warping gives the haze its folded, smoky structure.
function haze(px, py) {
  const qx = fbm(px, py);
  const qy = fbm(px + 5.2, py + 1.3);
  const rx = fbm(px + 2.6 * qx + 1.7, py + 2.6 * qy + 9.2);
  const ry = fbm(px + 2.6 * qx + 8.3, py + 2.6 * qy + 2.8);
  return fbm(px + 2.6 * rx, py + 2.6 * ry);
}

// ---------- dither ----------

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const levels = new Uint8Array(CELLS_X * CELLS_Y);
const counts = PALETTE.map(() => 0);
for (let y = 0; y < CELLS_Y; y += 1) {
  for (let x = 0; x < CELLS_X; x += 1) {
    const u = x / CELLS_X;
    const v = y / CELLS_Y;
    let intensity;
    if (variant.kind === "band") {
      // A horizon: strongest along the bottom edge (v = 1) and gone toward the top. Low-frequency
      // noise makes the edge wander instead of running straight.
      const wobble = 0.55 + 0.45 * fbm(u * variant.noise[0], v * variant.noise[1]);
      intensity = Math.min(1, v ** 2.2 * wobble * variant.strength);
    } else {
      const f = haze(u * variant.noise[0], v * variant.noise[1]);
      intensity = smoothstep(0.33, 0.9, f) ** 1.35;
      // Fade to nothing toward the edges (an ellipse, wider than tall) so the image blends into the page.
      const nx = (u - 0.5) * 2;
      const ny = (v - 0.5) * 2;
      const distance = Math.sqrt(nx * nx * variant.fade[0] + ny * ny * variant.fade[1]);
      intensity *= (1 - smoothstep(0.42, 1.0, distance)) * variant.strength;
    }
    const target = intensity * TONES;
    const base = Math.floor(target);
    const threshold = (BAYER[y % 4][x % 4] + 0.5) / 16;
    const level = Math.min(TONES, base + (target - base > threshold ? 1 : 0));
    levels[y * CELLS_X + x] = level;
    counts[level] += 1;
  }
}

// ---------- PNG (indexed, 2 bits per pixel) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 2; // bit depth (4 palette entries fit in 2 bits)
header[9] = 3; // colour type: indexed
header[10] = 0;
header[11] = 0;
header[12] = 0;

const rowBytes = Math.ceil((WIDTH * 2) / 8);
const raw = Buffer.alloc((rowBytes + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const cellRow = Math.floor(y / CELL) * CELLS_X;
  const offset = y * (rowBytes + 1);
  raw[offset] = 0; // filter: none
  for (let x = 0; x < WIDTH; x += 1) {
    const level = levels[cellRow + Math.floor(x / CELL)];
    raw[offset + 1 + (x >> 2)] |= level << (6 - (x & 3) * 2);
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("PLTE", Buffer.from(PALETTE.flatMap((p) => p.rgb))),
  chunk("tRNS", Buffer.from(PALETTE.map((p) => p.alpha))),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);

// ---------- report ----------

const total = CELLS_X * CELLS_Y;
const luminance = ([r, g, b]) => {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const headline = luminance([236, 231, 233]);
const brightest = luminance(PALETTE[TONES].rgb);

console.log(
  JSON.stringify(
    {
      file: OUT,
      size: `${WIDTH}x${HEIGHT}`,
      bytes: png.length,
      kilobytes: Number((png.length / 1024).toFixed(1)),
      coverage: Object.fromEntries(
        counts.map((n, i) => [
          i === 0 ? "transparent" : `tone${i}`,
          Number((n / total).toFixed(3)),
        ]),
      ),
      headlineContrastOnBrightestTone: Number(contrast(headline, brightest).toFixed(2)),
    },
    null,
    2,
  ),
);
