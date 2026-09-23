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

Initial intake now searches for one disc, then composes `oc.studio.opposingRimFit`, `oc.studio.ellipseRimFit`, and `oc.studio.localCircleAlternatives` over the same transient photo Part. The best supported rim circle becomes the selected **Recommended** crop. The two remaining slots offer **Tilt repair** and **Tighter edge** where an ellipse is supported, or **Tighter edge** and a sufficiently distinct **Original fit** otherwise. Unsupported proposals abstain rather than filling a slot with a fake alternative. All three thumbnails render the same transparent cutout as Apply. **Find other circles** retains the separate broad search for a genuinely different object.

**Refine choice** keeps the selected crop first and explores nearby alternatives. Opposing-rim hypotheses and bounded radial samples remain in `ds.px.OpposingRimFit.circlefit.*`; ellipse geometry and residuals remain in `ds.px.EllipseRimFit.circlefit.*`. `ds.px.LocalCircleAlternatives.circlefit.*` records the small-circle variants. An ellipse extending beyond the source abstains because missing pixels cannot be recovered.

Prepared cutouts use a small inward source aperture while keeping the output circle full-size: 4% for an accepted tilt repair and 1.5% for a circular crop. Candidate previews and saved photos share this materialization rule. It removes the visible bedding along the estimated rim on the tested discs, at the cost of trimming a little physical rim. A fitted outline alone cannot certify every unseen photo; inspect the transparent candidate preview before Apply, and adjust manually if the edge is ambiguous.

On eight real photos in local headless Chromium, the first three choices appeared in 197–257 ms and Apply took 127–204 ms (at most 416 ms combined). IMG_6161 and IMG_6167 offered tilt repairs; the other six offered an original fit. All eight recommended saved outputs were inspected against a checkerboard. These are measured samples, not a device-wide latency guarantee.

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
