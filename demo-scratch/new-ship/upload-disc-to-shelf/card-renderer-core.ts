// SpotlightCard renderer for Disc Studio MVP.
// Each disc in the bag gets an individual card: full-frame transparent PNG
// with the card baked at the bottom-left corner (CapCut overlay track).
// Visual hierarchy: PHOTO > MOLDNAME >> NUMBERS >>> everything else.

import type { Disc } from './model.ts';

export type CardRenderEnvironment = {
  loadImage: (source: string) => Promise<any>;
  getMoldDetails?: (id: string) => Promise<any>;
  strictPhoto?: boolean;
};
export type RendererDisc = Disc & { renderer?: { moldName?: string; flights?: (number | null)[] } };

export type CardOrientation = 'horizontal' | 'vertical';

export const CARD_SIZE: Record<CardOrientation, { w: number; h: number }> = {
  horizontal: { w: 1920, h: 1080 },
  vertical: { w: 1080, h: 1920 },
};

const CARD_BG = 'rgba(14,18,22,0.94)';
const INK = '#ffffff';
const MINT = '#8fe3ae';
const FONT_STACK = '"DejaVu Sans", "Nimbus Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

type ResolvedDisc = {
  moldName: string;      // e.g. "Buzzz"
  plastic: string;
  weight: number | null;
  flights: (number | null)[] | null; // [speed, glide, turn, fade]
  photoSrc: string | null;
};

function moldIdFromAddress(address: string): string {
  const m = /^ds\.px\.seed\.([^.]+)/.exec(address);
  return m ? m[1] : address;
}

export async function resolveCardDisc(environment: CardRenderEnvironment, disc: RendererDisc): Promise<ResolvedDisc> {
  const id = moldIdFromAddress(disc.mold);
  const supplied = disc.renderer ?? {};
  let moldName = supplied.moldName ?? id;
  let flights: (number | null)[] | null = Array.isArray(supplied.flights) ? supplied.flights : null;
  try {
    const details: any = environment.getMoldDetails ? await environment.getMoldDetails(id) : null;
    if (details) {
      // A queued card holds renderer facts at enqueue time. Catalog lookup can
      // fill a missing value, never replace the held card's provenance.
      if (supplied.moldName === undefined) moldName = details.mold ?? details.name ?? moldName;
      if (!Array.isArray(supplied.flights) && Array.isArray(details.flight)) flights = details.flight;
    }
  } catch {
    // Browser exports retain their passed-in model facts when detail lookup is unavailable.
  }
  const fields = ['speed', 'glide', 'turn', 'fade'] as const;
  // An absent field inherits the mold. An explicitly retained null means the
  // player marked that value unknown; it must never silently fall back.
  if (fields.some(field => Object.hasOwn(disc, field) && disc[field] !== undefined)) {
    const base = Array.isArray(flights) ? [...flights] : [null, null, null, null];
    flights = base.map((value, index) => Object.hasOwn(disc, fields[index]) && disc[fields[index]] !== undefined ? (disc[fields[index]] ?? null) : value);
  }
  return {
    moldName,
    plastic: disc.plastic || '',
    weight: disc.weight ?? null,
    flights,
    photoSrc: disc.depiction?.kind === 'photo' ? disc.depiction.src ?? null : null,
  };
}

/** Shrink font until text fits maxWidth. Returns the font string to use. */
function fitFont(ctx: any, text: string, maxWidth: number, weight: number, startPx: number, family = FONT_STACK): string {
  let px = startPx;
  while (px > 12) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 4;
  }
  return ctx.font;
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw image cover-fit inside a circle. Falls back to a placeholder ring. */
async function drawPhotoCircle(environment: CardRenderEnvironment, ctx: any, src: string | null, cx: number, cy: number, d: number) {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  let drew = false;
  if (src) {
    try {
      const img = await environment.loadImage(src);
      // cover-fit: scale to fill, center-crop
      const scale = Math.max(d / img.width, d / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      drew = true;
    } catch (error) {
      if (environment.strictPhoto) throw new Error(`Prepared photo could not be decoded for export: ${String(error)}`);
      drew = false;
    }
  }
  if (!drew) {
    // Placeholder: dark disc with inner ring, like an unprinted disc.
    ctx.fillStyle = '#1c2a24';
    ctx.fillRect(cx - r, cy - r, d, d);
    ctx.strokeStyle = 'rgba(143,227,174,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Mint rim around the photo, echoing the deck's disc-mark ring.
  ctx.strokeStyle = 'rgba(143,227,174,0.9)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function plasticWeightLine(rd: ResolvedDisc): string {
  const parts: string[] = [];
  if (rd.plastic) parts.push(rd.plastic);
  if (rd.weight !== null && rd.weight !== undefined) parts.push(`${rd.weight}g`);
  return parts.join(' · ');
}

function flightsLine(rd: ResolvedDisc): string | null {
  if (!rd.flights || !rd.flights.some(v => v !== null && v !== undefined)) return null;
  return rd.flights.map(v => (v === null || v === undefined ? '?' : String(v))).join('   ');
}

async function drawHorizontal(environment: CardRenderEnvironment, ctx: any, rd: ResolvedDisc) {
  const M = 48;
  const cardW = 1100, cardH = 440;
  const cardX = M, cardY = 1080 - M - cardH;
  ctx.fillStyle = CARD_BG;
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fill();

  // Photo: hero, left.
  const d = 360;
  const cx = cardX + 48 + d / 2, cy = cardY + cardH / 2;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, cx, cy, d);

  // Text block: right of photo.
  const tx = cardX + 48 + d + 56;
  const maxW = cardX + cardW - 48 - tx;
  ctx.textBaseline = 'alphabetic';

  const name = rd.moldName.toUpperCase();
  ctx.fillStyle = INK;
  fitFont(ctx, name, maxW, 800, 124);
  ctx.fillText(name, tx, cardY + 196);

  const pw = plasticWeightLine(rd);
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 42px ${FONT_STACK}`;
    ctx.fillText(pw, tx, cardY + 272);
  }

  const fl = flightsLine(rd);
  if (fl) {
    ctx.fillStyle = MINT;
    ctx.font = `600 54px ${FONT_STACK}`;
    ctx.fillText(fl, tx, cardY + 356);
  }
}

async function drawVertical(environment: CardRenderEnvironment, ctx: any, rd: ResolvedDisc) {
  const M = 48;
  const cardW = 1080 - M * 2, cardH = 780;
  const cardX = M, cardY = 1920 - M - cardH;
  ctx.fillStyle = CARD_BG;
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fill();

  // Photo: hero, centered top.
  const d = 330;
  const cx = cardX + cardW / 2, cy = cardY + 56 + d / 2;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, cx, cy, d);

  // Text: centered below photo.
  ctx.textAlign = 'center';
  const midX = cardX + cardW / 2;
  const photoBottom = cardY + 56 + d;

  const name = rd.moldName.toUpperCase();
  ctx.fillStyle = INK;
  fitFont(ctx, name, cardW - 96, 800, 104);
  ctx.fillText(name, midX, photoBottom + 122);

  const pw = plasticWeightLine(rd);
  let y = photoBottom + 122;
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 40px ${FONT_STACK}`;
    ctx.fillText(pw, midX, y + 64);
    y += 64;
  }

  const fl = flightsLine(rd);
  if (fl) {
    ctx.fillStyle = MINT;
    ctx.font = `600 52px ${FONT_STACK}`;
    ctx.fillText(fl, midX, y + 78);
  }
  ctx.textAlign = 'left';
}

/* ------------------------------------------------------------------
 * UPRIGHT PRESETS (vertical-native, 9:16) — from Spotlight_Card_Visual_Research.
 * Safe areas: top 14% platform UI, bottom 25% captions/controls,
 * right 12% action rail. Key info lives in the 15-70% height guide.
 * Breakout (horizontal) presets register into the same `presetRenderers`
 * registry under b01..b05; renderCard dispatches on the preset id.
 * ------------------------------------------------------------------ */

export type CardPreset = 'u01' | 'u02' | 'u03' | 'u04' | 'u05' | 'b01' | 'b02' | 'b03' | 'b04' | 'b05';

/** Preset id -> renderer. Breakout presets (b01..b05) register here too. */
export const presetRenderers: Record<string, (ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) => Promise<void>> = {};

const VW = 1080, VH = 1920;
const Z_TOP = VH * 0.14;   // platform UI dead zone
const Z_BOT = VH * 0.75;   // caption/controls dead zone
const Z_RAIL = VW * 0.88;  // action rail starts here (right 12%)
const NIGHT92 = 'rgba(5,7,6,0.92)';
const NIGHT94 = 'rgba(5,7,6,0.94)';
const ACID = '#c8f23d';
const CORAL = '#ff5c47';
const DISPLAY = '"DejaVu Sans Condensed", "Nimbus Sans Narrow", "DejaVu Sans", sans-serif';

function flightTiles(rd: ResolvedDisc): string[] {
  if (!rd.flights) return [];
  return rd.flights.map(v => (v === null || v === undefined ? '?' : String(v)));
}

function tilesRowWidth(n: number, tile: number, gap: number): number {
  return n * tile + Math.max(0, n - 1) * gap;
}

/** Law 5: numbers are objects. Left/right/center aligned tile row. */
function drawTilesRow(
  ctx: any, nums: string[], x: number, y: number,
  tile: number, gap: number, fontPx: number,
  align: 'left' | 'right' | 'center' = 'left',
) {
  const total = tilesRowWidth(nums.length, tile, gap);
  let sx = x;
  if (align === 'right') sx = x - total;
  if (align === 'center') sx = x - total / 2;
  ctx.font = `600 ${fontPx}px ${FONT_STACK}`;
  for (let i = 0; i < nums.length; i++) {
    const bx = sx + i * (tile + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, bx, y, tile, tile, 10);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(nums[i], bx + tile / 2, y + tile * 0.72);
  }
  ctx.textAlign = 'left';
}

/** Law 4: one display voice for the name. */
function drawPresetName(
  ctx: any, text: string, x: number, y: number,
  maxW: number, startPx: number, align: 'left' | 'center' = 'left',
) {
  const name = text.toUpperCase();
  ctx.fillStyle = INK;
  fitFont(ctx, name, maxW, 800, startPx, DISPLAY);
  ctx.textAlign = align;
  ctx.fillText(name, x, y);
  ctx.textAlign = 'left';
}

/** U01 Compact Scorebug (NFL on Fox, corner card).
 * Card footprint: x 48-508, y ~410-1000. A slim dark scorebug anchors in the
 * safe left; the disc breaks out above it. Acid left rule is the one motif. */
async function renderU01(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  const cardX = 48, cardW = 460, cardY = 700, cardH = 300;

  // Hero breaks out above the card.
  const d = 380;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, 310, 600, d);

  // Scorebug block: dark protection behind type only.
  ctx.fillStyle = NIGHT92;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.fillStyle = ACID;
  ctx.fillRect(cardX, cardY, 4, cardH);

  const nameX = cardX + 28;
  drawPresetName(ctx, rd.moldName, nameX, cardY + 120, cardW - 56, 96);

  const nums = flightTiles(rd);
  const pw = plasticWeightLine(rd);
  let y = cardY + 190;
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 30px ${FONT_STACK}`;
    ctx.fillText(pw, nameX, y);
    y += 44;
  }
  drawTilesRow(ctx, nums, nameX, y, 64, 10, 38);
}
presetRenderers.u01 = renderU01;

/** U02 Stacked Poster (VALORANT Game Changers, corner card).
 * Card footprint: x 48-508, y ~480-1210. Hero owns the top of the card,
 * name band with coral top rule in the middle, stats resolve beneath it.
 * Nothing leaves the corner footprint. */
async function renderU02(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  const cardX = 48, cardW = 460;

  // Hero: top of the card, full card width.
  const d = 400;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, cardX + cardW / 2, 680, d);

  // Name band: dark, coral top rule is the one motif.
  const bandY = 830, bandH = 170;
  ctx.fillStyle = NIGHT92;
  ctx.fillRect(cardX, bandY, cardW, bandH);
  ctx.fillStyle = CORAL;
  ctx.fillRect(cardX, bandY, cardW, 4);

  const nameX = cardX + 28;
  drawPresetName(ctx, rd.moldName, nameX, bandY + 120, cardW - 56, 100);

  // Stats below the band, no box behind them.
  const nums = flightTiles(rd);
  const pw = plasticWeightLine(rd);
  let y = 1052;
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 30px ${FONT_STACK}`;
    ctx.fillText(pw, nameX, y);
    y += 44;
  }
  drawTilesRow(ctx, nums, nameX, y, 68, 12, 40);
}
presetRenderers.u02 = renderU02;

/** U03 Rail Card (Topps vertical nameplate, corner card).
 * Card footprint: x 48-610, y 520-1200. A narrow spine on the left edge of
 * the safe area holds the vertical name and stats; the disc breaks out to
 * the right, its rim crossing the acid edge. Acid edge is the one motif. */
async function renderU03(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  const spX = 48, spW = 210, spTop = 540, spBot = 1240;
  ctx.fillStyle = NIGHT94;
  ctx.fillRect(spX, spTop, spW, spBot - spTop);
  ctx.fillStyle = ACID;
  ctx.fillRect(spX + spW - 3, spTop, 3, spBot - spTop);

  const midX = spX + spW / 2;
  // Vertical name, reads bottom-to-top like a card spine.
  const name = rd.moldName.toUpperCase();
  ctx.save();
  ctx.fillStyle = INK;
  fitFont(ctx, name, (spBot - spTop) * 0.34, 800, 88, DISPLAY);
  ctx.textBaseline = 'middle';
  ctx.translate(midX, 740);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(name, 0, 0);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';

  // Stats column below the name, inside the spine.
  const nums = flightTiles(rd);
  const pw = plasticWeightLine(rd);
  const tile = 46, gap = 8;
  let y = 970;
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 26px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(pw, midX, y);
    ctx.textAlign = 'left';
    y += 40;
  }
  ctx.font = `600 30px ${FONT_STACK}`;
  for (let i = 0; i < nums.length; i++) {
    const by = y + i * (tile + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, midX - tile / 2, by, tile, tile, 9);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(nums[i], midX, by + tile * 0.72);
  }
  ctx.textAlign = 'left';

  // Hero breaks out right of the spine, rim crossing the acid edge.
  const d = 360;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, 430, 800, d);
}
presetRenderers.u03 = renderU03;

/** U04 Kinetic Name Drop (caption-practice critique, corner card).
 * Card footprint: x 48-508, y ~600-1300. The name is the motion event:
 * hard, massive, center-safe on a faded gradient scrim (Law 3 + Law 8).
 * The disc stays quieter below the stats. No boxes anywhere. */
async function renderU04(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  // Law 3 + Law 8: one soft gradient scrim behind name AND stats,
  // faded at both ends so it never reads as a box.
  const gY0 = 600, gY1 = 980;
  const g = ctx.createLinearGradient(0, gY0, 0, gY1);
  g.addColorStop(0, 'rgba(5,7,6,0)');
  g.addColorStop(0.20, 'rgba(5,7,6,0.68)');
  g.addColorStop(0.80, 'rgba(5,7,6,0.68)');
  g.addColorStop(1, 'rgba(5,7,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(48, gY0, 460, gY1 - gY0);

  const midX = 278;
  drawPresetName(ctx, rd.moldName, midX, 760, 400, 150, 'center');

  const nums = flightTiles(rd);
  const pw = plasticWeightLine(rd);
  let y = 830;
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 30px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(pw, midX, y);
    ctx.textAlign = 'left';
    y += 18;
  }
  drawTilesRow(ctx, nums, midX, y + 26, 62, 10, 36, 'center');

  // Disc stays quieter: below the stats, breaking out of the scrim.
  const d = 340;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, midX, 1130, d);
}
presetRenderers.u04 = renderU04;

/** U05 Glass Stat Drawer (Ultra LoL HUD, corner card).
 * Card footprint: x 48-508, y ~450-1120. A small dark-tinted drawer in the
 * safe left; the hero overlaps it by a third. Dark tint keeps type legible
 * on bright footage (no backdrop blur in a static PNG). Glass highlight
 * line is the one motif. */
async function renderU05(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  const d = 380;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, 278, 640, d);

  const gx = 48, gw = 460, gy = 800, gh = 320;
  ctx.fillStyle = 'rgba(10,14,12,0.62)';
  roundRect(ctx, gx, gy, gw, gh, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  roundRect(ctx, gx, gy, gw, gh, 24);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(gx + 24, gy + 3);
  ctx.lineTo(gx + gw - 24, gy + 3);
  ctx.stroke();

  const nameX = gx + 36;
  drawPresetName(ctx, rd.moldName, nameX, gy + 108, gw - 72, 92);

  const nums = flightTiles(rd);
  const pw = plasticWeightLine(rd);
  let y = gy + 200;
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 30px ${FONT_STACK}`;
    ctx.fillText(pw, nameX, y);
    y += 46;
  }
  drawTilesRow(ctx, nums, nameX, y, 64, 10, 38);
}
presetRenderers.u05 = renderU05;

/* ------------------------------------------------------------------
 * BREAKOUT PRESETS (horizontal-native, 16:9) — from
 * Spotlight_Card_Visual_Research. Hero-led overlays: the disc escapes
 * the rail while the type stays defended. Law 3 throughout: scrims are
 * gradients that fade where the text ends, never boxes.
 * ------------------------------------------------------------------ */

const HW = 1920, HH = 1080;
const NIGHT = (a: number) => `rgba(5,7,6,${a})`;

/** Hero disc: CircleFit photo with optional tilt, rim, and macro zoom (B05 coin). */
async function drawHeroDisc(environment: CardRenderEnvironment, ctx: any, src: string | null, cx: number, cy: number, d: number,
  opts: { tiltDeg?: number; rim?: string; rimWidth?: number; macro?: { zoom: number; fx: number; fy: number } } = {}) {
  const r = d / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (opts.tiltDeg) ctx.rotate((opts.tiltDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  let drew = false;
  if (src) {
    try {
      const img = await environment.loadImage(src);
      if (opts.macro) {
        // Dual-scale: zoom into a sub-rect of the same photo.
        const { zoom, fx, fy } = opts.macro;
        const s = Math.min(img.width, img.height) / zoom;
        const sx = Math.min(Math.max(fx * img.width - s / 2, 0), img.width - s);
        const sy = Math.min(Math.max(fy * img.height - s / 2, 0), img.height - s);
        ctx.drawImage(img, sx, sy, s, s, -r, -r, d, d);
      } else {
        const scale = Math.max(d / img.width, d / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
      drew = true;
    } catch (error) {
      if (environment.strictPhoto) throw new Error(`Prepared photo could not be decoded for export: ${String(error)}`);
      drew = false;
    }
  }
  if (!drew) {
    ctx.fillStyle = '#1d2b25';
    ctx.fillRect(-r, -r, d, d);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = Math.max(4, d * 0.012);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  if (opts.rim) {
    ctx.save();
    ctx.translate(cx, cy);
    if (opts.tiltDeg) ctx.rotate((opts.tiltDeg * Math.PI) / 180);
    ctx.strokeStyle = opts.rim;
    ctx.lineWidth = opts.rimWidth ?? 8;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Law 3: horizontal scrim, dark where the type sits, fading where it ends. */
function scrimH(ctx: any, x: number, y: number, w: number, h: number, flip = false) {
  const g = flip ? ctx.createLinearGradient(x + w, 0, x, 0) : ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, NIGHT(0.96));
  g.addColorStop(0.75, NIGHT(0.72));
  g.addColorStop(1, NIGHT(0));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** Law 3: vertical scrim, dark at the bottom, fading upward. */
function scrimV(ctx: any, x: number, y: number, w: number, h: number) {
  const g = ctx.createLinearGradient(0, y + h, 0, y);
  g.addColorStop(0, NIGHT(0.98));
  g.addColorStop(0.55, NIGHT(0.72));
  g.addColorStop(1, NIGHT(0));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** Quiet plastic/weight line under the name. */
function drawQuietLine(ctx: any, text: string, x: number, y: number, px = 40) {
  ctx.font = `500 ${px}px ${FONT_STACK}`;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

/** B01 Pop Color Eject (VALORANT Game Changers) — CORNER CARD.
 * Small rail in the bottom-left corner. The disc breaks out: tilted 12 deg,
 * crossing the rail's top and right edges. One loud color (acid), used once
 * as the rail's left edge. ASYMMETRY · MAXIMAL HERO · ONE LOUD COLOR */
async function renderB01(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  // Card footprint: bottom-left, 620x380.
  const cx0 = 48, cy0 = HH - 48 - 380, cw = 620, ch = 380;
  // Defended type zone: scrim behind the card only, fading right.
  scrimH(ctx, cx0, cy0, cw + 140, ch);
  ctx.fillStyle = ACID;
  ctx.fillRect(cx0, cy0, 6, ch);
  // Hero breaks out: 12-degree tilt, crossing the card's top-right corner.
  await drawHeroDisc(environment, ctx, rd.photoSrc, cx0 + cw + 40, cy0 - 60, 420,
    { tiltDeg: 12, rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Type stays inside the card.
  const nx = cx0 + 36;
  drawPresetName(ctx, rd.moldName, nx, cy0 + 132, cw - 72, 104);
  const pw = plasticWeightLine(rd);
  if (pw) drawQuietLine(ctx, pw, nx, cy0 + 182, 34);
  drawTilesRow(ctx, flightTiles(rd), nx, cy0 + 212, 62, 14, 36);
}
presetRenderers.b01 = renderB01;

/** B02 Smoky Fade Slab (2024 Topps) — CORNER CARD.
 * Compact slab in the bottom-left. The disc's rim tucks under the name's
 * trailing letter: three depth layers (scrim, disc, name over rim).
 * DISCLEGIBILITY · THREE DEPTH LAYERS · GRADIENT NOT BOX */
async function renderB02(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  // Card footprint: bottom-left, 600x360.
  const cx0 = 48, cy0 = HH - 48 - 360, cw = 600, ch = 360;
  // Layer 1: smoky gradient slab, card-sized, fading up and right.
  scrimV(ctx, cx0 - 20, cy0 - 60, cw + 160, ch + 60);
  const nx = cx0 + 36;
  // Layer 2: hero at the card's top-right; its left rim tucks under the
  // name's trailing letter (name drawn after = on top).
  ctx.font = `800 120px ${DISPLAY}`;
  const nameW = Math.min(ctx.measureText(rd.moldName.toUpperCase()).width, cw - 200);
  const d = 380;
  const dcx = nx + nameW + 130; // left rim lands ~60px under the name's end
  await drawHeroDisc(environment, ctx, rd.photoSrc, dcx, cy0 + 30, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Layer 3: name rides over the rim; stats stay defended below.
  drawPresetName(ctx, rd.moldName, nx, cy0 + 118, cw - 72, 120);
  const pw = plasticWeightLine(rd);
  if (pw) drawQuietLine(ctx, pw, nx, cy0 + 168, 34);
  drawTilesRow(ctx, flightTiles(rd), nx, cy0 + 198, 62, 14, 36);
}
presetRenderers.b02 = renderB02;

/** B03 Trading Plate Break (NFL on Fox) — CORNER CARD.
 * Small rigid plate in the bottom-left. The hero interrupts the plate's
 * top-right corner; the acid pin marks that single rule-break as
 * intentional. PLATE DISCIPLINE · ONE RULE-BREAK */
async function renderB03(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  // Card footprint: bottom-left plate, 580x340.
  const px = 48, py = HH - 48 - 340, pw = 580, ph = 340;
  ctx.fillStyle = 'rgba(5,7,6,0.82)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);
  // The hero breaks the plate's top-right corner.
  const d = 340;
  await drawHeroDisc(environment, ctx, rd.photoSrc, px + pw, py, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Acid pin: the rule-break, made deliberate.
  ctx.save();
  ctx.translate(px + pw, py);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = ACID;
  ctx.fillRect(-8, -8, 16, 16);
  ctx.restore();
  // Type stays disciplined inside the plate, clear of the disc.
  const nx = px + 36;
  drawPresetName(ctx, rd.moldName, nx, py + 128, pw - 220, 100);
  const q = plasticWeightLine(rd);
  if (q) drawQuietLine(ctx, q, nx, py + 178, 34);
  drawTilesRow(ctx, flightTiles(rd), nx, py + 208, 62, 14, 36);
}
presetRenderers.b03 = renderB03;

/** B04 Flight-Path Arc (Trollbäck NFL GameDay) — CORNER CARD.
 * Small card in the bottom-left. One acid S-curve lives inside the card;
 * the disc sits on the arc's peak, breaking out slightly above the card.
 * Name and stats attach like stations. The arc is the single motif.
 * SPORT-AUTHENTIC MOTIF · EXIT SPACE · EDITORIAL DRAMA */
async function renderB04(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  // Card footprint: bottom-left, 620x380.
  const cx0 = 48, cy0 = HH - 48 - 380, cw = 620, ch = 380;
  // Defended type zone: scrim behind the card only.
  scrimH(ctx, cx0, cy0, cw + 120, ch);
  // The motif: one small S-curve with a peak, inside the card.
  const ax0 = cx0 + 40, ay0 = cy0 + ch - 60;      // arc start, bottom-left
  const peakX = cx0 + cw * 0.55, peakY = cy0 + 90; // arc peak
  const ax1 = cx0 + cw - 30, ay1 = cy0 + ch - 100; // arc end, bottom-right
  ctx.strokeStyle = ACID;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax0, ay0);
  ctx.quadraticCurveTo(cx0 + cw * 0.30, ay0 + 10, peakX, peakY);
  ctx.quadraticCurveTo(cx0 + cw * 0.78, peakY + 30, ax1, ay1);
  ctx.stroke();
  // The disc sits on the peak like a ball on a hill, breaking out above.
  const d = 280;
  await drawHeroDisc(environment, ctx, rd.photoSrc, peakX, peakY - d / 2 + 18, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 7 });
  // Name station: bottom-left. Stats station: bottom-right.
  const nx = cx0 + 36;
  drawPresetName(ctx, rd.moldName, nx, cy0 + ch - 108, cw * 0.52, 88);
  const nums = flightTiles(rd);
  const total = nums.length * 62 + (nums.length - 1) * 14;
  drawTilesRow(ctx, nums, cx0 + cw - 36 - total, cy0 + ch - 96, 62, 14, 36);
}
presetRenderers.b04 = renderB04;

/** B05 Stamp Macro + Hero (Topps 2020-2025) — CORNER CARD.
 * Small card in the bottom-left. The name reads HORIZONTALLY across the
 * top (the vertical-spine bug is fixed). The hero sits right, breaking
 * out; a small acid-rimmed macro coin shows the same subject at 2.6x.
 * DUAL-SCALE IMAGE · HORIZONTAL NAME · PRODUCT DETAIL */
async function renderB05(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment) {
  // Card footprint: bottom-left, 600x380.
  const cx0 = 48, cy0 = HH - 48 - 380, cw = 600, ch = 380;
  scrimH(ctx, cx0, cy0, cw + 140, ch);
  // Name: horizontal, top of card. Never vertical, never clipped.
  const nx = cx0 + 36;
  drawPresetName(ctx, rd.moldName, nx, cy0 + 108, cw - 220, 96);
  // Hero: right side, breaking out top and right.
  const d = 340;
  await drawHeroDisc(environment, ctx, rd.photoSrc, cx0 + cw - 80, cy0 + 130, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Macro coin: same subject at 2.6x, overlapping the card's lower-left.
  await drawHeroDisc(environment, ctx, rd.photoSrc, cx0 + 120, cy0 + ch - 90, 150,
    { rim: ACID, rimWidth: 5, macro: { zoom: 2.6, fx: 0.62, fy: 0.38 } });
  // Stats: bottom, clear of the coin.
  const sx = cx0 + 210;
  const q = plasticWeightLine(rd);
  if (q) drawQuietLine(ctx, q, sx, cy0 + ch - 118, 32);
  drawTilesRow(ctx, flightTiles(rd), sx, cy0 + ch - 88, 58, 12, 34);
}
presetRenderers.b05 = renderB05;

/** Draw one existing SpotlightCard layout onto a supplied Canvas2D context. */
export async function drawCard(
  context: any,
  disc: RendererDisc,
  orientation: CardOrientation,
  preset: CardPreset | undefined,
  environment: CardRenderEnvironment,
): Promise<void> {
  if (orientation !== 'horizontal' && orientation !== 'vertical') {
    throw new Error(`orientation must be 'horizontal' or 'vertical', got ${String(orientation)}`);
  }
  const rd = await resolveCardDisc(environment, disc);
  if (preset) {
    const fn = presetRenderers[preset];
    if (!fn) throw new Error(`unknown card preset: ${preset}`);
    if (preset[0] === 'u' && orientation !== 'vertical') {
      throw new Error(`preset ${preset} is vertical-native; use orientation 'vertical'`);
    }
    if (preset[0] === 'b' && orientation !== 'horizontal') {
      throw new Error(`preset ${preset} is horizontal-native; use orientation 'horizontal'`);
    }
    await fn(context, rd, environment);
  } else if (orientation === 'horizontal') await drawHorizontal(environment, context, rd);
  else await drawVertical(environment, context, rd);
}
