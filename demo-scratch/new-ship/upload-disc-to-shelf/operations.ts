// OnTop operations, not new kernel semantics. Output Parts still get fresh addresses.
export function create({ value = {}, ...fields }: { value?: any; [field: string]: any }) {
  return Object.freeze({ ...value, ...fields });
}
export function read({ base = {}, own }: { base?: any; own: any }) {
  // SELECT * carries an empty overlay. Preserve the addressed Part value
  // exactly, including scalars, typed arrays, and collection identity.
  if (own && !Array.isArray(own) && Object.keys(own).length === 0) return base;
  return Object.freeze({ ...base, ...own });
}
export function update({ value, patch = {}, remove = [] }: { value: any; patch?: any; remove?: string[] }) {
  const next = Object.assign(Array.isArray(value) ? [...value] : { ...value }, patch);
  for (const key of remove) delete next[key];
  return Object.freeze(next);
}
export function destroy({ collection, key }: { collection: Record<string, unknown>; key: string }) {
  return update({ value: collection, remove: [key] });
}

export type Calculation = { into: string; calculation: string; inputs: Record<string, any> };
export type Tick = { into: string; calculations: Calculation[] };
export type Stage = Tick[];
// Each yielded boundary has actual output Parts as inputs, not a second execution model.
export async function* runStage(pxc: any, stage: Stage) {
  for (const tick of stage) {
    if (!tick.calculations.length) throw Error('A Tick needs a Calculation.');
    for (const calculation of tick.calculations) await pxc.compose(calculation);
    await pxc.compose({ into: tick.into, calculation: 'fn.tick', inputs:
      Object.fromEntries(tick.calculations.map(step => [step.into, step.into])) });
    yield tick.into;
  }
}
