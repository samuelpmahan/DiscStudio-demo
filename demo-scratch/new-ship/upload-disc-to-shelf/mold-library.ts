import { moldCatalogVersion, packedMoldIndex, moldRuntimeAvailable, moldRuntimeError, type PackedMold } from './mold-runtime-index.ts';

export type LiteMold = PackedMold;
export type { MoldProvenanceRef } from './mold-runtime-index.ts';
export const catalogVersion = moldCatalogVersion;
export const catalogSourceSha256 = packedMoldIndex.sourceCatalogSha256;
export { moldRuntimeAvailable, moldRuntimeError };

/** Search the compiled mold-name trie, with manufacturer-first filtering. */
export function searchMolds(query: string, limit = 12): PackedMold[] {
  return packedMoldIndex.search(query, limit);
}

/** Read one packed record by its durable catalog ID; this does not create a PxC Part. */
export function moldRecord(id: string): PackedMold | null {
  return packedMoldIndex.recordForId(id);
}

/** Card renderers keep their existing async contract without loading catalog.ts. */
export async function getMoldDetails(id: string): Promise<PackedMold | null> {
  return moldRecord(id);
}
