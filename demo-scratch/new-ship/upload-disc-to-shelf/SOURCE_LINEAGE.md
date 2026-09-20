# Source lineage

This rebuild is rooted in `demo-scratch/new-ship/upload-disc-to-shelf` and uses the received DiscStudio sources as follows:

- `card-renderer-core.ts` contains the original ten SpotlightCard draw routines, extracted unchanged in layout behavior from the received native `card-renderer.ts` so Canvas2D and `@napi-rs/canvas` use the same renderer.
- `rimfit.ts` and `rimfit-v3/` are the received browser-native recovery implementation. `upload-ui.ts` now composes its retained PhotoIntake → CircleFit → CropEdit evidence and exposes acceptance or abstention honestly.
- `zip.ts` is the deterministic ZIP32 STORE helper supplied in the received DiscStudio worktree; `export-queue-core.ts` preserves the existing filenames and `discstudio-export` v1 manifest fields.
- `part-first-kernel/src/pxc.mjs` remains a local runtime dependency copied verbatim into the static package at build time. No kernel or vendor file is edited.

The native adapter stays in `card-renderer.ts` for evidence renders. GitHub Pages uses `browser-card-renderer.ts`, which supplies browser image/PNG effects to the shared draw routines.
