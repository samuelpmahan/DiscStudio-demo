# DiscStudio demo status

## 6.6.1 thro card fixes (build `28ac2b39fab85255`)

- Live on Cloudflare Pages: https://thro-disc.pages.dev (this build is also pinned at https://b-28ac2b39fab85255.thro-disc.pages.dev).
- `pages-artifact.zip` is that exact build. Rebuilding this commit's source reproduces it file for file (97 files) and the same build id.
- Tests: 242, of which 240 pass. The one failure (`experimental/ellipse-fit-fix/rim-aware-refinement.test.mjs`) failed identically on the untouched 6.6.0 baseline.
- What changed and why: see `handoff/thro-cards-6.6.1-28ac2b39fab85255-source.patch` (diff against the 6.6.0 baseline commit) and the manifest beside it (SHA-256 of every source file).

## Earlier checkpoint

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
