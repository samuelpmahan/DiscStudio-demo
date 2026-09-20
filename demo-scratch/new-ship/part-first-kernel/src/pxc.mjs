// Local experiment: borrowed in-memory material, not persistent snapshots.
const compositions = new WeakMap();

export class Part {
  constructor(value) {
    this.value = value;
    compositions.set(this, null);
    Object.freeze(this);
  }

  get composition() {
    return compositions.get(this);
  }
}

function requirePart(value) {
  if (!compositions.has(value)) throw new TypeError('Expected a Part.');
  return value;
}

export class PxC {
  #parts = new Map();
  #pending = new Set();
  #receipts = [];

  #available(address) {
    if (typeof address !== 'string' || address.length === 0) {
      throw new TypeError('Expected a non-empty local address.');
    }
    if (this.#parts.has(address) || this.#pending.has(address)) {
      throw new Error(`Address is already occupied or in flight: ${address}`);
    }
  }

  set(address, part) {
    this.#available(address);
    this.#parts.set(address, requirePart(part));
    return part;
  }

  get(address) {
    if (!this.#parts.has(address)) throw new Error(`Missing Part: ${String(address)}`);
    return this.#parts.get(address);
  }

  #resolve(reference) {
    return typeof reference === 'string' ? this.get(reference) : requirePart(reference);
  }

  entries() {
    return Object.freeze([...this.#parts].map((entry) => Object.freeze(entry)));
  }

  receipts() {
    return Object.freeze([...this.#receipts]);
  }

  async compose({ into, calculation, inputs = {} }) {
    this.#available(into);
    const selected = this.#resolve(calculation);
    if (typeof selected.value !== 'function') {
      throw new TypeError('The selected Calculation must be a function-valued Part.');
    }
    if (inputs === null || typeof inputs !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(inputs))) {
      throw new TypeError('Expected a named input binding record.');
    }
    const bindings = Object.freeze(Object.fromEntries(
      Object.entries(inputs).map(([name, reference]) => [name, this.#resolve(reference)]),
    ));
    const values = Object.freeze(Object.fromEntries(
      Object.entries(bindings).map(([name, part]) => [name, part.value]),
    ));
    const composition = Object.freeze({ calculation: selected, inputs: bindings });
    // Reserve only after preflight succeeds, before executing any Calculation.
    this.#available(into);
    this.#pending.add(into);
    try {
      const calculate = selected.value;
      const output = new Part(await calculate(values));
      compositions.set(output, composition);
      this.#parts.set(into, output);
      this.#receipts.push(Object.freeze({ status: 'produced', into, composition, output }));
      return output;
    } catch (error) {
      this.#receipts.push(Object.freeze({ status: 'failed', into, composition, error }));
      throw error;
    } finally {
      this.#pending.delete(into);
    }
  }
}
