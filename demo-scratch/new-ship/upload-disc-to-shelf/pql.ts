import { Part } from '../part-first-kernel/src/pxc.mjs';

export type PqlBindings = Readonly<Record<string, string | Part>>;
export type PqlTestimony = Readonly<{
  query: string;
  operation: 'INSERT' | 'SELECT';
  calculation: 'fn.CREATE' | 'fn.READ';
  into: string;
  actualInputs: readonly Readonly<{ name: string; reference: string }> [];
}>;

const address = '[A-Za-z][A-Za-z0-9_-]*(?:\\.[A-Za-z][A-Za-z0-9_-]*)+';
const insert = new RegExp(`^INSERT INTO (${address}) VALUES :value$`);
const select = new RegExp(`^SELECT \\* FROM (${address})$`);

function traffic(bindings: PqlBindings) {
  return Object.freeze(Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right)).map(([name, reference]) => Object.freeze({
    name, reference: typeof reference === 'string' ? reference : 'inline Part',
  })));
}

function requireBindings(bindings: PqlBindings) {
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new TypeError('PQL bindings must be a named record of PxC references.');
  }
}

/**
 * Creator-flow PQL: a deliberately small parameterized SQL-like surface.
 *
 * Supported statements:
 *   INSERT INTO <semantic-address> VALUES :value
 *   SELECT * FROM <semantic-address>
 *
 * INSERT carries `value` plus optional named CREATE fields in bindings. SELECT
 * copies the addressed Part through fn.READ into the caller-supplied output
 * address. Values remain PxC Parts/addresses; they are never interpolated into
 * query text. This facade owns no storage: it compiles directly to PxC.compose.
 */
export async function executePql(pxc: any, query: string, {
  into,
  bindings = {},
}: { into?: string; bindings?: PqlBindings } = {}): Promise<PqlTestimony> {
  if (typeof query !== 'string') throw new TypeError('PQL query must be text.');
  requireBindings(bindings);
  const normalized = query.trim().replace(/\s+/g, ' ');
  const inserted = insert.exec(normalized);
  if (inserted) {
    if (!Object.hasOwn(bindings, 'value')) throw new Error('PQL INSERT requires the :value binding.');
    const target = inserted[1];
    await pxc.compose({ into: target, calculation: 'fn.CREATE', inputs: bindings });
    return Object.freeze({ query: normalized, operation: 'INSERT', calculation: 'fn.CREATE', into: target,
      actualInputs: traffic(bindings) });
  }
  const selected = select.exec(normalized);
  if (selected) {
    if (!into || !new RegExp(`^${address}$`).test(into)) throw new Error('PQL SELECT requires a semantic PxC output address.');
    await pxc.compose({ into, calculation: 'fn.READ', inputs: { base: selected[1], own: new Part(Object.freeze({})) } });
    return Object.freeze({ query: normalized, operation: 'SELECT', calculation: 'fn.READ', into,
      actualInputs: Object.freeze([{ name: 'base', reference: selected[1] }, { name: 'own', reference: 'inline Part' }]) });
  }
  throw new Error(`Unsupported PQL statement: ${normalized || '(empty)'}. Supported: INSERT INTO <semantic address> VALUES :value; SELECT * FROM <semantic address>.`);
}
