// Render the 5 Upright SpotlightCard presets plus U02's optional-detail comparison.
// Run: node --experimental-strip-types render-presets.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { renderCard } from './card-renderer.ts';

/** Synthetic disc photo: acid-green disc with shading, inner ring, stamp. */
function makeTestPhoto() {
  const s = 640;
  const c = createCanvas(s, s);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s * 0.38, s * 0.34, 40, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#e4ff70');
  g.addColorStop(0.55, '#c8f23d');
  g.addColorStop(1, '#7fa32a');
  x.fillStyle = g;
  x.beginPath();
  x.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = 'rgba(20,30,10,0.35)';
  x.lineWidth = 10;
  x.beginPath();
  x.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = 'rgba(20,30,10,0.55)';
  x.textAlign = 'center';
  x.font = '900 84px sans-serif';
  x.fillText('BUZZZ', s / 2, s * 0.47);
  x.font = '600 30px sans-serif';
  x.fillText('ESP', s / 2, s * 0.57);
  return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
}

const disc = {
  id: 'disc-buzzz-1',
  mold: 'ds.px.seed.buzzz',
  nickname: 'Workhorse',
  plastic: '',
  weight: null,
  renderer: { moldName: 'Buzzz', flights: [5, 4, -1, 1] },
  depiction: { kind: 'photo', src: makeTestPhoto(), name: 'buzzz.png' },
};

mkdirSync('./mvp-output', { recursive: true });
for (const p of ['u01', 'u02', 'u03', 'u04', 'u05']) {
  const buf = await renderCard(disc, 'vertical', p);
  const path = `./mvp-output/preset-${p}-blank-plastic.png`;
  writeFileSync(path, buf);
  console.log(p, buf.length, 'bytes ->', path);
}
const optionalDetailDisc = { ...disc, plastic: 'ESP', weight: 177, depiction: { ...disc.depiction, src: makeTestPhoto() } };
const detail = await renderCard(optionalDetailDisc, 'vertical', 'u02');
const detailPath = './mvp-output/preset-u02-with-plastic.png';
writeFileSync(detailPath, detail);
console.log('u02 optional detail', detail.length, 'bytes ->', detailPath);
console.log('done');

// U3 remains a visible Compare, with composition mirrored without flipping
// photo/glyph pixels. These native assets are reproducible evidence, excluded
// from SmartSync; only this recipe is retained.
const { loadImage } = await import('@napi-rs/canvas');
const { readFileSync } = await import('node:fs');
const whiteCanvas=createCanvas(640,640),white=whiteCanvas.getContext('2d');white.fillStyle='#fff';white.beginPath();white.arc(320,320,320,0,Math.PI*2);white.fill();white.fillStyle='#1b1b1b';white.font='bold 82px sans-serif';white.textAlign='center';white.fillText('CRAVE →',320,320);white.font='24px sans-serif';white.fillText('WHITE DISC',320,370);
const whitePhoto=`data:image/png;base64,${whiteCanvas.toBuffer('image/png').toString('base64')}`;
writeFileSync('./mvp-output/white-disc-photo.png',whiteCanvas.toBuffer('image/png'));
const sceneBackground=await loadImage(readFileSync('./sample-background.svg'));
const alphaReceipts=[];
for (const kind of ['white','green']) {
 const fixture={...disc,plastic:'ESP',renderer:{moldName:'Crave',manufacturer:'Axiom',flights:[6.5,5,-1,1]},depiction:{kind:'photo',src:kind==='white'?whitePhoto:makeTestPhoto(),name:`${kind}.png`}};
 for(const preset of ['u03-front','u03-behind','u03-front-mirror','u03-behind-mirror','u04']) {
  const png=await renderCard(fixture,'vertical',preset);writeFileSync(`./mvp-output/${preset}-${kind}-transparent.png`,png);
  const overlay=await loadImage(png);
  const alphaCanvas=createCanvas(1080,1920),alphaCtx=alphaCanvas.getContext('2d');alphaCtx.drawImage(overlay,0,0);const rgba=alphaCtx.getImageData(0,0,1080,1920).data,bounds=[1080,1920,0,0];let visible=0;for(let y=0;y<1920;y++)for(let x=0;x<1080;x++)if(rgba[(y*1080+x)*4+3]){visible++;bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x+1);bounds[3]=Math.max(bounds[3],y+1);}if(bounds[0]<=0||bounds[1]<=0||bounds[2]>=1080||bounds[3]>=1920)throw Error('Card alpha hits native canvas boundary');alphaReceipts.push({preset,kind,width:1080,height:1920,alphaBounds:bounds,visiblePixels:visible,transparentPixels:1080*1920-visible});
  for(const background of ['scene','light','dark']) {const canvas=createCanvas(1080,1920),ctx=canvas.getContext('2d');if(background==='scene')ctx.drawImage(sceneBackground,0,0,1080,1920);else{ctx.fillStyle=background==='light'?'#eee':'#232323';ctx.fillRect(0,0,1080,1920);}ctx.drawImage(overlay,0,0);writeFileSync(`./mvp-output/${preset}-${kind}-${background}.png`,canvas.toBuffer('image/png'));}
 }
}

writeFileSync('./mvp-output/u3-u4-alpha-receipt.json',JSON.stringify({schema:'discstudio-u3-u4-alpha-evidence@1',comparison:'Compare',selected:null,frames:alphaReceipts},null,2)+'\n');
