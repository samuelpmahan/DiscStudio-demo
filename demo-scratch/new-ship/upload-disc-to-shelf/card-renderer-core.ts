// SpotlightCard renderer for Disc Studio MVP.
// Each disc in the bag gets an individual card: full-frame transparent PNG
// with the card baked at the bottom-left corner (CapCut overlay track).
// Visual hierarchy: PHOTO > MOLDNAME >> NUMBERS >>> everything else.

import { createFrameRenderer } from './frame-seek.mjs';
import type { Disc } from './model.ts';
import { DEFAULT_U01_APPEARANCE, validateU01Appearance, validateCardAppearance, type U01Appearance, type CardAppearance } from './export-queue-core.ts';

export type CardRenderEnvironment = {
  loadImage: (source: string) => Promise<any>;
  getMoldDetails?: (id: string) => Promise<any>;
  strictPhoto?: boolean;
  createCanvas?: (width: number, height: number) => any;
  frameRenderer?: ReturnType<typeof createFrameRenderer>;
  onFrame?: (receipt: any) => void;
};
export type RendererDisc = Disc & { renderer?: { moldName?: string; manufacturer?: string; flights?: (number | null)[]; artSrc?: string } };

export type CardOrientation = 'horizontal' | 'vertical';

export const CARD_SIZE: Record<CardOrientation, { w: number; h: number }> = {
  horizontal: { w: 1920, h: 1080 },
  vertical: { w: 1080, h: 1920 },
};

const CARD_BG = 'rgba(14,18,22,0.94)';
const INK = '#ffffff';
const MINT = '#8fe3ae';
const FONT_STACK = '"DS Card Sans", "DejaVu Sans", "Nimbus Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

type ResolvedDisc = {
  moldName: string;      // e.g. "Buzzz"
  manufacturer: string;  // e.g. "Discraft"
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
  let manufacturer = supplied.manufacturer ?? '';
  let flights: (number | null)[] | null = Array.isArray(supplied.flights) ? supplied.flights : null;
  try {
    // The queue's renderer triple is a captured catalog snapshot. Do not even
    // consult the live catalog when all three facts are present: doing so is
    // unnecessary and makes the preview depend on current catalog state.
    const hasSavedFactSnapshot = ['moldName', 'manufacturer', 'flights']
      .every(key => Object.hasOwn(supplied, key));
    const details: any = hasSavedFactSnapshot || !environment.getMoldDetails
      ? null : await environment.getMoldDetails(id);
    if (details) {
      // A queued card holds renderer facts at enqueue time. Catalog lookup can
      // fill a missing value, never replace the held card's provenance.
      if (supplied.moldName === undefined) moldName = details.mold ?? details.name ?? moldName;
      if (supplied.manufacturer === undefined) manufacturer = details.manufacturer ?? manufacturer;
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
    manufacturer,
    plastic: disc.plastic || '',
    weight: disc.weight ?? null,
    flights,
    photoSrc: disc.depiction?.kind === 'photo' ? disc.depiction.src ?? null : disc.depiction?.kind === 'painted' && supplied.artSrc?.startsWith('data:image/svg+xml;') ? supplied.artSrc : null,
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
function accentRgba(hex: string, alpha: number): string {
  const value = hex.slice(1);
  const rgb = [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

async function drawPhotoCircle(environment: CardRenderEnvironment, ctx: any, src: string | null, cx: number, cy: number, d: number, accent?: string) {
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
    ctx.strokeStyle = accent ? accentRgba(accent, 0.35) : 'rgba(143,227,174,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Mint rim around the photo, echoing the deck's disc-mark ring.
  ctx.strokeStyle = accent ? accentRgba(accent, 0.9) : 'rgba(143,227,174,0.9)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function plasticWeightLine(rd: ResolvedDisc): string {
  return rd.plastic;
}

/** Card artwork shows plastic when specified; stored weight remains a backward-compatible data field. */
function plasticLine(rd: ResolvedDisc): string {
  return rd.plastic;
}

function manufacturerPlasticLine(rd: ResolvedDisc): string {
  return [rd.manufacturer.toUpperCase(), rd.plastic].filter(Boolean).join(' · ');
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

export type CardPreset = 'u01' | 'u02' | 'u03' | 'u03-front' | 'u03-behind' | 'u03-front-mirror' | 'u03-behind-mirror' | 'u04' | 'u05' | 'b01' | 'b02' | 'b03' | 'b04' | 'b05';

/** Preset id -> renderer. Breakout presets (b01..b05) register here too. */
export const presetRenderers: Record<string, (ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, u01Appearance?: U01Appearance) => Promise<void>> = {};

const VW = 1080, VH = 1920;
const Z_TOP = VH * 0.14;   // platform UI dead zone
const Z_BOT = VH * 0.75;   // caption/controls dead zone
const Z_RAIL = VW * 0.88;  // action rail starts here (right 12%)
const NIGHT92 = 'rgba(5,7,6,0.92)';
const NIGHT94 = 'rgba(5,7,6,0.94)';
/** Plate fill: the layout's own see-through dark unless the card asks for a solid plate. */
const plateFill = (appearance: U01Appearance | undefined, seeThrough: string) => appearance?.plate === 'solid' ? PLATE : seeThrough;
/** B03's thin frame, offered on B01. */
function drawFrame(ctx: any, x: number, y: number, w: number, h: number) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }
const ACID = '#c8f23d';
const CORAL = '#ff5c47';
const DISPLAY = '"DS Card Sans Condensed", "DejaVu Sans Condensed", "Nimbus Sans Narrow", "DejaVu Sans", sans-serif';
const SCOREBUG_SURFACE = '#1a1b1a';

function luminance(hex: string): number {
  const channels = [0, 2, 4].map(index => Number.parseInt(hex.slice(1 + index, 3 + index), 16) / 255);
  return channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function u01AccentContrastOnScorebug(accent: string): number { return contrastRatio(accent, SCOREBUG_SURFACE); }
/** Warning only: digit color and recipe backing remain unchanged. */
export function cardDigitAccentContrast(accent: string, preset: string): number { return contrastRatio(accent, preset.startsWith('b') ? '#202623' : '#38413e'); }

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
  fill = 'rgba(255,255,255,0.10)',
  ink = '#0e1216',
  fitDigits = false,
) {
  const total = tilesRowWidth(nums.length, tile, gap);
  let sx = x;
  if (align === 'right') sx = x - total;
  if (align === 'center') sx = x - total / 2;
  ctx.font = `600 ${fontPx}px ${FONT_STACK}`;
  for (let i = 0; i < nums.length; i++) {
    const bx = sx + i * (tile + gap);
    ctx.fillStyle = fill;
    roundRect(ctx, bx, y, tile, tile, 10);
    ctx.fill();
    // The caller pairs each tile fill with a contrasting value color.
    ctx.fillStyle = ink;
    if (fitDigits) fitFont(ctx, nums[i], tile - 12, 600, fontPx);
    ctx.textAlign = 'center';
    ctx.fillText(nums[i], bx + tile / 2, y + tile * 0.72);
  }
  ctx.textAlign = 'left';
}

function contrastInk(hex: string): string {
  if (contrastRatio(hex, '#111820') >= 4.5) return '#111820';
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}

/** Accent used as TEXT on a dark surface: keep the sponsor colour when it already
 * reads at 4.5:1, otherwise lift it toward white just far enough to read.
 * Fills (tiles, rims, rules) keep the exact chosen colour. */
export function legibleAccent(accent: string, surface: string): string {
  if (contrastRatio(accent, surface) >= 4.5) return accent;
  const rgb = [1, 3, 5].map(i => Number.parseInt(accent.slice(i, i + 2), 16));
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const hex = '#' + rgb.map(c => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
    if (contrastRatio(hex, surface) >= 4.5) return hex;
  }
  return '#ffffff';
}
const PLATE = '#050706';

function drawU01FlightValues(ctx: any, nums: string[], x: number, y: number, align: 'left' | 'right', highlightTarget: 'tiles' | 'digits', accent: string) {
  const defaultTile = '#38413e';
  const digitTile = defaultTile;
  drawTilesRow(ctx, nums, x, y, 64, 10, 38, align, highlightTarget === 'tiles' ? accent : digitTile, highlightTarget === 'digits' ? legibleAccent(accent, digitTile) : contrastInk(accent));
}

/** Law 4: one display voice for the name. */
function drawPresetName(
  ctx: any, text: string, x: number, y: number,
  maxW: number, startPx: number, align: 'left' | 'right' | 'center' = 'left',
) {
  const name = text.toUpperCase();
  ctx.fillStyle = INK;
  fitFont(ctx, name, maxW, 800, startPx, DISPLAY);
  ctx.textAlign = align;
  // fitFont's 12px floor is only a preferred font size. Canvas maxWidth is the
  // final geometry guard for names beyond that floor (including stress names).
  ctx.fillText(name, x, y, maxW);
  ctx.textAlign = 'left';
}

/** U01 Compact Scorebug (NFL on Fox, corner card).
 * Card footprint: x 48-508, y ~410-1060. A slim dark scorebug anchors in the
 * safe left; the disc breaks out above it. The MINT rule, flight values, and
 * manufacturer label form one accent. */
async function renderU01(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  // Missing appearance keeps cards already in saved queues byte-compatible.
  // New creator layouts mirror the contents only within the existing 460px
  // scorebug footprint; the photo pixels and flight glyph order never flip.
  const discSide = appearance?.discSide ?? 'right';
  const cardX = 48, cardW = 460, cardY = 700, cardH = 300;
  const align: 'left' | 'right' = discSide === 'left' ? 'right' : 'left';
  const accent = appearance?.accentColor ?? MINT;
  const highlightTarget = appearance?.highlightTarget ?? 'digits';

  // Hero breaks out above the card.
  const d = 380;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, discSide === 'left' ? 246 : 310, 600, d, accent);

  // Scorebug block: dark protection behind type only.
  ctx.fillStyle = plateFill(appearance, NIGHT92);
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.fillStyle = accent;
  ctx.fillRect(discSide === 'left' ? cardX + cardW - 4 : cardX, cardY, 4, cardH);

  const nameX = align === 'right' ? cardX + cardW - 28 : cardX + 28;
  drawPresetName(ctx, rd.moldName, nameX, cardY + 120, cardW - 56, 96, align);

  const nums = flightTiles(rd);
  const supportMaxWidth = cardW - 56;
  const tilesY = cardY + 150;
  drawU01FlightValues(ctx, nums, nameX, tilesY, align, highlightTarget, accent);

  const details = manufacturerPlasticLine(rd);
  if (details) {
    ctx.fillStyle = legibleAccent(accent, PLATE);
    fitFont(ctx, details, supportMaxWidth, 600, 28);
    // Canvas's maxWidth also protects the column at fitFont's minimum size.
    ctx.textAlign = align;
    ctx.fillText(details, nameX, tilesY + 104, supportMaxWidth);
  }
  ctx.textAlign = 'left';
}
presetRenderers.u01 = renderU01;

/** U02 Stacked Poster (VALORANT Game Changers, corner card).
 * Card footprint: x 48-508, y ~480-1210. Hero owns the top of the card;
 * mold name, flight numbers, then manufacturer and optional plastic form the
 * fixed reading order. */
async function renderU02(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  // Keep the alternate rail outside the right-side action overlay zone.
  const cardW = 460, cardX = appearance?.discSide === 'right' ? Z_RAIL - 48 - cardW : 48;
  const accent = appearance?.accentColor ?? MINT;
  const highlightTarget = appearance?.highlightTarget ?? 'digits';
  const align: 'left' | 'right' = appearance?.discSide === 'right' ? 'right' : 'left';

  // Hero: top of the card, full card width.
  const d = 400;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, cardX + cardW / 2, 680, d, accent);

  // Name band: dark with the same mint accent as the photo rim.
  const bandY = 830, bandH = 340;
  ctx.fillStyle = plateFill(appearance, NIGHT92);
  ctx.fillRect(cardX, bandY, cardW, bandH);
  ctx.fillStyle = appearance ? accent : MINT;
  if (appearance) ctx.fillRect(appearance.discSide === 'right' ? cardX + cardW - 4 : cardX, bandY, 4, bandH);
  else ctx.fillRect(cardX, bandY, cardW, 4);

  const nameX = align === 'right' ? cardX + cardW - 28 : cardX + 28;
  drawPresetName(ctx, rd.moldName, nameX, bandY + 98, cardW - 56, 100, align);

  // Flight numbers are primary: they always occupy the first row below identity.
  const nums = flightTiles(rd);
  const tilesY = 990;
  if (appearance) drawTilesRow(ctx, nums, align === 'right' ? cardX + cardW - 28 : nameX, tilesY, 68, 12, 40, align,
    highlightTarget === 'tiles' ? accent : '#38413e',
    highlightTarget === 'digits' ? legibleAccent(accent, '#38413e') : contrastInk(accent), true);
  else drawTilesRow(ctx, nums, nameX, tilesY, 68, 12, 40, 'left', '#38413e', MINT);

  const details = manufacturerPlasticLine(rd);
  if (details) {
    ctx.fillStyle = appearance ? legibleAccent(accent, PLATE) : 'rgba(143,227,174,0.78)';
    fitFont(ctx, details, cardW - 56, 600, 30);
    ctx.textAlign = align;
    ctx.fillText(details, nameX, tilesY + 138, cardW - 56);
    ctx.textAlign = 'left';
  }
}
presetRenderers.u02 = renderU02;

/** U3 Compare uses four explicit addresses. The inherited u03 address is the
 * original/front-left alternative, never an acceptance decision. Photo pixels
 * and glyphs keep their orientation when composition positions mirror. */
const U3_COMPARE = ['u03', 'u03-front', 'u03-behind', 'u03-front-mirror', 'u03-behind-mirror'];
export async function cardFrameSnapshot(disc: RendererDisc, preset: CardPreset, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  const facts = await resolveCardDisc(environment, disc);
  const rd = Object.freeze({...facts,flights:facts.flights ? Object.freeze([...facts.flights]) : null});
  if (!U3_COMPARE.includes(preset) && preset !== 'u04') throw Error('Layer snapshot is scoped to U3/U4');
  // With no appearance, the four historical U3 ids keep their exact side.
  // Once Card Details is supplied, discSide is authoritative for every U3 id.
  const accent = appearance?.accentColor ?? '#c8f23d';
  const mirrored = appearance ? appearance.discSide === 'left' : preset.endsWith('-mirror');
  const highlightTarget = appearance?.highlightTarget ?? 'digits';
  // U04 is a centered group, so move its surface, label, and hero together
  // between the left safe rail and a right position that clears the action rail.
  const u04Shift = preset === 'u04' && appearance?.discSide === 'right' ? Z_RAIL - 48 - 460 - 48 : 0;
  const u04Center = 278 + u04Shift;
  const mirrorX = (x: number) => mirrored ? 584 - x : x;
  let image: any = null;
  if (rd.photoSrc) {
    try { image = await environment.loadImage(rd.photoSrc); }
    catch (error) { if (environment.strictPhoto) throw error; }
  }
  const photoSize = 368;
  const photo = { id: 'disc-photo', identity: JSON.stringify([rd.photoSrc, accent, photoSize]), width: photoSize, height: photoSize,
    x: (preset === 'u04' ? u04Center : mirrorX(352)) - photoSize / 2, y: (preset === 'u04' ? 1038 : 810) - photoSize / 2,
    draw(ctx: any) {
      const r = 180, cx = 184, cy = 184;
      ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
      if (image) { const scale = Math.max(360/image.width,360/image.height), w=image.width*scale,h=image.height*scale;ctx.drawImage(image,cx-w/2,cy-h/2,w,h); }
      else { ctx.fillStyle='#1c2a24';ctx.fillRect(4,4,360,360); }
      ctx.restore();ctx.strokeStyle=accent;ctx.lineWidth=7;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
    } };
  const surface = { id: 'card-surface', identity: JSON.stringify([preset === 'u04' ? 'kinetic-v3-fade' : 'spine-v2',mirrored,preset === 'u04' ? rd.manufacturer : '',u04Shift]), draw(ctx: any) {
    if (preset === 'u04') {
      const manufacturer = rd.manufacturer.toUpperCase();
      ctx.save();fitFont(ctx,manufacturer,400,600,52);
      const labelTop = manufacturer ? 622 - ctx.measureText(manufacturer).actualBoundingBoxAscent : 634;
      ctx.restore();
      const fadeOpaqueY = Math.max(530,Math.min(632,labelTop - 2));
      const g=ctx.createLinearGradient(0,530,0,1170);g.addColorStop(0,'rgba(24,24,24,0)');g.addColorStop((fadeOpaqueY-530)/640,'rgba(24,24,24,.88)');g.addColorStop(.80,'rgba(24,24,24,.88)');g.addColorStop(1,'rgba(24,24,24,0)');ctx.fillStyle=g;ctx.fillRect(48+u04Shift,530,460,640);
    } else {ctx.fillStyle=NIGHT94;ctx.fillRect(mirrored?326:48,570,210,650);ctx.fillStyle=accent;ctx.fillRect(mirrored?326:255,570,3,650);}
  } };
  const text = { id: 'card-label', identity: JSON.stringify([preset === 'u04'?'kinetic-v3':'spine-v2',mirrored,rd.moldName,preset === 'u04'?rd.manufacturer:'',rd.flights,accent,highlightTarget,u04Shift]), draw(ctx: any) {
    if(preset === 'u04') {
      drawPresetName(ctx,rd.moldName,u04Center,728,410,112,'center');
      ctx.textAlign='center';ctx.fillStyle=legibleAccent(accent,'#181818');fitFont(ctx,rd.manufacturer.toUpperCase(),400,600,52);ctx.fillText(rd.manufacturer.toUpperCase(),u04Center,622);
      drawTilesRow(ctx,flightTiles(rd),u04Center,770,72,10,44,'center',highlightTarget === 'tiles' ? accent : (appearance ? ('#38413e') : accent),highlightTarget === 'digits' ? (appearance ? legibleAccent(accent,'#38413e') : contrastInk(accent)) : contrastInk(accent),true);
    } else {
      const cx=mirrorX(124);ctx.save();ctx.translate(cx,744);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=INK;fitFont(ctx,rd.moldName.toUpperCase(),286,800,76,DISPLAY);ctx.fillText(rd.moldName.toUpperCase(),0,0);ctx.restore();
      ctx.textBaseline='alphabetic';ctx.font=`600 42px ${FONT_STACK}`;ctx.textAlign='center';
      for(const [i,value] of flightTiles(rd).entries()){const y=920+i*72;const tileFill=appearance && highlightTarget==='digits'?('#38413e'):accent;ctx.fillStyle=tileFill;ctx.fillRect(mirrorX(140)-32,y,64,64);ctx.fillStyle=appearance?(highlightTarget==='tiles'?contrastInk(accent):legibleAccent(accent,'#38413e')):contrastInk(accent);fitFont(ctx,value,52,600,42);ctx.fillText(value,mirrorX(140),y+47);}
    }
  } };
  const layers = preset === 'u04' || !preset.includes('behind') ? [surface,text,photo] : [photo,surface,text];
  return Object.freeze({ schema:'discstudio-frame-scene@1',width:1080,height:1920,preset,comparison:U3_COMPARE.includes(preset)?'Compare':undefined,layers:Object.freeze(layers.map(layer=>Object.freeze(layer))) });
}

for (const id of [...U3_COMPARE, 'u04']) presetRenderers[id] = async (ctx, rd, environment, appearance) => { const disc = { mold: '', depiction: rd.photoSrc ? {kind:'photo',src:rd.photoSrc} : {kind:'none'}, plastic:rd.plastic, weight:rd.weight, renderer:rd } as any; const scene=await cardFrameSnapshot(disc,id as CardPreset,environment,appearance); if(!environment.createCanvas) throw Error('Canvas adapter required');(environment.frameRenderer ?? createFrameRenderer({createCanvas:environment.createCanvas})).seek(ctx,scene,0); };

/** U05 Glass Stat Drawer (Ultra LoL HUD, corner card).
 * Card footprint: x 48-508, y ~450-1120. A small dark-tinted drawer in the
 * safe left; the hero overlaps it by a third. Dark tint keeps type legible
 * on bright footage (no backdrop blur in a static PNG). Glass highlight
 * line is the one motif. */
async function renderU05(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  const gx = appearance?.discSide === 'right' ? Z_RAIL - 48 - 460 : 48, gw = 460;
  const accent = appearance?.accentColor ?? MINT;
  const highlightTarget = appearance?.highlightTarget ?? 'digits';
  const align: 'left' | 'right' = appearance?.discSide === 'right' ? 'right' : 'left';
  const d = 380;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, gx + gw / 2, 640, d, accent);

  const gy = 800, gh = 320;
  ctx.fillStyle = appearance?.plate === 'solid' ? '#0a0e0c' : 'rgba(10,14,12,0.62)';
  roundRect(ctx, gx, gy, gw, gh, 24);
  ctx.fill();
  ctx.strokeStyle = appearance ? accentRgba(accent, 0.58) : 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  roundRect(ctx, gx, gy, gw, gh, 24);
  ctx.stroke();
  ctx.strokeStyle = appearance ? accentRgba(accent, 0.25) : 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(gx + 24, gy + 3);
  ctx.lineTo(gx + gw - 24, gy + 3);
  ctx.stroke();

  const nameX = align === 'right' ? gx + gw - 36 : gx + 36;
  drawPresetName(ctx, rd.moldName, nameX, gy + 108, gw - 72, 92, align);

  const nums = flightTiles(rd);
  drawTilesRow(ctx, nums, nameX, gy + 154, 64, 10, 38, align,
    appearance ? (highlightTarget === 'tiles' ? accent : '#38413e') : MINT,
    appearance ? (highlightTarget === 'digits' ? legibleAccent(accent, '#38413e') : contrastInk(accent)) : '#0e1216', true);
  const details = manufacturerPlasticLine(rd);
  if (details) {
    ctx.fillStyle = appearance ? legibleAccent(accent, '#0a0e0c') : MINT;
    fitFont(ctx, details, gw - 72, 600, 30);
    ctx.textAlign = align;
    ctx.fillText(details, nameX, gy + 280, gw - 72);
    ctx.textAlign = 'left';
  }
}
presetRenderers.u05 = renderU05;

/* ------------------------------------------------------------------
 * BREAKOUT PRESETS (horizontal-native, 16:9) — from
 * Spotlight_Card_Visual_Research. Hero-led overlays: the disc escapes
 * the rail while the type stays defended. These five use flat bounded
 * surfaces; U04 alone retains its explicitly scoped readability fade.
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

/** Flat bounded dark support behind a horizontal recipe's information. */
function scrimH(ctx: any, x: number, y: number, w: number, h: number, flip = false, appearance?: U01Appearance) {
  ctx.fillStyle = plateFill(appearance, NIGHT(0.82));
  ctx.fillRect(x, y, w, h);
}

/** Flat bounded dark support behind a horizontal recipe's information. */
function scrimV(ctx: any, x: number, y: number, w: number, h: number, appearance?: U01Appearance) {
  ctx.fillStyle = plateFill(appearance, NIGHT(0.82));
  ctx.fillRect(x, y, w, h);
}

/** Quiet plastic line under the name. */
function drawQuietLine(ctx: any, text: string, x: number, y: number, px = 40, align: 'left' | 'right' = 'left', maxWidth?: number) {
  ctx.font = `500 ${px}px ${FONT_STACK}`;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (maxWidth !== undefined) { fitFont(ctx, text, maxWidth, 500, px, FONT_STACK); ctx.fillText(text, x, y, maxWidth); }
  else ctx.fillText(text, x, y);
}

function drawAppearanceTiles(ctx: any, nums: string[], x: number, y: number, tile: number, gap: number, fontPx: number,
  appearance?: U01Appearance, align: 'left' | 'right' = 'left') {
  if (!appearance) { drawTilesRow(ctx, nums, x, y, tile, gap, fontPx, align); return; }
  const accent = appearance.accentColor;
  if (appearance.highlightTarget === 'tiles') {
    drawTilesRow(ctx, nums, x, y, tile, gap, fontPx, align, accent, contrastInk(accent));
  } else {
    const tileFill = '#202623';
    drawTilesRow(ctx, nums, x, y, tile, gap, fontPx, align, tileFill, legibleAccent(accent, tileFill));
  }
}

/** B01 Pop Color Eject (VALORANT Game Changers) — CORNER CARD.
 * Small rail in the bottom-left corner. The disc breaks out: tilted 12 deg,
 * crossing the rail's top and right edges. One loud color (acid), used once
 * as the rail's left edge. ASYMMETRY · MAXIMAL HERO · ONE LOUD COLOR */
async function renderB01(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  // Card footprint: bottom-left, 620x380.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 620 : 48, cy0 = HH - 48 - 330, cw = 620, ch = 330;
  // Defended type zone: scrim behind the card only, fading right.
  scrimH(ctx, right ? cx0 - 140 : cx0, cy0, cw + 140, ch, right, appearance);
  if (appearance?.frame) drawFrame(ctx, right ? cx0 - 140 : cx0, cy0, cw + 140, ch);
  ctx.fillStyle = appearance?.accentColor ?? ACID;
  ctx.fillRect(right ? cx0 + cw - 6 : cx0, cy0, 6, ch);
  // Hero breaks out: 12-degree tilt, crossing the card's top-right corner.
  await drawHeroDisc(environment, ctx, rd.photoSrc, right ? cx0 - 40 : cx0 + cw + 40, cy0 - 60, 420,
    { tiltDeg: 12, rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Type stays inside the card.
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  drawPresetName(ctx, rd.moldName, nx, cy0 + 132, cw - 220, 104, right ? 'right' : 'left');
  const pw = plasticLine(rd);
  if (pw) drawQuietLine(ctx, pw, nx, cy0 + 182, 34, right ? 'right' : 'left', cw - 220); // typed plastic stays in the name lane
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + 212, 74, 14, 44, appearance, right ? 'right' : 'left');
}
presetRenderers.b01 = renderB01;

/** B02 Smoky Fade Slab (2024 Topps) — CORNER CARD.
 * Compact slab in the bottom-left. The disc sits just beyond the name's
 * trailing edge: three depth layers (scrim, disc, name).
 * DISCLEGIBILITY · THREE DEPTH LAYERS · GRADIENT NOT BOX */
async function renderB02(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  // Card footprint: bottom-left, 600x360.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 600 : 48, cy0 = HH - 48 - 315, cw = 600, ch = 315;
  // Layer 1: smoky gradient slab, card-sized, fading up and right.
  scrimV(ctx, cx0 - 20, cy0 - 60, cw + 160, ch + 60, appearance);
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  // Layer 2: hero at the card's top-right, beyond the name's reading lane.
  ctx.font = `800 120px ${DISPLAY}`;
  const nameW = Math.min(ctx.measureText(rd.moldName.toUpperCase()).width, cw - 200);
  const d = 380;
  const dcx = right ? nx - nameW - 310 : nx + nameW + 310; // enough air protects the name at preview size
  await drawHeroDisc(environment, ctx, rd.photoSrc, dcx, cy0 + 30, d,
    { rim: appearance?.accentColor ?? 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Layer 3: name and stats stay defended inside the slab.
  drawPresetName(ctx, rd.moldName, nx, cy0 + 118, cw - 72, 120, right ? 'right' : 'left');
  const pw = plasticLine(rd);
  if (pw) drawQuietLine(ctx, pw, nx, cy0 + 168, 34, right ? 'right' : 'left', Math.max(260, nameW + 100)); // ends before the disc's near edge (nameW + 120)
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + 198, 74, 14, 44, appearance, right ? 'right' : 'left');
}
presetRenderers.b02 = renderB02;

/** B03 Trading Plate Break (NFL on Fox) — CORNER CARD.
 * Small rigid plate in the bottom-left. The hero interrupts the plate's
 * top-right corner; the acid pin marks that single rule-break as
 * intentional. PLATE DISCIPLINE · ONE RULE-BREAK */
async function renderB03(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  // Card footprint: bottom-left plate, 580x340.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const px = right ? HW - 48 - 580 : 48, py = HH - 48 - 325, pw = 580, ph = 325;
  ctx.fillStyle = plateFill(appearance, 'rgba(5,7,6,0.82)');
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);
  // The hero breaks the plate's top-right corner.
  const d = 340;
  await drawHeroDisc(environment, ctx, rd.photoSrc, right ? px : px + pw, py, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Type stays disciplined inside the plate, clear of the disc.
  const nx = right ? px + pw - 36 : px + 36;
  drawPresetName(ctx, rd.moldName, nx, py + 128, pw - 220, 100, right ? 'right' : 'left');
  const q = plasticLine(rd);
  if (q) drawQuietLine(ctx, q, nx, py + 178, 34, right ? 'right' : 'left', pw - 220); // typed plastic stays in the name lane
  drawAppearanceTiles(ctx, flightTiles(rd), nx, py + 208, 74, 14, 44, appearance, right ? 'right' : 'left');
}
presetRenderers.b03 = renderB03;

/** B04 Flight-Path Arc (Trollbäck NFL GameDay) — CORNER CARD.
 * Small card in the bottom-left. One acid S-curve lives inside the card;
 * the disc sits on the arc's peak, breaking out slightly above the card.
 * Name and stats attach like stations. The arc is the single motif.
 * SPORT-AUTHENTIC MOTIF · EXIT SPACE · EDITORIAL DRAMA */
async function renderB04(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  // Card footprint: bottom-left, 620x380.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 620 : 48, cy0 = HH - 48 - 380, cw = 620, ch = 380;
  // Defended type zone: scrim behind the card only.
  scrimH(ctx, right ? cx0 - 120 : cx0, cy0, cw + 120, ch, right, appearance);
  // The motif: one small S-curve with a peak, inside the card.
  const mirror = (localX: number) => right ? cx0 + cw - (localX - cx0) : localX;
  // Keep both arc tails above the defended title lane, including its longest
  // current catalog mold, while retaining the one continuous flight-path motif.
  const ax0 = mirror(cx0 + 40), ay0 = cy0 + ch - 205;
  const peakX = mirror(cx0 + cw * 0.55), peakY = cy0 + 90;
  const ax1 = mirror(cx0 + cw - 30), ay1 = cy0 + ch - 205;
  ctx.strokeStyle = appearance?.accentColor ?? ACID;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax0, ay0);
  ctx.quadraticCurveTo(mirror(cx0 + cw * 0.30), ay0 + 10, peakX, peakY);
  ctx.quadraticCurveTo(mirror(cx0 + cw * 0.78), peakY + 30, ax1, ay1);
  ctx.stroke();
  // The disc sits on the peak like a ball on a hill, breaking out above.
  const d = 280;
  await drawHeroDisc(environment, ctx, rd.photoSrc, peakX, peakY - d / 2 + 18, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 7 });
  // Numbers row under the arc, then the name along the bottom with the full
  // plate width to grow into (Sam, 21 Oct 2026: numbers on top, name below).
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + ch - 186, 62, 14, 36, appearance, right ? 'right' : 'left');
  drawPresetName(ctx, rd.moldName, nx, cy0 + ch - 44, cw - 72, 88, right ? 'right' : 'left');
}
presetRenderers.b04 = renderB04;

/** B05 Stamp Macro + Hero (Topps 2020-2025) — CORNER CARD.
 * Small card in the bottom-left. The name reads HORIZONTALLY across the
 * top (the vertical-spine bug is fixed). The hero sits right, breaking
 * out; a small acid-rimmed macro coin shows the same subject at 2.6x.
 * DUAL-SCALE IMAGE · HORIZONTAL NAME · PRODUCT DETAIL */
async function renderB05(ctx: any, rd: ResolvedDisc, environment: CardRenderEnvironment, appearance?: U01Appearance) {
  // Card footprint: bottom-left, 600x380.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 600 : 48, cy0 = HH - 48 - 380, cw = 600, ch = 380;
  scrimH(ctx, right ? cx0 - 140 : cx0, cy0, cw + 140, ch, right, appearance);
  // Name: horizontal, top of card. Leave a readable lane beside the hero.
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  // Hero: right side, breaking out top and right.
  const d = 340;
  await drawHeroDisc(environment, ctx, rd.photoSrc, right ? cx0 - 40 : cx0 + cw + 40, cy0 + 130, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Numbers on top with the macro coin beside them; the name runs along the
  // bottom where it has the most room (Sam, 21 Oct 2026).
  const side = right ? 'right' : 'left';
  const along = (offset: number) => right ? cx0 + cw - offset : cx0 + offset;
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + 36, 58, 12, 34, appearance, side);
  await drawHeroDisc(environment, ctx, rd.photoSrc, along(36 + 4 * 58 + 3 * 12 + 24 + 60), cy0 + 92, 120,
    { rim: appearance?.accentColor ?? ACID, rimWidth: 5, macro: { zoom: 2.6, fx: appearance?.zoomFocus?.x ?? 0.62, fy: appearance?.zoomFocus?.y ?? 0.38 } });
  const q = plasticLine(rd);
  if (q) drawQuietLine(ctx, q, nx, cy0 + ch - 128, 32, side, cw - 220);
  drawPresetName(ctx, rd.moldName, nx, cy0 + ch - 44, cw - 116, 96, side);
}
presetRenderers.b05 = renderB05;

/** Draw one existing SpotlightCard layout onto a supplied Canvas2D context. */
export async function drawCard(
  context: any,
  disc: RendererDisc,
  orientation: CardOrientation,
  preset: CardPreset | undefined,
  environment: CardRenderEnvironment,
  appearanceInput?: CardAppearance,
): Promise<void> {
  if (orientation !== 'horizontal' && orientation !== 'vertical') {
    throw new Error(`orientation must be 'horizontal' or 'vertical', got ${String(orientation)}`);
  }
  if (preset && (U3_COMPARE.includes(preset) || preset === 'u04')) {
    if (orientation !== 'vertical') throw Error(`preset ${preset} is vertical-native; use orientation 'vertical'`);
    if (!environment.createCanvas) throw Error('U3/U4 frame renderer requires a Canvas adapter');
    const renderer = environment.frameRenderer ?? createFrameRenderer({ createCanvas: environment.createCanvas });
    const appearance = appearanceInput ? validateCardAppearance(appearanceInput) : undefined;
    const scene = await cardFrameSnapshot(disc,preset,environment,appearance);
    environment.onFrame?.(renderer.seek(context,scene,0));
    if (!environment.onFrame) renderer.seek(context,scene,0);
    return;
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
    const appearance = appearanceInput ? validateCardAppearance(appearanceInput) : undefined;
    await fn(context, rd, environment, appearance);
  } else if (orientation === 'horizontal') await drawHorizontal(environment, context, rd);
  else await drawVertical(environment, context, rd);
}
