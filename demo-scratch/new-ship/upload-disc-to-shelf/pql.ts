import { Part } from '../part-first-kernel/src/pxc.mjs';

export type PqlBindings = Readonly<Record<string, string | Part>>;
type PqlOperation = 'INSERT' | 'SELECT';
type PqlCalculation = 'fn.CREATE' | 'fn.READ';
type SemanticAddress = string;

export type PqlPlan = Readonly<{
  /** Stable identity for one compiled query shape. */
  id: string;
  template: string;
  operation: PqlOperation;
  calculation: PqlCalculation;
}>;
export type PqlTestimony = Readonly<{
  /** The already-compiled plan that was executed. */
  plan: PqlPlan;
  query: string;
  operation: PqlOperation;
  calculation: PqlCalculation;
  into: string;
  /** Semantic locations supplied for this execution, separate from Part traffic. */
  boundAddresses: Readonly<{ target?: SemanticAddress; source?: SemanticAddress; into: SemanticAddress }>;
  /** The Part/address inputs actually supplied to PxC.compose. */
  actualInputs: readonly Readonly<{ name: string; reference: string }> [];
}>;

const address = '[A-Za-z][A-Za-z0-9_-]*(?:\\.[A-Za-z][A-Za-z0-9_-]*)+';
const semanticAddress = new RegExp(`^${address}$`);

function requireAddress(value: unknown, name: string): SemanticAddress {
  if (typeof value !== 'string' || !semanticAddress.test(value)) throw new Error(`PQL ${name} must be a semantic PxC address.`);
  return value;
}
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
function requireExecutablePlan(plan: PqlPlan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('PQL plan must be a compiled plan object.');
  if (plan.operation === 'INSERT' && plan.calculation === 'fn.CREATE') return;
  if (plan.operation === 'SELECT' && plan.calculation === 'fn.READ') return;
  throw new Error(`Invalid PQL plan ${String(plan.id ?? '(unnamed)')}: ${String(plan.operation)} must use its matching universal calculation.`);
}

/**
 * Frozen creator plans authored as literal compiler output. The creator imports
 * this runtime module only; neither product startup nor save imports a parser.
 */
export const creatorPqlPlans = Object.freeze({
  createDisc: Object.freeze({ id: 'discstudio.creator.create-disc.v1', template: 'INSERT INTO :target VALUES :value', operation: 'INSERT' as const, calculation: 'fn.CREATE' as const }),
  readDisc: Object.freeze({ id: 'discstudio.creator.read-disc.v1', template: 'SELECT * FROM :source', operation: 'SELECT' as const, calculation: 'fn.READ' as const }),
  readIntake: Object.freeze({ id: 'discstudio.creator.read-intake.v1', template: 'SELECT * FROM :source', operation: 'SELECT' as const, calculation: 'fn.READ' as const }),
  readShelf: Object.freeze({ id: 'discstudio.creator.read-shelf.v1', template: 'SELECT * FROM :source', operation: 'SELECT' as const, calculation: 'fn.READ' as const }),
});

/** Execute a frozen plan. This product-runtime path never parses PQL text. */
export async function executePqlPlan(pxc: any, plan: PqlPlan, {
  target,
  source,
  into,
  bindings = {},
}: { target?: string; source?: string; into?: string; bindings?: PqlBindings } = {}): Promise<PqlTestimony> {
  requireExecutablePlan(plan);
  requireBindings(bindings);
  if (plan.operation === 'INSERT') {
    const boundTarget = requireAddress(target, ':target');
    if (!Object.hasOwn(bindings, 'value')) throw new Error('PQL INSERT requires the :value binding.');
    // target is deliberately not part of CREATE inputs; it selects PxC output location.
    await pxc.compose({ into: boundTarget, calculation: plan.calculation, inputs: bindings });
    return Object.freeze({ plan, query: plan.template, operation: plan.operation, calculation: plan.calculation, into: boundTarget,
      boundAddresses: Object.freeze({ target: boundTarget, into: boundTarget }), actualInputs: traffic(bindings) });
  }
  const boundSource = requireAddress(source, ':source');
  const boundInto = requireAddress(into, 'SELECT output');
  await pxc.compose({ into: boundInto, calculation: plan.calculation, inputs: { base: boundSource, own: new Part(Object.freeze({})) } });
  return Object.freeze({ plan, query: plan.template, operation: plan.operation, calculation: plan.calculation, into: boundInto,
    boundAddresses: Object.freeze({ source: boundSource, into: boundInto }),
    actualInputs: Object.freeze([{ name: 'base', reference: boundSource }, { name: 'own', reference: 'inline Part' }]) });
}
