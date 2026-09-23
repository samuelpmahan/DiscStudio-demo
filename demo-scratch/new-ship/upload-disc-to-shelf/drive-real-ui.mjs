/**
 * Portable paired capture for DiscStudio's creator and mounted actual PxC
 * DevTools. It records a bounded action through a settled screen; it does not
 * claim either image represents the exact synchronous event-emission instant.
 *
 * HTTP:     node drive-real-ui.mjs --url http://127.0.0.1:4173 --chrome /path/to/chrome --scenario ./capture-scenario.mjs
 * URL-free: node drive-real-ui.mjs --url-free --chrome /path/to/chrome --scenario ./capture-scenario.mjs
 *
 * A scenario exports `action(page)` and `settle(page)`, and may export `label`.
 * Puppeteer is loaded only after --help parsing. The URL-free mode uses the
 * exact built ES-module graph on about:blank with a localStorage shim; it does
 * not verify HTTP delivery or persistence across reloads.
 */
import fs from 'node:fs'; import path from 'node:path'; import { Buffer } from 'node:buffer'; import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureSettledAction } from './paired-capture.mjs'; import { captureFiles, clearCaptureFiles } from './capture-output.mjs'; import { builtModuleGraph, inlineBuiltHtml, installBlobModules, storageShim } from './url-free-materializer.mjs';
const args = process.argv.slice(2), value = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
if (args.includes('--help') || args.includes('-h')) { console.log('Usage: node drive-real-ui.mjs (--url <http-url> | --url-free) --chrome <path> --scenario <module> [--label <name>] [--out <directory>]'); console.log('Scenario exports action(page), settle(page), and optional label. Captures a 1280×900 creator/actual-DevTools pair plus a checkpoint manifest.'); process.exit(0); }
const url = value('--url'), urlFree = args.includes('--url-free'), chrome = value('--chrome', process.env.CHROME_PATH), scenarioPath = value('--scenario');
if (Boolean(url) === urlFree) throw new Error('supply exactly one of --url or --url-free'); if (!chrome) throw new Error('--chrome (or CHROME_PATH) is required; no browser executable is bundled'); if (!scenarioPath) throw new Error('--scenario is required so each capture has an explicit bounded action and settle condition');
const scenario = await import(pathToFileURL(path.resolve(scenarioPath)).href); if (typeof scenario.action !== 'function' || typeof scenario.settle !== 'function') throw new TypeError('scenario must export action(page) and settle(page)');
const label = value('--label', scenario.label || 'checkpoint'), out = path.resolve(value('--out', 'renders-real')); fs.mkdirSync(out, { recursive: true });
const { creatorPath, inspectorPath, manifestPath } = captureFiles(out, label); clearCaptureFiles({ creatorPath, inspectorPath, manifestPath });
const puppeteer = (await import('puppeteer-core')).default; const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--window-size=1280,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  if (urlFree) await bootUrlFree(page); else { const target = new URL(url); target.searchParams.set('instrument', '1'); await page.goto(target.href, { waitUntil: 'networkidle0' }); }
  await page.waitForFunction(() => window.__dsScreenshotReady === true && document.querySelector('.pxdt-nav'));
  const adapter = { begin: name => page.evaluate(name => window.__dsScreenshot.begin(name), name), settle: ticket => page.evaluate(ticket => window.__dsScreenshot.settle(ticket), ticket), sequence: () => page.evaluate(() => window.__dsScreenshot.sequence()), currentView: () => page.evaluate(() => document.querySelector('.pxdt')?.hidden ? 'creator' : 'inspector'), currentScroll: () => page.evaluate(() => ({ x: scrollX, y: scrollY })), assertCapturable: () => page.evaluate(() => { if (document.querySelector('dialog[open], :modal')) throw Error('cannot capture while a modal dialog is active'); }), showCreator: () => selectView(page, 'creator'), showInspector: () => selectView(page, 'inspector'), screenshot: async file => { await page.screenshot({ path: file }); if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`empty screenshot: ${file}`); }, restore: async ({ view, scroll }) => { if (view) await selectView(page, view); if (scroll) await page.evaluate(position => scrollTo(position.x, position.y), scroll); } };
  const result = await captureSettledAction(adapter, { label, action: () => scenario.action(page), settle: () => scenario.settle(page), creatorPath, inspectorPath });
  const evidence = typeof scenario.manifest === 'function' ? await scenario.manifest(page) : undefined;
  fs.writeFileSync(manifestPath, JSON.stringify({ label, viewport: { width: 1280, height: 900 }, mode: urlFree ? 'url-free-about-blank-with-localStorage-shim' : 'http', ...result, ...(evidence === undefined ? {} : { evidence }) }, null, 2) + '\n'); console.log(`Captured ${label}: ${creatorPath}, ${inspectorPath}, ${manifestPath}`);
} catch (error) { clearCaptureFiles({ creatorPath, inspectorPath, manifestPath }); throw error; } finally { await browser.close(); }
async function selectView(page, view) { await page.evaluate(view => { const nav = document.querySelector('.pxdt-nav'); const button = [...nav.querySelectorAll('button')].find(button => view === 'inspector' ? button.textContent === 'PxC DevTools' : button.textContent !== 'PxC DevTools'); if (!button) throw Error(`actual DevTools navigation missing ${view} button`); button.click(); }, view); }
async function bootUrlFree(page) { const root = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(root, 'dist'), index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(dist, 'style.css'), 'utf8'); const inspectorCss = fs.readFileSync(path.join(dist, 'devtools.css'), 'utf8'), brand = `data:image/svg+xml;base64,${Buffer.from(fs.readFileSync(path.join(dist, 'brand-mark.svg'))).toString('base64')}`; const html = inlineBuiltHtml(index).replaceAll('./brand-mark.svg', brand).replace('</head>', `<style>${css}</style><style>${inspectorCss}</style></head>`); const graph = builtModuleGraph(path.join(dist, 'app.js'), dist); await page.goto('about:blank'); await page.setContent(html, { waitUntil: 'load' }); await page.evaluate(storageShim, {}); await page.evaluate(() => { window.__dsCaptureInstrumentation = true; }); await page.evaluate(installBlobModules, graph); await page.evaluate(async () => { await import(window.__dsBlobModules['app.js']); }); }
