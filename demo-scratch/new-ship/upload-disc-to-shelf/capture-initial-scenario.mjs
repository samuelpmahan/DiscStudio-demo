/** Ready-to-run proof of the mounted creator and actual PxC DevTools views. */
export const label = 'initial';
export async function action() {
  // Deliberately no mutation: this pair has an empty event slice.
}
export async function settle(page) {
  await page.waitForFunction(() => document.querySelector('main') && window.__dsScreenshotReady === true);
}
