import type { CaptionDef } from '../tour/schema.ts';
import { FONT } from './fonts.ts';

/**
 * Caption cards (S5 film): CPU-rasterised canvas-2D cards (an OffscreenCanvas with `willReadFrequently`,
 * so Chrome draws it in software: the same bytes in every process), sized as fractions of the frame height
 * (resolution independent), a soft dark shadow baked in, uploaded as a premultiplied, uncoloured
 * (NoColorSpace — the overlay composites in display space) CanvasTexture by the TitleSystem.
 *
 * Style (the README banner): Cinzel caps with generous tracking + Cormorant Garamond italic, ivory-gold on a
 * soft shadow, a fine hairline rule with a small diamond for the title and end cards — no boxes or plates.
 * A card is a pure function of (caption, frame size, alignment): however a frame is reached, its card is
 * the same.
 */

/** ivory-gold of the names, the paler ivory of the subtitles, the credits' muted parchment */
const IVORY = '#ebd9a8';
const IVORY_SUB = '#e6dcc2';
const PARCHMENT = '#d8ccaf';
/**
 * baked shadows: blur and offset in fractions of H, `spread` in em. The broad ones are cast by the glyphs
 * dilated by a round-joined stroke (a blurred hairline casts almost nothing), so they form a soft darkening
 * that follows the words — the text reads on bright canopy, grass and sky, never on a plate; the tight one
 * crisps the edges. Drawn shadow-only (the glyphs themselves once, on top).
 */
const SHADOWS: { color: string; blur: number; spread: number; dy: number }[] = [
  { color: 'rgba(8,6,3,0.42)', blur: 0.02, spread: 0.12, dy: 0.0015 },
  { color: 'rgba(8,6,3,0.4)', blur: 0.008, spread: 0.05, dy: 0.001 },
  { color: 'rgba(0,0,0,0.5)', blur: 0.0028, spread: 0, dy: 0.0009 },
];
/**
 * the floating labels' scrim: a very soft elliptical darkening behind the text block (SCRIM_SIZE × the
 * block, Gaussian falloff, peak SCRIM_ALPHA) — invisible on dark ground, it keeps the ivory legible on
 * bright canopy and sunlit grass without a plate
 */
const SCRIM_ALPHA = 0.24;
const SCRIM_SIZE = 1.3;

/** Type sizes (em, fractions of H), tracking (em), weights. */
export const TYPE = {
  /** title: Cinzel, cap height target (fit to TITLE_MAX_W of the width), tracking */
  titleCap: 0.055,
  titleTrack: 0.09,
  titleWeight: 430,
  titleMaxW: 0.62,
  titleSub: 0.04,
  /** place label: name / subtitle */
  placeName: 0.045,
  placeSub: 0.03,
  placeTrack: 0.12,
  nameWeight: 500,
  /** pass label */
  passName: 0.034,
  /** end line (italic), credits title, credit lines */
  endLine: 0.04,
  creditsTitle: 0.04,
  creditLine: 0.02,
  creditLead: 1.75,
  creditsMaxW: 0.8,
} as const;

export type CardAlign = 'left' | 'right' | 'center';

export interface Card {
  key: string;
  canvas: OffscreenCanvas;
  /** canvas size, px */
  width: number;
  height: number;
  /**
   * the text block inside the canvas (px): x, y = its top-left (y = the first line's cap top), w, h. Layout
   * places the block; the shadow padding around it is free.
   */
  block: { x: number; y: number; w: number; h: number };
}

interface LineSpec {
  text: string;
  family: string;
  weight: number;
  italic?: boolean;
  /** font size, px */
  size: number;
  /** tracking, em */
  track: number;
  color: string;
}

interface Placed {
  spec: LineSpec;
  /** ink extents relative to the drawing x (textAlign left): [−left, right], ascent / descent from the baseline */
  inkL: number;
  inkR: number;
  baseline: number;
}

type Ctx = OffscreenCanvasRenderingContext2D;

let scratch: Ctx | null = null;
function scratchCtx(): Ctx {
  if (!scratch) {
    const c = new OffscreenCanvas(8, 8).getContext('2d', { willReadFrequently: true });
    if (!c) throw new Error('titles: no 2D context');
    scratch = c;
  }
  return scratch;
}

/** Typographic quotes: ' and " become ’ ‘ “ ” (an apostrophe inside a word is always ’). */
export function typeset(text: string): string {
  return text
    .replace(/(\p{L})'(\p{L})/gu, '$1’$2')
    .replace(/(^|[\s(\[])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s(\[])"/g, '$1“')
    .replace(/"/g, '”');
}

const fontOf = (s: LineSpec, size = s.size) => `${s.italic ? 'italic ' : ''}${s.weight} ${size.toFixed(3)}px "${s.family}"`;

function setFont(ctx: Ctx, s: LineSpec): void {
  ctx.font = fontOf(s);
  ctx.letterSpacing = `${(s.track * s.size).toFixed(3)}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function ink(ctx: Ctx, s: LineSpec): { l: number; r: number; asc: number; desc: number } {
  setFont(ctx, s);
  const m = ctx.measureText(s.text);
  return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}

/** cap height / em of a face (measured on 'H') */
function capRatio(ctx: Ctx, family: string, weight: number): number {
  const s: LineSpec = { text: 'H', family, weight, size: 100, track: 0, color: '#000' };
  return ink(ctx, s).asc / 100;
}

/** a face's descender / em (measured on 'gjpqy') — line spacing that does not depend on the words */
function descRatio(ctx: Ctx, family: string, weight: number, italic = false): number {
  const s: LineSpec = { text: 'gjpqy', family, weight, italic, size: 100, track: 0, color: '#000' };
  return ink(ctx, s).desc / 100;
}

/**
 * Fail loudly if a family is not used by the canvas (a fallback face would render — and silently differ
 * between frames if the real one arrived later).
 */
export function assertCanvasFonts(): void {
  const ctx = scratchCtx();
  const probe = 'Journey Through Middle-Earth 1234';
  ctx.letterSpacing = '0px';
  for (const [family, italic] of [
    [FONT.display, false],
    [FONT.serif, true],
    [FONT.serif, false],
    [FONT.text, false],
  ] as const) {
    ctx.font = `${italic ? 'italic ' : ''}40px monospace`;
    const fallback = ctx.measureText(probe).width;
    ctx.font = `${italic ? 'italic ' : ''}40px "${family}", monospace`;
    const real = ctx.measureText(probe).width;
    if (Math.abs(real - fallback) < 0.5) throw new Error(`titles: the canvas does not use the font '${family}'${italic ? ' italic' : ''} (not loaded?)`);
  }
}

/** Wrap a credit line at its ' · ' separators to maxW px (greedy). */
function wrapDots(ctx: Ctx, base: Omit<LineSpec, 'text'>, text: string, maxW: number): string[] {
  const parts = text.split(' · ');
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    const next = cur ? `${cur} · ${p}` : p;
    const w = ink(ctx, { ...base, text: next });
    if (cur && w.l + w.r > maxW) {
      out.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

interface Rule {
  /** y of the rule's centre line, relative to the block top */
  y: number;
  /** half-length, px */
  half: number;
  /** diamond half-diagonal (0 = plain rule) */
  diamond: number;
}

/** The lines (and rule) of a card, stacked from the block top (the first line's cap top). */
function compose(ctx: Ctx, def0: CaptionDef, W: number, H: number): { lines: Placed[]; rules: Rule[]; height: number } {
  const def: CaptionDef = { ...def0, title: def0.title && typeset(def0.title), sub: def0.sub && typeset(def0.sub), lines: def0.lines?.map(typeset) };
  const lines: Placed[] = [];
  const rules: Rule[] = [];
  let y = 0;
  const push = (spec: LineSpec, capTop: number) => {
    const m = ink(ctx, spec);
    const cap = capRatio(ctx, spec.family, spec.weight) * spec.size;
    const baseline = capTop + cap;
    lines.push({ spec, inkL: m.l, inkR: m.r, baseline });
    return { baseline, desc: descRatio(ctx, spec.family, spec.weight, spec.italic) * spec.size };
  };
  const ruleAt = (half: number, gapAbove: number, gapBelow: number, diamond: number) => {
    y += gapAbove;
    rules.push({ y, half, diamond });
    y += gapBelow;
  };
  switch (def.kind) {
    case 'title': {
      const capR = capRatio(ctx, FONT.display, TYPE.titleWeight);
      let size = (TYPE.titleCap * H) / capR;
      const spec: LineSpec = { text: def.title ?? '', family: FONT.display, weight: TYPE.titleWeight, size, track: TYPE.titleTrack, color: IVORY };
      const w = ink(ctx, spec);
      if (w.l + w.r > TYPE.titleMaxW * W) size *= (TYPE.titleMaxW * W) / (w.l + w.r);
      spec.size = size;
      const t = push(spec, y);
      y = t.baseline;
      if (def.sub) {
        ruleAt(H * 0.075, H * 0.034, H * 0.03, H * 0.0055);
        const sub: LineSpec = { text: def.sub, family: FONT.serif, weight: 500, italic: true, size: TYPE.titleSub * H, track: 0.015, color: IVORY_SUB };
        const s = push(sub, y);
        y = s.baseline + s.desc;
      } else y += t.desc;
      break;
    }
    case 'place':
    case 'pass': {
      const name: LineSpec = { text: def.title ?? '', family: FONT.display, weight: TYPE.nameWeight, size: (def.kind === 'place' ? TYPE.placeName : TYPE.passName) * H, track: TYPE.placeTrack, color: IVORY };
      const n = push(name, y);
      y = n.baseline;
      if (def.sub) {
        const sub: LineSpec = { text: def.sub, family: FONT.serif, weight: 500, italic: true, size: TYPE.placeSub * H, track: 0.012, color: IVORY_SUB };
        const s = push(sub, y + H * 0.013);
        y = s.baseline + s.desc;
      } else y += n.desc * 0.4;
      break;
    }
    case 'end': {
      if (def.lines?.length) {
        const t = push({ text: def.title ?? '', family: FONT.display, weight: TYPE.titleWeight, size: TYPE.creditsTitle * H, track: TYPE.titleTrack, color: IVORY }, y);
        y = t.baseline;
        ruleAt(H * 0.06, H * 0.03, H * 0.028, H * 0.0045);
        const base = { family: FONT.text, weight: 400, size: TYPE.creditLine * H, track: 0.02, color: PARCHMENT };
        const lead = TYPE.creditLine * H * TYPE.creditLead;
        const capC = capRatio(ctx, FONT.text, 400) * base.size;
        let first = true;
        for (const raw of def.lines) {
          for (const text of wrapDots(ctx, base, raw, TYPE.creditsMaxW * W)) {
            const top = first ? y : y + lead - capC;
            const l = push({ ...base, text }, top);
            y = l.baseline;
            first = false;
          }
        }
        y += descRatio(ctx, FONT.text, 400) * base.size;
      } else {
        const l = push({ text: def.title ?? '', family: FONT.serif, weight: 500, italic: true, size: TYPE.endLine * H, track: 0.012, color: IVORY }, y);
        y = l.baseline + l.desc;
      }
      break;
    }
    case 'fade':
      break;
  }
  return { lines, rules, height: y };
}

const RULE_ALPHA = 0.8;

/** Draw a line's shadows only (the glyphs off-canvas, their shadows offset back in), never the glyphs. */
function shadowText(ctx: Ctx, p: Placed, x: number, y: number, H: number, off: number): void {
  setFont(ctx, p.spec);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineJoin = 'round';
  for (const s of SHADOWS) {
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.blur * H;
    ctx.shadowOffsetX = off;
    ctx.shadowOffsetY = s.dy * H;
    if (s.spread > 0) {
      ctx.lineWidth = 2 * s.spread * p.spec.size;
      ctx.strokeText(p.spec.text, x - off, y);
    } else ctx.fillText(p.spec.text, x - off, y);
  }
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** A hairline rule (centred at cx), optionally broken by a small diamond. */
function rulePath(ctx: Ctx, cx: number, y: number, r: Rule, t: number): void {
  const gap = r.diamond > 0 ? r.diamond * 2.6 : 0;
  ctx.beginPath();
  ctx.rect(cx - r.half, y - t / 2, r.half - gap, t);
  ctx.rect(cx + gap, y - t / 2, r.half - gap, t);
  if (r.diamond > 0) {
    ctx.moveTo(cx, y - r.diamond);
    ctx.lineTo(cx + r.diamond, y);
    ctx.lineTo(cx, y + r.diamond);
    ctx.lineTo(cx - r.diamond, y);
    ctx.closePath();
  }
}

/** The text block size (px) of a caption's card for a W × H frame — layout without rasterising. */
export function cardBlock(def: CaptionDef, W: number, H: number): { w: number; h: number } {
  const { lines, rules, height } = compose(scratchCtx(), def, W, H);
  return { w: Math.max(1, ...lines.map((l) => l.inkL + l.inkR), ...rules.map((r) => r.half * 2)), h: Math.max(1, height) };
}

/** Rasterise a caption's card for a W × H frame (`align`: the text's alignment against the block edges). */
export function rasterCard(def: CaptionDef, W: number, H: number, align: CardAlign): Card {
  const key = `${def.id}|${W}x${H}|${align}`;
  const ctx0 = scratchCtx();
  const { lines, rules, height } = compose(ctx0, def, W, H);
  const blockW = Math.max(1, ...lines.map((l) => l.inkL + l.inkR), ...rules.map((r) => r.half * 2));
  const blockH = Math.max(1, height);
  const maxSize = Math.max(1, ...lines.map((l) => l.spec.size));
  const scrim = def.kind === 'place' || def.kind === 'pass';
  const shadowPad = Math.max(...SHADOWS.map((s) => (s.blur * 2.2 + s.dy) * H + s.spread * maxSize));
  // the scrim's Gaussian reaches ≈ 2.2σ beyond the block's half-size (σ = (SCRIM_SIZE − 1)/2 · size + 0.02 H)
  const scrimPad = scrim ? Math.max(blockW, blockH) * 0.5 * (SCRIM_SIZE - 1) + 0.06 * H : 0;
  const pad = Math.ceil(Math.max(shadowPad, scrimPad) + 3);
  const cw = Math.ceil(blockW + pad * 2);
  const ch = Math.ceil(blockH + pad * 2);
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('titles: no 2D context');
  const bx = pad;
  const by = pad;
  // x of a line's drawing origin for its ink to sit at the block's left / right edge or centre
  const xOf = (l: Placed) => {
    const w = l.inkL + l.inkR;
    const left = align === 'left' ? 0 : align === 'right' ? blockW - w : (blockW - w) / 2;
    return bx + left + l.inkL;
  };
  const off = cw + 64;
  const t = Math.max(1, H * 0.0011);
  if (scrim) {
    // soft elliptical darkening centred on the block (a unit-circle radial gradient, scaled to an ellipse)
    const rx = (blockW * SCRIM_SIZE) / 2 + 0.02 * H;
    const ry = (blockH * SCRIM_SIZE) / 2 + 0.02 * H;
    ctx.save();
    ctx.translate(bx + blockW / 2, by + blockH / 2);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.6);
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      // Gaussian in the ellipse's radius (σ ≈ 0.62 of the half-size), to 0 at 1.6
      const a = SCRIM_ALPHA * Math.exp(-0.5 * ((u * 1.6) / 0.62) ** 2) * (1 - u ** 4);
      g.addColorStop(u, `rgba(6,5,3,${a.toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
    ctx.restore();
  }
  // shadows (all lines and rules) under every glyph
  for (const l of lines) shadowText(ctx, l, xOf(l), by + l.baseline, H, off);
  for (const r of rules) {
    ctx.save();
    ctx.translate(-off, 0);
    ctx.fillStyle = '#000';
    for (const s of SHADOWS) {
      ctx.shadowColor = s.color;
      ctx.shadowBlur = s.blur * H * 0.6;
      ctx.shadowOffsetX = off;
      ctx.shadowOffsetY = s.dy * H;
      rulePath(ctx, bx + blockW / 2, by + r.y, r, t);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  for (const l of lines) {
    setFont(ctx, l.spec);
    ctx.fillStyle = l.spec.color;
    ctx.fillText(l.spec.text, xOf(l), by + l.baseline);
  }
  for (const r of rules) {
    ctx.globalAlpha = RULE_ALPHA;
    ctx.fillStyle = IVORY;
    rulePath(ctx, bx + blockW / 2, by + r.y, r, t);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  return { key, canvas, width: cw, height: ch, block: { x: bx, y: by, w: blockW, h: blockH } };
}
