// The executable catalog. Distinguish owner-accepted appearance from model integration.
export const experiences = [
  { id: 'upload-disc-to-shelf', name: 'UploadDiscToShelf', status: 'm reached · live PxC',
    description: 'Catalog → own Disc fields → retained painting and photo → chosen depiction → shelf.',
    variants: [{ name: 'Paint / photo · isolated PxC', url: './index.html?sandbox=upload', inspectable: true }],
    source: ['upload-ui.ts · mountUpload', 'model.ts · save', 'paint-recipe.ts · renderDepiction'],
    inputs: 'Catalog Parts, empty shelf, fixed initial painting choice. Photo path accepts your file locally.',
    outputs: 'Disc, recipe, photo, depiction choice, resolved material, art, shelf, Tick and composition receipts.',
  },
  { id: 'explore-shelf', name: 'ExploreShelf', status: 'm accepted · shopping prototype',
    description: 'Recognize the mold, expand its physical copies, pick the exact disc.',
    variants: [{ name: 'Accepted shopping appearance · original', url: './accepted-shelf.html', inspectable: false },
      { name: 'PxC-backed edit loop · integration material', url: './index.html?sandbox=shelf', inspectable: true }],
    source: ['accepted-shelf.html → pinned fairway-shop-to-bag.html', 'shelf-ui.ts · mountShelf', 'model.ts · queryShelf / updateDisc / updateDepiction / keepDisc / createBag'],
    inputs: 'Accepted prototype: its original 50-disc fixture. PxC view: three explicit specimens, retained mold and art.',
    outputs: 'Prototype: exact-copy bag draft in memory. PxC view: candidate Disc, selected shelf reference, depiction switch and checked Bag composition.',
  },
] as const;
