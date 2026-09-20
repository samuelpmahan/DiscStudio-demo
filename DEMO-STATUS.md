# DiscStudio demo status

Live checkpoint: [`5a62b63`](https://github.com/samuelpmahan/DiscStudio-demo/commit/5a62b63eea9d346c417be31f3f9e03c5cfd7950c) · build ID `e76d55da6d39a1f2`

## Confirmed live

- The published CircleFit build loaded in the browser. Its 720px-bounded ring search and original-pixel refinement are the active creator path; the former RimFit v3 ellipse experiment remains deferred and is not imported.
- Uploading `6087-orange.png` produced an auto circle. `+1`, `−1`, and Reset all kept **Use photo** enabled; diagonal edge drag moved Circle size from 84% to 87%, and Auto-fit restored 84%.
- The prepared photo was applied, assigned **Axiom Crave** and **Unknown plastic** solely for verification, saved as “Circle restore verification,” then reloaded with its decoded photo and U02 card intact.
- A blank no-fit upload and Reset both kept **Use photo** enabled for a manual circle correction.
- Automated verification passed: `npm test` (66 tests), `npm run test:capture` (7 tests), and [GitHub Actions run 35533825224](https://github.com/samuelpmahan/DiscStudio-demo/actions/runs/35533825224).

## Remaining limits

- Circle auto-fit is a suggestion, not a universal rim confirmation. A tilted Escape photo can produce a poor small-circle suggestion; adjust, reset, or use the manual circle before applying.
- Download file completion is unverified: direct and browser-automation download events have timed out, despite the prepared ZIP status. iPhone download behavior has not been tested.
