// Inspection is derived from actual compositions, not stored in Part definitions.
export function contributorsOf(part) {
  if (!part.composition) return [];
  return [
    { role: 'calculation', part: part.composition.calculation },
    ...Object.entries(part.composition.inputs).map(([name, input]) => ({
      role: 'input', name, part: input,
    })),
  ];
}

export function usesOf(pxc, part) {
  return pxc.entries().flatMap(([address, output]) => {
    const contributions = contributorsOf(output).filter((entry) => entry.part === part);
    return contributions.length ? [{ address, part: output, contributions }] : [];
  });
}
