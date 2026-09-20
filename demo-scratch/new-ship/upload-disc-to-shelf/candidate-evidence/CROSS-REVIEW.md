# DuaLuna cross-review: candidate API vs. real receipt

Review scope: read-only `circle-candidates.ts`, `circle-candidates.test.ts`,
and the latest `candidate-evidence/out/candidate-receipt.json` plus the
external pixel contact sheets. No shared implementation files were changed.

## Agreement

- The production session path is exercised directly: one
  `createCircleCandidateSession` creates one `PhotoIntake`, then four
  `composeCircleCandidateChoices` rounds create only request/candidate/crop
  Parts for initial, refine, refine, and other. Every round's composition
  reuses the same PhotoIntake; the receipt reports no legacy CircleFit/CropEdit
  addresses.
- Initial candidates are source-bounded and deterministic in the synthetic
  tests. `refineCircleCandidates` preserves the exact anchor as option zero;
  the receipt reports `selectedAnchorPreserved: true` for both real fixtures.
- The screenshot's rank-1 candidate is the physical disc in the pixel contact
  sheet. Its round-1 selection improves locally from roughly
  `(633.44,1323.76,r541.65)` to `(609.07,1299.39,r522.15)`; round 2 keeps that
  selected local option. The exact raw crops are outside the repo.
- Runtime is bounded in practice: the metadata/test probe passed in about
  1.7s; the optional two-image pixel artifact run completed in about 4.8s.

## Disagreement / remaining gaps

- Geometric NMS is not semantic-object NMS. The latest `IMG_6009.jpeg` receipt
  has only two initial options; rank 2 is an inner circle on the same visible
  disc, not a second physical object. Thus the requested initial-3 contract is
  still incomplete for that fixture.
- `IMG_6082(1).jpeg` currently returns three initial options and includes the
  physical disc at rank 1, but the contact sheet shows rank 2 as a disc/cloth
  partial and rank 3 as the red markup/UI region. The “disc among top 3” check
  passes visually; “three meaningful physical-disc alternatives” would not.
- The initial and other operations are separate global searches and may each
  invoke detection; refine is local. This is reported as two detector rounds,
  while the full-raster PhotoIntake count remains one.
- Crop evidence comes from the real `fn.studio.circleCandidateCrops` Part in
  each session round, not from a manually seeded legacy CropEdit receipt.

## Validation

`node --test candidate-evidence/candidate-receipt.test.mjs` passes. Latest
receipt verdict is `MAYBE`: both fixtures return three initial candidates,
two local refinement rounds, and exact per-round anchor preservation; the
physical-disc inclusion remains a visual review claim.
