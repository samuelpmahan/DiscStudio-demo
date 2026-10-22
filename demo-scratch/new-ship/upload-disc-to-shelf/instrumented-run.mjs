// Automatic render instrumentation for Experience 1.
// Usage: node --experimental-strip-types instrumented-run.mjs
// Runs the model through the golden steps. After each Tick, renders the
// current state to HTML and screenshots it via shot.mjs. No manual prints.

import { createExperience } from './model.ts';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const RENDER_DIR = './renders';
fs.mkdirSync(RENDER_DIR, { recursive: true });

let step = 0;

function safeGet(pxc, address) {
  try { return pxc.get(address); } catch { return null; }
}

function renderState(app, label, withPxCube) {
  step++;
  const shelf = app.shelf();
  const hasPhoto = !!safeGet(app.pxc, 'ds.px.draft.photo');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
body { font-family: system-ui; margin: 0; padding: 24px; background: #fafafa; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.header h1 { margin: 0; font-size: 24px; }
.pxcube { background: #1a1a2e; color: #eee; padding: 16px; border-radius: 8px; margin-bottom: 24px; font-family: monospace; font-size: 12px; }
.pxcube h3 { margin: 0 0 8px 0; color: #7df9ff; }
.form { background: white; padding: 20px; border-radius: 8px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.disc { background: white; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.disc img { width: 100%; border-radius: 4px; }
.empty { color: #999; text-align: center; padding: 40px; }
</style></head><body>
<div class="header"><h1>Disc Studio · Experience 01</h1><span>${label}</span></div>
${withPxCube ? `<div class="pxcube"><h3>PxCube Inspector</h3>
<div>ds.px.draft.photo: ${hasPhoto ? 'present' : 'empty'}</div>
<div>ds.px.shelf: ${shelf.length} disc(s)</div>
<div>Events: ${app.events.length}</div>
</div>` : ''}
<div class="form">
<h2>Add a disc</h2>
<p>Mold search, photo upload, plastic/weight/colors, save button would be here.</p>
<p><em>State: ${hasPhoto ? 'Photo uploaded' : 'No photo yet'}</em></p>
</div>
<h2>Your shelf (${shelf.length})</h2>
<div class="shelf">
${shelf.length === 0 ? '<div class="empty">Your first disc belongs here.</div>' :
  shelf.map(({ disc }) => `<div class="disc">
    ${disc.depiction?.src ? `<img src="${disc.depiction.src}" alt="disc photo">` : ''}
    <h3>${disc.nickname || disc.mold || 'Untitled'}</h3>
    <p>${disc.plastic || ''} ${disc.weight || ''}g</p>
  </div>`).join('')}
</div>
</body></html>`;

  const htmlPath = path.resolve(RENDER_DIR, `step${step}-${label.replace(/\s+/g, '-').toLowerCase()}-${withPxCube ? 'with' : 'without'}-pxcube.html`);
  const pngPath = htmlPath.replace('.html', '.png');
  fs.writeFileSync(htmlPath, html);

  // Screenshot via shot.mjs (direct puppeteer, no browser task)
  // shot.mjs does 'file://' + src, so src must be absolute
  try {
    execSync(`node ~/workspace/card-recipes/.shot-tool/shot.mjs "${htmlPath}" "${pngPath}" 1280 800`, { stdio: 'pipe' });
    console.log(`Rendered: ${pngPath}`);
  } catch (e) {
    console.log(`Screenshot failed for ${label}: ${e.message.split('\n')[0]}`);
  }
}

// Instrumented log: after each major event, render both modes
function instrumentedLog(app) {
  return (event) => {
    // console.log(JSON.stringify(event)); // original log behavior
    if (event.event === 'disc.save.completed' || event.event === 'photo.uploaded') {
      const label = event.event === 'disc.save.completed' ? 'disc-saved' : 'photo-uploaded';
      renderState(app, label, true);   // with PxCube
      renderState(app, label, false);  // without PxCube
    }
  };
}

async function run() {
  console.log('Starting instrumented run...');

  // We'll create the app with our instrumented log after creation
  // (need app reference in the log closure)
  let app;
  const log = (event) => {
    if (app && (event.event === 'disc.save.completed' || event.event === 'photo.uploaded')) {
      const label = event.event === 'disc.save.completed' ? 'disc-saved' : 'photo-uploaded';
      renderState(app, label, true);
      renderState(app, label, false);
    }
  };

  app = createExperience(log);

  // Step 1: Initial state
  renderState(app, 'initial', true);
  renderState(app, 'initial', false);

  // Step 2: Upload photo
  const photo = { kind: 'photo', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', name: 'test.png' };
  await app.addDraftPhoto(photo);
  // Manually trigger render (event name might differ)
  renderState(app, 'photo-uploaded', true);
  renderState(app, 'photo-uploaded', false);

  // Step 3: Select depiction
  const depiction = await app.selectDraftDepiction();

  // Step 4: Save disc
  const { initialDraft } = await import('./model.ts');
  const draft = { ...initialDraft(), mold: 'ds.px.seed.buzzz', nickname: 'Test Disc', plastic: 'ESP', weight: 177 };
  await app.save(draft, depiction);
  renderState(app, 'disc-saved', true);
  renderState(app, 'disc-saved', false);

  console.log('Done. Renders in', RENDER_DIR);
}

run().catch(e => { console.error(e); process.exit(1); });
