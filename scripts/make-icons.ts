/**
 * Draws the app icons: a vinyl record in the design system's own colours (dark sand background, forest-green label), as PNG files and a
 * favicon.ico. No dependencies: a tiny rasteriser with 4x supersampling and a hand-written PNG encoder (zlib from Node).
 *
 *   npx tsx scripts/make-icons.ts
 *
 * Output (committed): public/icons/icon-192.png, icon-512.png, icon-maskable-512.png, src/app/apple-icon.png, src/app/favicon.ico.
 * The colours are public/ds/tokens.css (--sand-950, --sand-800, --forest-300); change them there first.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BG = [0x12, 0x16, 0x11]; // --sand-950
const VINYL = [0x2e, 0x32, 0x28]; // --sand-800
const GROOVE = [0x1c, 0x22, 0x1a]; // --sand-900
const LABEL = [0x8f, 0xb0, 0x8a]; // --forest-300

type Rgb = number[];

/** Colour at (x, y) in a unit square, for a record that fills `scale` of it. */
function sample(x: number, y: number, scale: number, rounded: boolean): [Rgb, number] {
  const cx = x - 0.5;
  const cy = y - 0.5;
  if (rounded) {
    // a rounded-square plate behind the record (the "any" icons); the maskable icon is full-bleed instead
    const r = 0.18;
    const ax = Math.max(Math.abs(cx) - (0.5 - r), 0);
    const ay = Math.max(Math.abs(cy) - (0.5 - r), 0);
    if (Math.hypot(ax, ay) > r) return [BG, 0];
  }
  const d = Math.hypot(cx, cy) / (0.5 * scale);
  if (d > 1) return [BG, 1];
  if (d < 0.07) return [BG, 1]; // spindle hole
  if (d < 0.38) return [LABEL, 1];
  // grooves: thin darker rings
  const ring = (d - 0.42) * 22;
  if (d > 0.42 && d < 0.96 && Math.abs(ring - Math.round(ring)) < 0.12) return [GROOVE, 1];
  return [VINYL, 1];
}

function render(size: number, scale: number, rounded: boolean): Buffer {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [c, alpha] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, scale, rounded);
          r += c[0] * alpha; g += c[1] * alpha; b += c[2] * alpha; a += alpha;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      // alpha: the plate's rounded corners are transparent (alpha counts samples inside the shape)
      const inside = a > 0 ? a / n : 0;
      raw[o] = a > 0 ? Math.round(r / a) : 0;
      raw[o + 1] = a > 0 ? Math.round(g / a) : 0;
      raw[o + 2] = a > 0 ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round(255 * Math.min(1, inside));
    }
  }
  return png(size, raw);
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf: Buffer) => {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** An .ico that carries one PNG image (every current browser reads it). */
function ico(image: Buffer, size: number): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = size >= 256 ? 0 : size;
  head[7] = size >= 256 ? 0 : size;
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(image.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, image]);
}

const root = path.resolve(__dirname, "..");
mkdirSync(path.join(root, "public/icons"), { recursive: true });
const out = (file: string, data: Buffer) => {
  writeFileSync(path.join(root, file), data);
  console.log(`wrote ${file} (${data.length} bytes)`);
};
out("public/icons/icon-192.png", render(192, 0.86, true));
out("public/icons/icon-512.png", render(512, 0.86, true));
// maskable: full-bleed background, the record inside the central safe zone (80%)
out("public/icons/icon-maskable-512.png", render(512, 0.66, false));
out("src/app/apple-icon.png", render(180, 0.7, false)); // iOS rounds the corners itself
out("src/app/favicon.ico", ico(render(48, 0.92, true), 48));
