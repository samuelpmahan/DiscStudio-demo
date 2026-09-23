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
2. Search and select the mold, then add plastic, weight, and any flight overrides. The latest prepared photo is the visible draft.
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

After selecting a circle, **Refine choice** executes the normal candidate Calculation and separate `oc.studio.opposingRimFit` and `oc.studio.ellipseRimFit` Calculations over the same photo Part. The first samples multiple candidate edges near the selected rim, fits circles from opposing sides, and records its hypotheses and bounded rim points in `ds.px.OpposingRimFit.circlefit.*`. The second fits a rotated ellipse to those points. Only sufficiently broad, coherent evidence with a substantial improvement over the best circle offers **Circle 3 · Tilt repair**. The existing prepared-photo renderer maps that ellipse into a circular transparent image; its geometry and residuals remain inspectable in `ds.px.EllipseRimFit.circlefit.*`. When the ellipse abstains, **Circle 3 · Rim fit** remains available when supported. The original choice remains Circle 1 and selected. Initial intake does not run these refinements. An outer ellipse beyond the source image abstains; those missing pixels cannot be recovered by geometric correction.

On eight real photos in local headless Chromium, the ellipse Calculation took 7–13 ms; full Refine took 60–82 ms and Apply took 139–171 ms. IMG_6161 and IMG_6167 produced ellipse repairs; the other six kept their previous circular prepared images byte-for-byte. These are measured samples, not a device-wide latency guarantee.

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

## Creator PQL seam

The creator imports three already-compiled, frozen query plans; no query text is parsed at startup or during a save:

```sql
INSERT INTO :target VALUES :value
SELECT * FROM :source
```

The creator owns three frozen plans with stable identities: `createDisc`, `readDisc`, and `readShelf`. A save never reparses PQL. It binds the actual Disc or Shelf semantic address and existing PxC Part inputs, then executes the resulting `fn.CREATE` or `fn.READ` composition. The target address selects the CREATE output location; it is not merged into the Disc value.

Every creator save retains its three executions at `ds.px.receipt.pql.<save-id>`. Each entry records the frozen plan/template, the actual bound addresses, and the actual Part traffic separately. The ad-hoc `executePql` text API lives in `pql-compiler.ts` for workbench callers outside the creator flow; that compiler module is absent from the creator import graph. `UPDATE`, `DELETE`, projections other than `*`, and filters are rejected until a creator path needs them; `fn.UPDATE` and `fn.DELETE` remain registered universal calculations for later compilation.
