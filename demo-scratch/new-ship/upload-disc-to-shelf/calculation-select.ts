import type { Part } from '../part-first-kernel/src/pxc.mjs';

/**
 * A deliberately small structural SELECT contract. Clauses inspect the values
 * of the addressed input Parts and name the registered Calculation to bind.
 * This is ordinary TypeScript code, not a query parser or a new DSL grammar.
 */
export type CalculationSelectClause = Readonly<{
  name: string;
  calculationAddress: string;
  matches: (inputs: Readonly<Record<string, Part>>) => boolean;
}>;

export type CalculationSelection = Readonly<{
  query: string;
  clause: string;
  calculationAddress: string;
  calculation: Part;
  inputPartAddresses: Readonly<Record<string, string>>;
  inputs: Readonly<Record<string, Part>>;
}>;

export function selectCalculation(
  pxc: any,
  query: string,
  clauses: readonly CalculationSelectClause[],
  inputPartAddresses: Readonly<Record<string, string>>,
): CalculationSelection {
  if (typeof query !== 'string' || !query.trim()) throw new TypeError('SELECT needs a named query.');
  if (!Array.isArray(clauses) || clauses.length === 0) throw new TypeError('SELECT needs registered clauses.');
  if (!inputPartAddresses || typeof inputPartAddresses !== 'object' || Array.isArray(inputPartAddresses) || Object.keys(inputPartAddresses).length === 0) {
    throw new TypeError('SELECT needs addressed input Parts.');
  }

  const names = new Set<string>();
  for (const clause of clauses) {
    if (!clause || typeof clause.name !== 'string' || !clause.name.trim() || names.has(clause.name)) throw new Error('SELECT clause names must be unique and non-empty.');
    if (typeof clause.calculationAddress !== 'string' || !clause.calculationAddress.startsWith('fn.') || typeof clause.matches !== 'function') {
      throw new TypeError(`Invalid SELECT clause: ${clause.name}`);
    }
    names.add(clause.name);
  }

  const addresses = Object.freeze(Object.fromEntries(Object.entries(inputPartAddresses).map(([name, address]) => {
    if (!name || typeof address !== 'string' || !address) throw new TypeError('SELECT input Parts need named addresses.');
    return [name, address];
  })));
  const inputs = Object.freeze(Object.fromEntries(Object.entries(addresses).map(([name, address]) => [name, pxc.get(address)])));
  const matched = clauses.filter(clause => clause.matches(inputs));
  if (matched.length === 0) throw new Error(`SELECT ${query} found no matching clause.`);
  if (matched.length > 1) throw new Error(`SELECT ${query} is ambiguous: ${matched.map(clause => clause.name).join(', ')}.`);

  const clause = matched[0];
  const calculation = pxc.get(clause.calculationAddress);
  if (typeof calculation.value !== 'function') throw new TypeError(`SELECT calculation is not callable: ${clause.calculationAddress}`);
  return Object.freeze({
    query,
    clause: clause.name,
    calculationAddress: clause.calculationAddress,
    calculation,
    inputPartAddresses: addresses,
    inputs,
  });
}
