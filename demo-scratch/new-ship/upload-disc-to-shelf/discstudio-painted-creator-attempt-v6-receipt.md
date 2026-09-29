# DiscStudio isolated Attempt v6 — crop-to-card second use

2026-09-26 15:38 UTC. This succeeds v5 within the same isolated Attempt, without promoting the trusted workspace artifact. The default materialization is photo-first base.

The v5 generated prepared-photo fixture was strengthened to begin with two generated 512×512 source graphics, apply the creator's existing `circleCropExportMapping` and `drawRotatedCrop` inside a circular clip, encode WebP, add the prepared photo, save two Discs, hydrate mold facts, keep Shelf edits, resolve current Bag versions, render both U02 previews, approve two held snapshots and export a two-card ZIP. It checks retained prepared-photo identity, first Bag speed 11 before approval and 12 after another kept edit, approved first card still 11, second 5, manifest provenance, exact preview PNG equals ZIP PNG and hashes. The actual source graphics are generated specimens, not a retained human creator photo. This executes shared crop geometry and draw code, but does not prove source upload decoding, auto circle detection, or browser interaction.

Executable `disc/photo-bag-two-card-evidence.mjs`; proof `disc/evidence/photo-two-card.receipt.json`; build-or-bind `disc/evidence/two-card-export-build-or-bind.md`. Dark inspection image checks 11/4/−1/1 and 5/4/−1/1 on transparent native card outputs. Two-card ZIP SHA-256 `6bb0688b47b1b1176c2c3aafe60474055d14e7e239dd07c0b1721334ad15512e` (107,106 bytes). Base crisp returned REUSE with `BINDING_ONLY`. v5 base tournament remains 104 pass, one expected overlay skip, zero fail; no product implementation files changed between v5 and v6.

Replay after `npm ci --ignore-scripts`: `cd disc && node --experimental-strip-types photo-bag-two-card-evidence.mjs && npm run test:tournament`.
