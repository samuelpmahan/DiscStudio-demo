import { queueCards, type QueuedCard } from './export-queue-core.ts';

const utf8 = new TextEncoder();

export async function sha256Identity(value: unknown): Promise<string> {
  const bytes = utf8.encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function approvedQueueIdentity(cards: readonly QueuedCard[]): Promise<{ cards: readonly QueuedCard[]; identity: string }> {
  const snapshot = queueCards(cards);
  return Object.freeze({ cards: snapshot, identity: await sha256Identity(snapshot) });
}
