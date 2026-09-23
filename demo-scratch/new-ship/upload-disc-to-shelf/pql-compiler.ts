import { executePqlPlan, type PqlBindings, type PqlPlan, type PqlTestimony } from './pql.ts';

const address = '[A-Za-z][A-Za-z0-9_-]*(?:\\.[A-Za-z][A-Za-z0-9_-]*)+';
const insertTemplate = /^INSERT INTO :target VALUES :value$/;
const selectTemplate = /^SELECT \* FROM :source$/;
const insert = new RegExp(`^INSERT INTO (${address}) VALUES :value$`);
const select = new RegExp(`^SELECT \\* FROM (${address})$`);

function normalize(query: string) {
  if (typeof query !== 'string') throw new TypeError('PQL query must be text.');
  return query.trim().replace(/\s+/g, ' ');
}

/** Compiler/workbench seam. It is intentionally absent from the creator runtime graph. */
export function compilePql(template: string, id = normalize(template)): PqlPlan {
  const query = normalize(template);
  if (insertTemplate.test(query)) return Object.freeze({ id, template: query, operation: 'INSERT', calculation: 'fn.CREATE' });
  if (selectTemplate.test(query)) return Object.freeze({ id, template: query, operation: 'SELECT', calculation: 'fn.READ' });
  throw new Error(`Unsupported PQL template: ${query || '(empty)'}. Supported: INSERT INTO :target VALUES :value; SELECT * FROM :source.`);
}

/** Ad-hoc text compatibility facade; creator actions do not import this module. */
export async function executePql(pxc: any, query: string, {
  into,
  bindings = {},
}: { into?: string; bindings?: PqlBindings } = {}): Promise<PqlTestimony> {
  const normalized = normalize(query);
  const inserted = insert.exec(normalized);
  if (inserted) return executePqlPlan(pxc, compilePql('INSERT INTO :target VALUES :value'), { target: inserted[1], bindings });
  const selected = select.exec(normalized);
  if (selected) return executePqlPlan(pxc, compilePql('SELECT * FROM :source'), { source: selected[1], into, bindings });
  throw new Error(`Unsupported PQL statement: ${normalized || '(empty)'}. Supported: INSERT INTO <semantic address> VALUES :value; SELECT * FROM <semantic address>.`);
}
