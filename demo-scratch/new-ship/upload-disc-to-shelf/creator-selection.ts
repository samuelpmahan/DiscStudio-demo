export type CreatorSelection = { active: string; checked: Set<string> };

/** Keep preview and batch membership independent, but never leave a checked
 * card without a preview when there is no active card. */
export function reconcileCreatorSelection(addresses: readonly string[], selection: CreatorSelection, activateFirst = false): CreatorSelection {
  const available = new Set(addresses);
  const checked = new Set([...selection.checked].filter(address => available.has(address)));
  let active = available.has(selection.active) ? selection.active : '';
  if (!active) active = addresses.find(address => checked.has(address)) ?? '';
  if (!active && activateFirst && addresses.length) { active = addresses[0]; checked.add(active); }
  return { active, checked };
}

export function setReviewMembership(addresses: readonly string[], selection: CreatorSelection, address: string, included: boolean): CreatorSelection {
  if (!addresses.includes(address)) return reconcileCreatorSelection(addresses, selection);
  const checked = new Set(selection.checked);
  if (included) checked.add(address);
  else checked.delete(address);
  const active = !included && selection.active === address ? '' : selection.active;
  return reconcileCreatorSelection(addresses, { active: included && !active ? address : active, checked });
}
