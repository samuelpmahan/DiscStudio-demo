# DiscStudio demo

DiscStudio is a static photo-to-card disc-golf demo for GitHub Pages. It stores work in the browser, supports photo crop correction and mold details, keeps a local bag, and exports selected cards as PNG or ZIP.

## Run locally

Node 22.13 or later is required; the deployment workflow uses Node 24.

```sh
cd demo-scratch/new-ship/upload-disc-to-shelf
npm ci
npm run build
npm run serve
```

Open the localhost address printed by `npm run serve`. The built app is in `dist/` and needs no server-side runtime.

## Verify

```sh
cd demo-scratch/new-ship/upload-disc-to-shelf
npm test
npm run test:capture
```

## Deploy

Pushing `main` runs `.github/workflows/deploy-pages.yml`. The workflow installs locked dependencies, runs the release and capture-materializer gates, builds `dist/`, and publishes it through GitHub Pages.

## Source provenance

The deployable source is preserved at `demo-scratch/new-ship/upload-disc-to-shelf`. Its sibling `demo-scratch/new-ship/part-first-kernel` is retained because the build copies its PxC runtime into the static package. See the demo's [source lineage](demo-scratch/new-ship/upload-disc-to-shelf/SOURCE_LINEAGE.md) for component-level provenance.
