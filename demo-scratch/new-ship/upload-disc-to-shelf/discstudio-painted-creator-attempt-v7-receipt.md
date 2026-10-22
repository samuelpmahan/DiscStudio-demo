# DiscStudio isolated Attempt v7 — derived photo and resolver obligations

2026-09-26 15:42 UTC. Source remains an isolated Attempt, photo-first base as default. No trusted workspace promotion or browser click proof.

The real-photo evidence input is the entire `disc/evidence/derived-contact-sheet-input.png`, a previously generated 960×730 RGB contact sheet of photographed Discs, Library file `libfile_7c30deff87188191b2a3a5ba46a1f188`, SHA-256 `d751819a1276be73f11d26bbcf2d8489c006fe60a5838264061ab3fc7ff7f0d6`. Lower rendered-crop rectangles are exactly `(60,441,220,222)` white/asphalt and `(371,441,220,222)` green/wood; the contact sheet's checkerboard backdrop is baked into those RGB pixels. They are **DERIVED_CONTACT_SHEET_INPUT**, not original camera bytes or fresh creator upload decoding. The evidence script uses the established circle crop mapping and rotated draw path, encodes WebP prepared photos, saves two physical Discs with hydrated Buzzz facts, resolves a kept Bag edit, renders two U02 previews, approves held queue snapshots, keeps a later edit, and exports actual two-card ZIP. ZIP PNG bytes equal the respective previews; retained photo source identities, manifest speed 11/5, and post-approval Bag speed 12 are asserted. [Local dark visual] `disc/evidence/derived-contact-two-card-dark-inspection.png` shows real disc pixels, 11/4/−1/1 and 5/4/−1/1. **TEST METADATA:** Buzzz/ESP/177g and every flight value are deliberately supplied fixture facts; they do not identify the photographed Discs. The white photographed Disc visibly has a different stamp. ZIP SHA-256 `af678c011f43e91155f327f824e287a788daf172e529eed597cb89471b74abf6`.

The narrow resolver repair rejects every noncanonical argument shape instead of silently selecting base. It accepts exactly no arguments or `--overlay painted-discs`. Both base and overlay desired graphs now declare downstream `Contract.ApprovePhotoFirstCardForExport`, `Contract.ExportApprovedZip`, and `Part.OutputQueue`; crisp remains `BINDING_ONLY` and the behavior is evidenced by separate operations. v7 overlay activation and base return each caused expected binding/build EXTEND; malformed argument receipt shows six rejected shapes. Focused overlay tests 2 pass/1 expected base skip; base tournament 104 pass/1 expected overlay skip, zero failures.

Independent v5 replay receipt in the Attempt separately verifies the previous source archive and a two-record photo+painting archive across overlay→base→overlay, with retained Art provenance. v7 does not alter the product renderer or state store. Browser gallery interaction, human approval, and original camera bytes remain unproved.

Replay from archive root after `npm ci --ignore-scripts`:

```sh
cd disc
node kompoze-resolve.mjs > evidence/desired-v7-photo-base.json
node kompoze-resolve.mjs --overlay painted-discs > evidence/desired-v7-painted-overlay.json
node crisp-recompose.mjs evidence/desired-v7-painted-overlay.json
node --experimental-strip-types --test painted-overlay.test.ts bag-current-version.test.ts
node crisp-recompose.mjs evidence/desired-v7-photo-base.json
npm run test:tournament
node --experimental-strip-types photo-bag-two-card-evidence.mjs --derived-contact-sheet
```
