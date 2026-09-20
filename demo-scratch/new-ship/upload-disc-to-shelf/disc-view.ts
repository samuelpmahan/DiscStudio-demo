import { flightFields, type Draft, type Depiction, type createExperience } from './model.ts';
import { renderDiscPainting, colorBackground } from './paint.ts';

export function createDiscView(experience: ReturnType<typeof createExperience>) {
function discView(material: Draft, image: Depiction, savedArt?: string) {
  const seed = experience.seedAt(material.mold);
  const figure = document.createElement('figure');
  const art = document.createElement('div'); art.className = `disc-art${image.kind === 'photo' ? ' photo-art' : ''}`; if (image.kind !== 'photo') art.style.background = colorBackground(material);
  const img = document.createElement('img'); img.src = savedArt ?? renderDiscPainting({ draft: material, depiction: image }); img.alt = `${image.kind === 'photo' ? 'Photo' : 'Painting'} of ${seed.manufacturer} ${seed.name}`; art.append(img);
  const title = document.createElement('h3'); title.textContent = seed.name;
  const resolved = experience.resolve(material);
  const facts = document.createElement('p'); facts.textContent = [seed.manufacturer, seed.name, material.plastic, material.weight == null ? '' : `${material.weight} g`, flightFields.map(field => resolved[field] ?? '?').join(' / ')].filter(Boolean).join(' · ');
  title.textContent = material.nickname || seed.name;
  figure.append(title, art, facts); return figure;
}
return discView;
}
