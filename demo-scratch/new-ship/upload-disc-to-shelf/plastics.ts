// Manufacturer suggestions, not a promise that every mold comes in every blend.
// Curated manufacturer suggestions, checked 2026-09-24. Free text stays valid.
// MVP, Axiom, and Streamline share one suggestion pool, including limited-run
// Particle blends. This is not a mold-specific availability assertion.
const mvpFamilyPlastics = ['Neutron', 'Cosmic Neutron', 'R2 Neutron', 'Proton', 'Plasma', 'Eclipse', 'Total Eclipse', 'Fission', 'Electron', 'Cosmic Electron', 'Prism', 'Particle Glow Proton', 'Particle Eclipse', 'Particle Proton', 'Particle Proton Soft'];
export const plasticGuides: Record<string, { source: string; values: string[] }> = {
  Discraft: { source: 'https://www.team.discraft.com/plastics', values: ['Z', 'ESP', 'Titanium', 'Big Z', 'Jawbreaker', 'Pro D', 'X', 'GLO', 'Z FLX', 'Z Lite'] },
  Innova: { source: 'https://proshop.innovadiscs.com/categories', values: ['Halo Star', 'Halo Champion', 'Star', 'Echo Star', 'GStar', 'Champion', 'Metal Flake', 'Metal Flake Champion', 'Blizzard Champion', 'Proto Glow DX', 'Proto Glow Champion', 'Proto Glow Halo Champion', 'Classic Glow Champion', 'Duo', 'Party Time', 'Moondust Halo Champion', 'Nexus', 'XT', 'Driver Pro', 'KC Pro', 'R-Pro', 'JK Pro', 'DX'] },
  Kastaplast: { source: 'https://www.kastaplast.com/en-us/pages/plastic-guide', values: ['K1', 'K1 Soft', 'K1 Glow', 'K1 Grind', 'K3', 'K3 Hard', 'K3 Glow', 'K1 Hard', 'K4'] },
  MVP: { source: 'https://mvpdiscsports.com/plastics/', values: mvpFamilyPlastics },
  Axiom: { source: 'https://axiomdiscs.com/plastics/', values: mvpFamilyPlastics },
  Streamline: { source: 'https://streamlinediscs.com/plastics/', values: mvpFamilyPlastics },
  'Dynamic Discs': { source: 'https://www.dynamicdiscs.com/pages/disc-golf-plastics', values: ['Supreme', 'Moonshine', 'Fuzion', 'Lucid', 'Lucid Hybrid', 'Lucid Air', 'Lava', 'Fluid', 'BioFuzion', 'Classic', 'Classic Blend', 'Prime'] },
  'Latitude 64': { source: 'https://latitude64.com/collections/river', values: ['BioGold', 'Gold', 'Opto', 'Opto Air', 'Opto Moonshine', 'Opto Orbit', 'Project Grip', 'Retro', 'Zero Gravity', 'Royal Grand'] },
  Discmania: { source: 'https://europe.discmania.net/pages/plastics', values: ['D-Line', 'P-Line', 'C-Line', 'S-Line', 'Color Glow C-Line', 'Metal Flake C-Line', 'Swirl S-Line', 'Special Blend S-Line', 'Exo', 'Neo', 'Lux'] },
  Prodigy: { source: 'https://prodigydisc.com/blogs/news/prodigy-disc-plastics-explained-what-is-the-difference-which-is-the-best', values: ['200', '300', '300 Soft', '300 Firm', '400', '500', '750', 'AIR', 'Special Blend', 'Spectrum', 'GLOW', 'Glimmer'] },
  Westside: { source: 'https://westsidediscs.com/', values: ['VIP', 'VIP-X Orbit', 'Tournament', 'Tournament Orbit', 'BT Medium', 'BT Megasoft'] },
  Gateway: { source: 'https://gatewaydiscsports.com/pages/disc-golf-disc-plastics', values: ['Diamond', 'D-Glow', 'Platinum', 'NXT', 'NXT Lite', 'Pure White', 'Firm', 'SSS', 'Lunar'] },
};
// {?} Mold-specific availability is a separate fact; don't turn suggestions into validation.
