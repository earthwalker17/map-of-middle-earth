/**
 * Image composition helpers shared by the CPU still tools (sharp): `review.ts` (review folders) and
 * `showcase.ts` (README images). Importable — no top-level work besides importing sharp.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp, { type Sharp } from 'sharp';

/** XML-escape a string for SVG text. */
export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** a label bar over the top-left of an image buffer (resized to w × h — callers keep the aspect) */
export async function labelled(input: string | Buffer, w: number, h: number, text: string): Promise<Buffer> {
  const img = await sharp(input).resize(w, h, { fit: 'fill' }).toBuffer();
  const fs = Math.max(14, Math.round(h * 0.03));
  const bw = Math.round(fs * 0.62 * text.length + fs * 1.4);
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${Math.min(w, bw)}" height="${Math.round(fs * 1.9)}" fill="rgba(0,0,0,0.55)"/>` +
      `<text x="${Math.round(fs * 0.7)}" y="${Math.round(fs * 1.35)}" font-family="Georgia" font-size="${fs}" fill="#eee4cf">${esc(text)}</text></svg>`,
  );
  return sharp(img).composite([{ input: svg }]).png().toBuffer();
}

export interface SideBySideOpts {
  /** gap between the parts in px (default max(4, round(0.8 % of h))) */
  gap?: number;
  /** gap / background colour (default #101214) */
  background?: string;
}

/**
 * Parts side by side with a gap, every part already at the same height `h` (each with its own width), as
 * an un-encoded sharp pipeline (encode it with .png() / .jpeg()).
 */
export function sideBySideImage(parts: { img: Buffer; w: number }[], h: number, o: SideBySideOpts = {}): Sharp {
  const gap = o.gap ?? Math.max(4, Math.round(h * 0.008));
  let x = 0;
  const placed = parts.map((p) => {
    const at = { input: p.img, left: x, top: 0 };
    x += p.w + gap;
    return at;
  });
  return sharp({ create: { width: x - gap, height: h, channels: 3, background: o.background ?? '#101214' } }).composite(placed);
}

/** side by side with a gap, every part already at the same height `h` (each with its own width), as a PNG file */
export async function sideBySide(parts: { img: Buffer; w: number }[], h: number, file: string, o: SideBySideOpts = {}): Promise<void> {
  await sideBySideImage(parts, h, o).png({ compressionLevel: 6 }).toFile(file);
}

/**
 * A contact-sheet grid: equally sized tiles (already w × h, e.g. from `labelled`) in rows of `cols`, as an
 * un-encoded sharp pipeline (S5 film stills / storyboards).
 */
export function grid(tiles: Buffer[], w: number, h: number, cols: number, o: SideBySideOpts = {}): Sharp {
  const gap = o.gap ?? Math.max(4, Math.round(h * 0.02));
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const c = Math.min(cols, Math.max(1, tiles.length));
  return sharp({ create: { width: c * w + (c - 1) * gap, height: rows * h + (rows - 1) * gap, channels: 3, background: o.background ?? '#101214' } }).composite(
    tiles.map((input, i) => ({ input, left: (i % cols) * (w + gap), top: Math.floor(i / cols) * (h + gap) })),
  );
}

/** pixel size of an image file or buffer */
export async function size(file: string | Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(file).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0 };
}

/** sha256 (hex) of a file's bytes */
export const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** sha256 (hex) of a buffer */
export const shaBuf = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
