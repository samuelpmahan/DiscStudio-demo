# DiscStudio demo status

Live checkpoint: [`6c39b0c`](https://github.com/samuelpmahan/DiscStudio-demo/commit/6c39b0c665717232c427f0952ecb6620d8a49990) · build ID `33fa05b7c318f716`

## Confirmed live

- The published CircleFit build loaded in the browser. Its 720px-bounded ring search and original-pixel refinement are the active creator path; the former RimFit v3 ellipse experiment remains deferred and is not imported.
- The handle corrector is live: its visible 44px lower-right handle resizes the circle, while dragging anywhere else pans the photo beneath a fixed aperture. An off-center zero-movement handle click preserved the crop; a one-pixel x/y drag moved the handle by one pixel. The stage bounds remained fixed and release returned the control to its ready state.
- The prepared `6087-orange.png` photo was applied, assigned **Axiom Crave** and **Unknown plastic** solely for verification, saved as “Handle correction verification,” then reloaded with its decoded photo and U02 card intact (`ds.px.disc.save-22`).
- A blank no-fit upload and Reset both kept **Use photo** enabled for a manual circle correction.
- Automated verification passed: `npm test` (69 tests), `npm run test:capture` (7 tests), and [GitHub Actions run 35537043916](https://github.com/samuelpmahan/DiscStudio-demo/actions/runs/35537043916).

## Remaining limits

- Circle auto-fit is a suggestion, not a universal rim confirmation. A tilted Escape photo can produce a poor small-circle suggestion; adjust, reset, or use the manual circle before applying.
- Download file completion is unverified: direct and browser-automation download events have timed out, despite the prepared ZIP status. Actual iPhone touch and download behavior have not been tested.
