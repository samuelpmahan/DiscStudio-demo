# DiscStudio tournament demo

A static, GitHub Pages-ready photo-to-card demo. It keeps each save in local browser storage and retains observable PxC addresses for the bag, receipts, crop recovery, and artwork.

## Build and preview

Source builds require Node **22.13+** because `npm run build` uses Node’s native TypeScript type stripping. The published `dist/` folder needs no Node, backend, Python, or npm at runtime.

```sh
npm run build
npm run serve
```

Open the printed localhost address. For a Pages subpath, deploy the **contents of `dist/`**; every app asset and module uses a relative URL. Keep `.nojekyll` in the deployed root.

## Tournament flow

1. Add a disc photo and correct its editable circle. CircleFit makes a bounded proposal, then refines the same supported foreground at full source resolution. If it cannot propose, the centered circle remains usable for manual correction.
2. Search and select the mold, then add plastic, weight, nickname, and any flight overrides. The latest prepared photo is the visible draft.
3. Save to Today’s Bag. The shelf remains a silent retained PxC sidecar.
4. Select one or more bag cards, choose one of five vertical or five horizontal fixed layouts, then preview, download a transparent PNG, or download selected cards together as a ZIP.

If a selection changes while a preview is rendering, the app clears it and makes a new preview before enabling downloads.

## Verification

```sh
npm test
```

This runs the supported tournament gate: photo-first save/readback, CircleFit-to-save-to-reload persistence, circle crop geometry, shared renderer presets, and PNG/ZIP export. `npm run test:all-history` is retained only to inspect the pre-rebuild painter, catalog-review, and archive workflows; it is not a release gate for this photo-first demo and currently includes intentionally incompatible historical expectations.


## Crop fitting

CircleFit is the creator default. It runs its edge-ring search on a bounded working raster, maps the proposal to source pixels, and refines that same foreground component at full source resolution. The crop remains one editable circle; manual use stays available when CircleFit abstains. The former RimFit v3 ellipse experiment remains deferred source and is not imported by the creator.

## Optional paired capture

After `npm run build`, the optional local capture CLI needs a Chrome executable plus `puppeteer-core` (install it locally without changing the demo dependencies with `npm install --no-save puppeteer-core`). Normal demo builds and tests do not need either. Capture a settled creator screen and the mounted **actual PxC DevTools** screen with the ready-to-run initial-screen scenario:

```sh
node drive-real-ui.mjs --url http://127.0.0.1:4173 --chrome /path/to/chrome --scenario ./capture-initial-scenario.mjs
```

The included initial scenario deliberately performs no mutation, so its manifest has an empty event slice. For another log site, provide a scenario that exports `action(page)` and `settle(page)` (plus optional `label`). Each pair writes two fixed 1280×900 PNGs and a JSON manifest containing the actual `experience.events` slice. The capture groups events from a bounded action to its settled screen; it does not represent the exact synchronous log instant. Failed or advancing-event pairs are deleted and have no manifest. Capture refuses an active modal dialog because switching to the inspector would place it behind the dialog; modal-aware capture needs an explicit scenario design.

`--url-free` boots the exact built ES-module graph on `about:blank` via Blob modules and uses an in-memory localStorage shim:

```sh
node drive-real-ui.mjs --url-free --chrome /path/to/chrome --scenario ./capture-initial-scenario.mjs
```

That mode is useful where local URL navigation is unavailable. It does not prove HTTP delivery or persistence across reloads. Screenshots are intentionally not run by this repository's automated tests.
