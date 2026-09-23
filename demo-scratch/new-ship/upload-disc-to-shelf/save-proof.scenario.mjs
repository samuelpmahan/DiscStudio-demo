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
    receiptIdentity: typeof receiptAddress === 'string' && receipt?.operationId === 'save-1',
    savedDiscAddress: typeof discAddress === 'string' && /^ds\.px\.disc\.save-1$/.test(discAddress),
    pqlReceiptPresent: Array.isArray(pql),
    pqlCreateAndRead: Array.isArray(pql) && pql.some(row => row.calculation === 'fn.CREATE') && pql.some(row => row.calculation === 'fn.READ'),
    bagContainsSavedDisc: Array.isArray(bag) && bag.includes(discAddress),
    createProducedSavedDisc: Boolean(producer),
    receiptReadback: receipt?.readbackMatched === true && receipt?.bagContainsDisc === true,
  };
  if (Object.values(verified).some(value => !value)) throw Error('Saved PxC proof failed: ' + JSON.stringify(verified));
  window.__dsVisualProof = { fixture: { file: 'deterministic-test-disc-fixture.svg', label: 'TEST FIXTURE ONLY — not a user disc photo' }, savedDiscAddress: discAddress, receiptAddress, pqlReceiptAddress: pqlAddress, bagAddress: receipt.bagAddress, verified };
}
export async function action(page) {
  const fixturePath = path.resolve('visual-proof', 'deterministic-test-disc-fixture.svg');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true }); fs.writeFileSync(fixturePath, svg);
  const photo = await page.$('#photo'); if (!photo) throw Error('Photo input was not mounted.');
  await photo.uploadFile(fixturePath);
  await page.waitForSelector('#photo-crop[open]');
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
}
export async function settle(page) {
  await page.waitForFunction(() => window.__dsVisualProof?.verified?.createProducedSavedDisc === true);
  const receiptAddress = await page.evaluate(() => window.__dsVisualProof.receiptAddress);
  await page.click('.pxdt-nav button:last-child'); await page.waitForSelector('.pxdt:not([hidden])');
  await page.click('.pxdt [data-field="query"]'); await page.type('.pxdt [data-field="query"]', receiptAddress);
  await page.waitForFunction(address => [...document.querySelectorAll('.pxdt [data-view="list"] button')].some(button => button.textContent.includes(address)), {}, receiptAddress);
  await page.evaluate(address => [...document.querySelectorAll('.pxdt [data-view="list"] button')].find(button => button.textContent.includes(address))?.click(), receiptAddress);
  await page.waitForFunction(address => document.querySelector('.pxdt [data-view="title"]')?.textContent === address, {}, receiptAddress);
}
export async function manifest(page) { return page.evaluate(() => window.__dsVisualProof); }
