import { createExperience, initialDraft } from './model.ts';

export async function startSandbox(name: 'upload' | 'shelf', log = (_event: Record<string, unknown>) => {}) {
  const experience = createExperience(log, { status: () => 'Isolated Experience · memory only. Reset never touches your saved shelf.' });
  if (name === 'shelf') {
    for (const [index, specimen] of [
      { plastic: 'ESP', weight: 175, Color1: '#98d4ba' },
      { plastic: 'Z', weight: 172, Color1: '#f8b393' },
      { plastic: 'ESP', weight: 170, Color1: '#748bad' },
    ].entries()) {
      await experience.addDraftPhoto({ kind: 'photo', name: `fixture-${index}.png`, src: 'data:image/png;base64,iVBORw0KGgo=' });
      const hydrated = await experience.hydrateSeed(initialDraft().mold);
      await experience.save({ ...initialDraft(), mold: hydrated.address, ...specimen }, await experience.selectDraftDepiction());
    }
  }
  return experience;
}

// Small, independent snapshot of relevant material; full live bindings stay in DevTools.
export function inspectExperience(experience: ReturnType<typeof createExperience>) {
  return Object.freeze({ shelfAddress: experience.shelfAddress,
    bagsAddress: experience.bagsAddress,
    bags: Object.freeze(experience.bags().map(({ address, bag }) => Object.freeze(structuredClone({ address, bag })))),
    discs: Object.freeze(experience.shelf().map(({ address, disc, seed }) => Object.freeze(structuredClone({ address, own: disc, mold: seed, resolved: experience.resolve(disc) })))),
    receipts: Object.freeze(experience.pxc.receipts().map(receipt => Object.freeze({ into: receipt.into, status: receipt.status }))),
  });
}
