const fixture = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
  '<rect width="512" height="512" fill="#eff4eb"/><circle cx="256" cy="256" r="192" fill="#f4a41d" stroke="#193d35" stroke-width="20"/>' +
  '<circle cx="256" cy="256" r="132" fill="#204e3e"/><text x="256" y="245" text-anchor="middle" fill="white" font-family="sans-serif" font-size="38">TEST</text>' +
  '<text x="256" y="292" text-anchor="middle" fill="white" font-family="sans-serif" font-size="26">FIXTURE ONLY</text></svg>'
);

async function waitText(page, selector, pattern) {
  await page.waitForFunction((selector, source) => new RegExp(source).test(document.querySelector(selector)?.textContent || ''), {}, selector, pattern.source);
}
async function savedEvidence(page) {
  return page.evaluate(() => {
    const experience = window.__dsExperience;
    if (!experience) throw Error('Capture instrumentation did not expose the mounted Experience.');
    const entries = new Map(experience.pxc.entries());
    const receiptEntries = [...entries].filter(([address]) => /^ds\.px\.receipt\.save-/.test(address));
    const [receiptAddress, receiptPart] = receiptEntries.at(-1) || [];
    const receipt = receiptPart?.value;
    const discAddress = receipt?.discAddress;
    const pqlAddress = discAddress ? 'ds.px.receipt.pql.' + receipt.operationId : '';
    const pql = entries.get(pqlAddress)?.value;
    const bag = entries.get(receipt?.bagAddress)?.value;
    const producer = experience.pxc.receipts().find(row =>
      row.into === discAddress &&
      row.status === 'succeeded' &&
      (row.composition.calculation?.value === 'fn.CREATE' || row.composition.calculation === 'fn.CREATE')
    );
    const checks = {
      receiptIdentity: typeof receiptAddress === 'string' && receipt?.operationId === 'save-1',
      savedDiscAddress: typeof discAddress === 'string' && /^ds\.px\.disc\.save-1$/.test(discAddress),
      pqlReceiptPresent: typeof pqlAddress === 'string' && Array.isArray(pql),
      pqlCreateAndRead: Array.isArray(pql) && pql.some(row => row.calculation === 'fn.CREATE') && pql.some(row => row.calculation === 'fn.READ'),
      bagContainsSavedDisc: Array.isArray(bag) && bag.includes(discAddress),
      createProducedSavedDisc: Boolean(producer),
      receiptReadback: receipt?.readbackMatched === true && receipt?.bagContainsDisc === true,
    };
    if (Object.values(checks).some(value => !value)) throw Error('Saved PxC proof failed: ' + JSON.stringify(checks));
    return { discAddress, receiptAddress, pqlAddress, bagAddress: receipt.bagAddress, checks };
  });
}

export async function run({ page, url, out, fs, path }) {
  const target = new URL(url);
  target.searchParams.set('instrument', '1');
  await page.goto(target.href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__dsScreenshotReady === true);

  const fixturePath = path.join(out, 'deterministic-test-disc-fixture.svg');
  fs.writeFileSync(fixturePath, fixture);
  const photo = await page.$('#photo');
  if (!photo) throw Error('Photo input was not mounted.');
  await photo.uploadFile(fixturePath);
  await page.waitForSelector('#photo-crop[open]');
  await page.waitForFunction(() => {
    const apply = document.querySelector('#crop-apply');
    return apply && !apply.disabled;
  }, { timeout: 15000 });
  await page.click('#crop-apply');
  await page.waitForFunction(() => !document.querySelector('#photo-crop')?.open);
  await waitText(page, '#photo-status', /Photo ready/);

  await page.click('#mold-search');
  await page.type('#mold-search', 'Crave');
  await page.waitForSelector('#mold-option-0:not([hidden])');
  const moldText = await page.$eval('#mold-option-0', node => node.textContent || '');
  if (!/Crave/.test(moldText)) throw Error('Visible catalog option was not the deterministic Crave mold: ' + moldText);
  await page.click('#mold-option-0');
  await page.waitForFunction(() => Boolean(document.querySelector('#seed')?.value));
  const plastic = await page.$eval('#plastic', select => [...select.options].find(option => option.value)?.value || '');
  if (!plastic) throw Error('The selected mold supplied no visible plastic option.');
  await page.select('#plastic', plastic);

  const ticket = await page.evaluate(() => window.__dsScreenshot.begin('real-ui-save-deterministic-test-fixture'));
  await page.click('#save');
  await waitText(page, '#status', /(Saved to Today’s Bag|Added to Today’s Bag)/);
  const proof = await savedEvidence(page);
  const settled = await page.evaluate(ticket => window.__dsScreenshot.settle(ticket), ticket);
  if (settled.settledEvent < settled.afterEvent) throw Error('Invalid settled event sequence.');
  await page.screenshot({ path: path.join(out, 'save-demo.png'), fullPage: false });

  const devtoolsButton = await page.$('.pxdt-nav button:last-child');
  if (!devtoolsButton) throw Error('PxC drawer control was not mounted.');
  await devtoolsButton.click();
  await page.waitForSelector('.pxdt:not([hidden])');
  await page.click('.pxdt [data-field="query"]');
  await page.type('.pxdt [data-field="query"]', proof.receiptAddress);
  await page.waitForFunction(address => [...document.querySelectorAll('.pxdt [data-view="list"] button')].some(button => button.textContent.includes(address)), {}, proof.receiptAddress);
  await page.evaluate(address => [...document.querySelectorAll('.pxdt [data-view="list"] button')].find(button => button.textContent.includes(address))?.click(), proof.receiptAddress);
  await page.waitForFunction(address => document.querySelector('.pxdt [data-view="title"]')?.textContent === address, {}, proof.receiptAddress);
  await page.screenshot({ path: path.join(out, 'save-drawer.png'), fullPage: false });

  return {
    schema: 'discstudio.visual-proof.v1',
    action: 'Save deterministic test fixture through normal creator UI',
    fixture: { file: 'deterministic-test-disc-fixture.svg', label: 'TEST FIXTURE ONLY — not a user disc photo' },
    screenshots: ['save-demo.png', 'save-drawer.png'],
    savedDiscAddress: proof.discAddress,
    receiptAddress: proof.receiptAddress,
    pqlReceiptAddress: proof.pqlAddress,
    bagAddress: proof.bagAddress,
    verified: proof.checks,
    checkpoint: { id: settled.id, timing: settled.timing, afterEvent: settled.afterEvent, settledEvent: settled.settledEvent },
  };
}
