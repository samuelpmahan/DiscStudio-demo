# Candidate evidence probe

This subtree is intentionally evidence-only. It does not modify the creator,
tests, package scripts, docs, or the private input photos. Run from the
`upload-disc-to-shelf` directory:

```sh
node --experimental-strip-types candidate-evidence/candidate-receipt.mjs
```

The probe uses the production `createCircleCandidateSession` and
`composeCircleCandidateChoices` gateway: one retained PhotoIntake, then small
initial/refine/refine/other request, candidate, and crop-choice Parts. The
rounds all point back to the same PhotoIntake; no old CircleFit/CropEdit Parts
are created. It writes only `candidate-evidence/out/`:

- `candidate-receipt.json`: machine-readable receipt and honest verdict;
- `*-trace-geometry.svg`: geometry-only source-space circles for initial,
  round 1, and round 2. No private source pixels are copied.

The receipt reports the API's actual returned count (0–3) and never fabricates
additional proposals. It records the session addresses and reuse checks under
`pxc`; rerun the probe after candidate-API changes and inspect
`candidateRequest`, `acceptance`, `trace`, and `pxc` for the updated result.
The geometry file records exact source-space circles without copying the
private source photo; a human can compare it with the separately retained
fixture when reviewing candidate inclusion.
