// Environment-neutral queue and manifest semantics shared by Node and browser export.
import type { Disc } from './model.ts';

export type CardOrientation = 'horizontal' | 'vertical';
export const orientations: readonly CardOrientation[] = ['horizontal', 'vertical'];
export interface QueuedCard { disc: Disc; orientation: CardOrientation; cardDesign: string; }
export type CardRenderer = (card: QueuedCard) => Promise<Uint8Array>;
export interface CardDimensions { width: number; height: number; }
export function cardDimensions(orientation: CardOrientation): CardDimensions { return orientation === 'vertical' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }; }
const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card';
export function moldSlug(disc: Pick<Disc, 'mold'>): string { const match = /^ds\.px\.seed\.([^.]+)/.exec(disc.mold); return slug(match?.[1] ?? disc.mold.split('.').pop() ?? disc.mold); }
export function cardFilename(card: QueuedCard, taken: Set<string> = new Set()): string {
  const base = `${moldSlug(card.disc)}-${slug(card.cardDesign)}-${card.orientation}`;
  let name = `${base}.png`, n = 2; while (taken.has(name)) name = `${base}-${n++}.png`; taken.add(name); return name;
}
function checkCard(card: QueuedCard, index: number): void {
  const where = `queue[${index}]`;
  if (!card || typeof card !== 'object') throw new Error(`${where}: expected a QueuedCard.`);
  if (!card.disc || typeof card.disc.id !== 'string' || !card.disc.id) throw new Error(`${where}: disc needs a non-empty id.`);
  if (typeof card.disc.mold !== 'string' || !card.disc.mold) throw new Error(`${where}: disc needs a mold address.`);
  if (!orientations.includes(card.orientation)) throw new Error(`${where}: orientation must be 'horizontal' or 'vertical'.`);
  if (typeof card.cardDesign !== 'string' || !card.cardDesign.trim()) throw new Error(`${where}: cardDesign must be a non-empty string.`);
}
/** Queue cards are portable metadata, not arbitrary JavaScript objects. */
function snapshot(value: unknown): any {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])));
  throw Error('Queued output must contain only plain card metadata.');
}
export function queueCards(items: readonly QueuedCard[]): readonly QueuedCard[] {
  if (!Array.isArray(items)) throw new Error('queueCards: expected an array.');
  items.forEach(checkCard); return Object.freeze(items.map(card => snapshot(card)));
}
export interface ManifestCard {
  filename: string; discId: string; nickname: string; mold: string; plastic: string; weight: number | null;
  flight: { speed: number | null; glide: number | null; turn: number | null; fade: number | null };
  orientation: CardOrientation; cardDesign: string; width: number; height: number; byteLength: number; sha256: string;
  flightSource: { speed: 'own' | 'mold' | 'unknown'; glide: 'own' | 'mold' | 'unknown'; turn: 'own' | 'mold' | 'unknown'; fade: 'own' | 'mold' | 'unknown' };
}
export interface ExportManifest { type: 'discstudio-export'; version: 1; cardCount: number; cards: ManifestCard[]; }
export type RenderedExport = { filename: string; png: Uint8Array; card: QueuedCard };
export async function prepareExport(queue: readonly QueuedCard[], renderCard: CardRenderer, sha256: (bytes: Uint8Array) => Promise<string>): Promise<{ rendered: RenderedExport[]; manifest: ExportManifest }> {
  const cards = queueCards(queue); if (!cards.length) throw new Error('exportZip: queue is empty. Pick at least one disc.');
  const taken = new Set<string>(), rendered: RenderedExport[] = [], manifestCards: ManifestCard[] = [];
  for (const card of cards) {
    const filename = cardFilename(card, taken), png = new Uint8Array(await renderCard(card));
    if (!png.length) throw new Error(`exportZip: renderer returned empty bytes for ${filename}.`);
    const { width, height } = cardDimensions(card.orientation);
    rendered.push({ filename, png, card });
    const rendererFlights = (card.disc as any).renderer?.flights as (number | null)[] | undefined;
    const fields = ['speed', 'glide', 'turn', 'fade'] as const;
    const values = Object.fromEntries(fields.map((field, index) => {
      if (Object.hasOwn(card.disc, field) && card.disc[field] !== undefined) return [field, { value: card.disc[field] ?? null, source: card.disc[field] === null ? 'unknown' : 'own' }];
      const inherited = rendererFlights?.[index]; return [field, { value: inherited ?? null, source: inherited == null ? 'unknown' : 'mold' }];
    })) as Record<typeof fields[number], { value: number | null; source: 'own' | 'mold' | 'unknown' }>;
    manifestCards.push({ filename, discId: card.disc.id, nickname: card.disc.nickname, mold: card.disc.mold, plastic: card.disc.plastic, weight: card.disc.weight,
      flight: { speed: values.speed.value, glide: values.glide.value, turn: values.turn.value, fade: values.fade.value }, flightSource: { speed: values.speed.source, glide: values.glide.source, turn: values.turn.source, fade: values.fade.source }, orientation: card.orientation, cardDesign: card.cardDesign,
      width, height, byteLength: png.length, sha256: await sha256(png) });
  }
  return { rendered, manifest: { type: 'discstudio-export', version: 1, cardCount: manifestCards.length, cards: manifestCards } };
}
