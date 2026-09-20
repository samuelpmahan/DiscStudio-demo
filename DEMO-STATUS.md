# DiscStudio demo status

Live checkpoint: [`ce04523`](https://github.com/samuelpmahan/DiscStudio-demo/commit/ce0452363ec15fb08d0cab9824bb12d1ba1aaad8) · build ID `2d70358bf1665374`

## Confirmed live

- Content-versioned `app.js` and `style.css` load with the build ID; restored copy says **Today’s Bag**, proving the fresh module graph is active.
- Accepted orange auto-fit renders a square `442×442` crop stage and canvas, enables Use photo, and shows no ellipse editing text.
- Escape correctly abstains. A real manual drag unlocks Use photo; catalog and save then succeed. Reload restored five bag entries.
- Selecting all five cards prepares a ZIP and shows **ZIP ready…5 cards** with Save ZIP visible.

## Remaining limits

- Download file completion is unverified: direct and browser-automation download events have timed out, despite the prepared ZIP status. iPhone download behavior has not been tested.
- Native v3 still abstains on difficult photos such as raw Escape; manual safety recovery can retain nearby background, so it is not a clean cutout guarantee.
