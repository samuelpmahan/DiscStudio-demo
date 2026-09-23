import fs from 'node:fs';
import path from 'node:path';

export const label = 'creator-save-real-ui';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#eff4eb"/><circle cx="256" cy="256" r="192" fill="#f4a41d" stroke="#193d35" stroke-width="20"/><circle cx="256" cy="256" r="132" fill="#204e3e"/><text x="256" y="245" text-anchor="middle" fill="white" font-family="sans-serif" font-size="38">TEST</text><text x="256" y="292" text-anchor="middle" fill="white" font-family="sans-serif" font-size="26">FIXTURE ONLY</text></svg>';

async function waitText(page, selector, source) {
  await page.waitForFunction((selector, source) => new RegExp(source).test(document.querySelector(selector)?.textContent || ''), {}, selector, source);
}
function recordEvidence() {
  const experience = window.__dsExperience;
  if (!experience) throw Error('Capture instrumentation did not expose the mounted Experience.');
  const entries = new Map(experience.pxc.entries());
  const [receiptAddress, receiptPart] = [...entries].filter(([address]) => /^ds\.px\.receipt\.save-/.test(address)).at(-1) || [];
  const receipt = receiptPart?.value, discAddress = receipt?.discAddress, pqlAddress = discAddress ? 'ds.px.receipt.pql.' + receipt.operationId : '';
  const pql = entries.get(pqlAddress)?.value, bag = entries.get(receipt?.bagAddress)?.value;
  const producer = experience.pxc.receipts().find(row => row.into === discAddress && row.status === 'produced' && row.composition.calculation === experience.pxc.get('fn.CREATE'));
  const verified = {
    receiptIdentity: typeof receiptAddress === 'string' && receiptAddress === 'ds.px.receipt.' + receipt?.operationId && /^save-/.test(receipt?.operationId || ''),
    savedDiscAddress: discAddress === 'ds.px.disc.crave-1' && entries.get(discAddress)?.value?.id === 'crave-1',
    pqlReceiptPresent: Array.isArray(pql),
    pqlCreateAndRead: Array.isArray(pql) && pql.some(row => row.calculation === 'fn.CREATE') && pql.some(row => row.calculation === 'fn.READ'),
    bagContainsSavedDisc: Array.isArray(bag) && bag.includes(discAddress),
    createProducedSavedDisc: Boolean(producer),
    receiptReadback: receipt?.readbackMatched === true && receipt?.bagContainsDisc === true,
  };
  if (Object.values(verified).some(value => !value)) throw Error('Saved PxC proof failed: ' + JSON.stringify(verified));
  window.__dsVisualProof = { fixture: { file: 'deterministic-test-disc-fixture.svg', label: 'TEST FIXTURE ONLY — not a user disc photo' }, savedDiscAddress: discAddress, receiptAddress, pqlReceiptAddress: pqlAddress, bagAddress: receipt.bagAddress, depictionSrc: entries.get(discAddress)?.value?.depiction?.src, verified };
}
function verifyVisibleBagAndFrame() {
  const proof = window.__dsVisualProof;
  const bag = document.querySelector('#todays-bag');
  const rows = [...document.querySelectorAll('#bag-export-list .bag-export-disc')];
  const matching = rows.find(row => row.textContent.includes('Crave') && row.querySelector('img')?.src === proof.depictionSrc);
  proof.verified.uiBagMatchesSavedDisc = Boolean(matching);
  if (!matching) throw Error('Visible Today’s Bag row does not match the saved Disc Part.');
  const frameBag = () => bag?.scrollIntoView({ block: 'start' });
  // The paired runner opens the drawer after the closed capture. Preserve the
  // same underlying Bag framing when that real navigation control is clicked.
  const drawerButton = document.querySelector('.pxdt-nav button:last-child');
  if (drawerButton && !drawerButton.dataset.captureFrame) {
    drawerButton.dataset.captureFrame = 'bag';
    drawerButton.addEventListener('click', frameBag);
  }
  frameBag();
}
export async function action(page) {
  const fixturePath = path.resolve('visual-proof', 'deterministic-test-disc-fixture.svg');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true }); fs.writeFileSync(fixturePath, svg);
  const photo = await page.$('#photo'); if (!photo) throw Error('Photo input was not mounted.');
  await photo.uploadFile(fixturePath);
  await page.waitForSelector('#photo-crop[open]');
  // A test fixture does not claim to be a detected real disc. Use the visible
  // manual-crop disclosure, then the same Apply control a creator uses.
  await page.click('#crop-manual summary');
  await page.waitForFunction(() => !document.querySelector('#crop-apply')?.disabled, { timeout: 15000 });
  await page.click('#crop-apply'); await page.waitForFunction(() => !document.querySelector('#photo-crop')?.open);
  await waitText(page, '#photo-status', 'Photo ready');
  await page.click('#mold-search'); await page.type('#mold-search', 'Crave');
  await page.waitForSelector('#mold-option-0:not([hidden])');
  const moldText = await page.$eval('#mold-option-0', node => node.textContent || '');
  if (!/Crave/.test(moldText)) throw Error('Visible catalog option was not Crave: ' + moldText);
  await page.click('#mold-option-0'); await page.waitForFunction(() => Boolean(document.querySelector('#seed')?.value));
  const plastic = await page.$eval('#plastic', select => [...select.options].find(option => option.value)?.value || '');
  if (!plastic) throw Error('The selected mold has no visible plastic choice.'); await page.select('#plastic', plastic);
  await page.click('#save'); await waitText(page, '#status', 'Saved to Today’s Bag|Added to Today’s Bag');
  await page.evaluate(recordEvidence);
  await page.waitForFunction(() => document.querySelectorAll('#bag-export-list .bag-export-disc').length > 0);
  await page.evaluate(verifyVisibleBagAndFrame);
}
export async function settle(page) {
  await page.waitForFunction(() => window.__dsVisualProof?.verified?.createProducedSavedDisc === true);
  const receiptAddress = await page.evaluate(() => window.__dsVisualProof.receiptAddress);
  await page.evaluate(() => document.querySelector('.pxdt-nav button:last-child')?.click()); await page.waitForSelector('.pxdt:not([hidden])');
  await page.click('.pxdt [data-field="query"]'); await page.type('.pxdt [data-field="query"]', receiptAddress);
  await page.waitForFunction(address => [...document.querySelectorAll('.pxdt [data-view="list"] button')].some(button => button.textContent.includes(address)), {}, receiptAddress);
  await page.evaluate(address => [...document.querySelectorAll('.pxdt [data-view="list"] button')].find(button => button.textContent.includes(address))?.click(), receiptAddress);
  await page.waitForFunction(address => document.querySelector('.pxdt [data-view="title"]')?.textContent === address, {}, receiptAddress);
  await page.waitForFunction(() => {
    const summary = document.querySelector('.pxdt-save-summary');
    return summary?.textContent?.includes('Saved Axiom Crave') && summary.textContent.includes('Today’s Bag') &&
      summary.textContent.includes('added') && [...summary.querySelectorAll('button')].some(button => button.textContent.includes('fn.CREATE')) &&
      [...summary.querySelectorAll('button')].some(button => button.textContent.includes('PQL receipt'));
  });
  await page.evaluate(() => document.querySelector('#todays-bag')?.scrollIntoView({ block: 'start' }));
}
export async function beforeScreenshot(page, view) {
  await page.evaluate(view => {
    const proof = window.__dsVisualProof, row = [...document.querySelectorAll('#bag-export-list .bag-export-disc')].find(row => row.textContent.includes('Crave') && row.querySelector('img')?.src === proof.depictionSrc);
    if (!row) throw Error('Saved Today’s Bag row disappeared before ' + view + ' capture.');
    const box = row.getBoundingClientRect();
    if (box.top < 0 || box.bottom > innerHeight) throw Error('Saved Today’s Bag row is outside the ' + view + ' screenshot.');
    if (view === 'inspector') {
      const summary = document.querySelector('.pxdt-save-summary');
      if (!summary?.textContent?.includes('Saved Axiom Crave') || !summary.textContent.includes('ds.px.disc.crave-1') || !summary.textContent.includes('Readback:')) throw Error('Semantic Save summary vanished before drawer capture.');
    }
  }, view);
  // This is deliberately last: the PNG is taken only while the saved Bag row
  // is still inside the viewport after all drawer material has rendered.
  await page.waitForFunction(() => {
    const proof = window.__dsVisualProof, row = [...document.querySelectorAll('#bag-export-list .bag-export-disc')].find(row => row.textContent.includes('Crave') && row.querySelector('img')?.src === proof.depictionSrc);
    if (!row) return false;
    const box = row.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight && document.elementFromPoint(box.left + 8, box.top + 8)?.closest('.bag-export-disc') === row;
  });
}
export async function verifyCaptureFiles({ creatorPath, inspectorPath }) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const [creator, inspector] = await Promise.all([loadImage(creatorPath), loadImage(inspectorPath)]);
  const rect = { x: 120, y: 150, width: 280, height: 90 };
  const pixels = image => {
    const canvas = createCanvas(rect.width, rect.height), context = canvas.getContext('2d');
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return context.getImageData(0, 0, rect.width, rect.height).data;
  };
  const [closed, open] = [pixels(creator), pixels(inspector)];
  let total = 0; for (let index = 0; index < closed.length; index++) total += Math.abs(closed[index] - open[index]);
  const meanDifference = total / closed.length;
  const inkPixels = data => {
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 25 || Math.max(red, green, blue) < 180) count++;
    }
    return count;
  };
  const [closedInk, openInk] = [inkPixels(closed), inkPixels(open)];
  if (closedInk < 500 || openInk < 500) throw Error('Saved Bag crop is visually blank (closed/open ink pixels ' + closedInk + '/' + openInk + ').');
  if (meanDifference > 1) throw Error('Saved Bag row pixels differ between closed and open captures (mean RGB delta ' + meanDifference.toFixed(2) + ').');
}
export async function manifest(page) {
  return page.evaluate(() => {
    const { depictionSrc, ...evidence } = window.__dsVisualProof;
    return evidence;
  });
}
