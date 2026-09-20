// Manufacturer suggestions, not a promise that every mold comes in every blend.
// Retrieved from these manufacturer guides on 2026-09-13. Free text stays valid.
export const plasticGuides: Record<string, { source: string; values: string[] }> = {
  Discraft: { source: 'https://www.team.discraft.com/plastics', values: ['Z', 'ESP', 'Titanium', 'Big Z', 'Jawbreaker', 'Pro D', 'X', 'GLO', 'Z FLX', 'Z Lite'] },
  Innova: { source: 'https://www.innovadiscs.com/home/disc-golf-faq/plastic-types-overview/', values: ['Halo Star', 'Star', 'GStar', 'Champion', 'Metal Flake', 'Blizzard Champion', 'Nexus', 'XT', 'Driver Pro', 'KC Pro', 'R-Pro', 'JK Pro', 'DX'] },
  Kastaplast: { source: 'https://www.kastaplast.com/en-us/pages/plastic-guide', values: ['K1', 'K1 Soft', 'K1 Glow', 'K1 Grind', 'K3', 'K3 Hard', 'K3 Glow', 'K1 Hard', 'K4'] },
};
// {?} Mold-specific availability is a separate fact; don't turn suggestions into validation.
