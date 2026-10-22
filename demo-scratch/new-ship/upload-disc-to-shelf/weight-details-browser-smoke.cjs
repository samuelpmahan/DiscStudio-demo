const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const here = __dirname;
const dist = path.join(here, 'dist');
const browserPath = path.resolve(here, '../../../../evidence/chrome-runtime-owner/chrome-headless-shell-linux64/chrome-headless-shell');
const receiptPath = path.join(here, 'weight-details-browser-smoke-receipt.json');
const screenshotPath = path.join(here, 'weight-details-browser-smoke.png');
const shelfScreenshotPath = path.join(here, 'weight-details-shelf-browser.png');
const build = JSON.parse(fs.readFileSync(path.join(dist, 'BUILD_INFO.json')));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const checks = [], errors = [], missing = [];
const storageValues = new Map();
const storage = { get length() { return storageValues.size; }, key: i => [...storageValues.keys()][i] ?? null, getItem: key => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value) };

(async () => {
  const { openExperience } = await import('./persistent-experience.ts');
  const { initialDraft } = await import('./model.ts');
  const { sessionKeyPrefix, activeSessionKey } = await import('./session-storage.ts');
  const oldApp = await openExperience(storage, () => {});
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await oldApp.save({ ...initialDraft(), nickname: 'Legacy nickname', plastic: 'ESP', weight: 177 }, { kind: 'photo', src: image, name: 'legacy.png' });
  const oldKey = [...storageValues.keys()].find(key => key.startsWith(sessionKeyPrefix));
  const oldRaw = storageValues.get(oldKey);
  assert.ok(oldRaw.includes('Legacy nickname') && oldRaw.includes('177'), 'fixture contains archived nickname and weight');

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/events') return response.writeHead(204).end();
    const file = path.resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.bin':'application/octet-stream' };
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) missing.push({ status: response.status(), url: response.url() }); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.addInitScript(({ key, archive, pointer }) => { localStorage.setItem(key, archive); localStorage.setItem('discstudio.pxc.active-session.v1', pointer); }, { key: oldKey, archive: oldRaw, pointer: oldKey });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#persistence-status')?.textContent.includes('restored'));
    const restored = await page.evaluate(() => window.discStudio.bag().map(row => row.disc).find(disc => disc.nickname === 'Legacy nickname'));
    assert.equal(restored.weight, 177, 'legacy saved metadata remains readable in the restored model');
    checks.push('normal app restores archived weight and nickname in the saved Disc model');
    assert.equal(await page.locator('#composer #weight').count(), 0);
    assert.equal(await page.locator('#composer').getByLabel(/Weight/i).count(), 0);
    checks.push('creator form has no Weight control');
    const shelfPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    shelfPage.on('pageerror', error => errors.push(error.message));
    shelfPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await shelfPage.goto(url + '?sandbox=shelf');
    await shelfPage.waitForFunction(() => document.querySelectorAll('#shelf .shelf-disc').length === 3, {timeout:5000});
    const shelfText = await shelfPage.locator('#shelf').innerText();
    assert.doesNotMatch(shelfText, /175|172|170|Nickname|Weight/i);
    await shelfPage.locator('.shelf-pick').first().click();
    const selected = await shelfPage.locator('#shelf-selected-description').innerText();
    assert.doesNotMatch(selected, /175|172|170|Nickname|Weight/i);
    checks.push('weighted legacy specimens in Shelf show no Weight or Nickname, including selected details');
    await shelfPage.screenshot({ path: shelfScreenshotPath, fullPage: true });

    const artworkEqual = await page.evaluate(async ({ image }) => {
      const renderer = await import('./browser-card-renderer.js');
      const disc = { id:'legacy', mold:'ds.px.seed.buzzz', nickname:'Legacy nickname', plastic:'ESP', weight:177, speed:5, glide:4, turn:-1, fade:1, depiction:{kind:'photo',src:image,name:'legacy.png'}, renderer:{moldName:'Buzzz',manufacturer:'Discraft',flights:[5,4,-1,1]} };
      const withWeight = await renderer.renderCardBlob(disc, 'vertical', 'u02');
      const withoutWeight = await renderer.renderCardBlob({ ...disc, weight:null }, 'vertical', 'u02');
      const [a,b] = await Promise.all([withWeight.arrayBuffer(), withoutWeight.arrayBuffer()]);
      if (a.byteLength !== b.byteLength) return false;
      const x = new Uint8Array(a), y = new Uint8Array(b);
      return x.every((byte,index) => byte === y[index]);
    }, { image });
    assert.equal(artworkEqual, true, 'legacy weighted and weightless card artwork must be byte-identical');
    checks.push('browser U02 export for archived weight is byte-identical to weightless artwork');

    await page.locator('[data-sample-id="discraft--buzzz-ss"]').click();
    await page.locator('#photo-crop[open]').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.circle-candidate').length > 0);
    await page.locator('.circle-candidate').first().click();
    await page.locator('#crop-apply').click();
    await page.waitForFunction(() => !document.querySelector('#photo-crop').open && !document.querySelector('#save').disabled);
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Saved to Today’s Bag'));
    const persisted = await page.evaluate(() => localStorage.getItem(localStorage.getItem('discstudio.pxc.active-session.v1')));
    const archive = JSON.parse(persisted);
    const encodedNullWeights = archive.nodes.filter(node => node.material?.object?.some(([key]) => key === 'weight')).filter(node => node.material.object.some(([key,value]) => key === 'weight' && value.scalar === null));
    assert.ok(encodedNullWeights.length >= 1, 'new UI draft is archived with weight null');
    assert.ok(persisted.includes('Legacy nickname') && persisted.includes('177'), 'old archived metadata stays backward compatible after a new save');
    checks.push('sample fit and save writes weight:null while preserving the old archived weight/nickname');
    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const receipt = { schema:'discstudio-weight-details-browser-smoke@1', verdict:'PASS', buildId:build.buildId, sourceId:build.sourceId, outputId:build.outputId, browser:'Chrome for Testing headless shell 154.0.8037.57', checks, pageErrors:errors, missingResources:missing, screenshots:[{path:path.basename(screenshotPath),sha256:sha(fs.readFileSync(screenshotPath))},{path:path.basename(shelfScreenshotPath),sha256:sha(fs.readFileSync(shelfScreenshotPath))}], archivedFixture:{weight:177,nickname:'Legacy nickname',restored:true} };
    fs.writeFileSync(receiptPath, JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt,null,2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
