# DiscStudio Feature implementation versions — accepted progress decision

**Date:** 2026-10-01. **Decision:** Advance all 18 Features from their accepted contract milestone `0.1.0` to the first evidenced implementation milestone `0.1.1`; advance **Preview** once more to `0.1.2` for the later adjustable scene framing. This records implementation progress. It does not accept any Feature as release ready at `1.0.0`.

Sam clarified the third digit: adding working behavior to a `0.1.0` Feature should advance it to `0.1.1`, and further distinct additions can advance it again. For this decision, `0.1.1` is the first documented implemented snapshot on frozen build [`91fb2149197f3ebe`](https://drive.google.com/file/d/1UQbczmqjINuFK2Dckt-Hoz77oT2_KjW4/view?usp=drivesdk). It is retrospective accounting of assembled behavior, not a claim that every line was written after contract acceptance. Preview's independently frozen source change on [`d25cbbdf3395d8e9`](https://drive.google.com/file/d/1cEj7OxjUgzdkVybzQfvKLHhsOkYUn0JC/view?usp=drivesdk) supplies its second patch.

## Current Feature versions

| Stage | Feature | Current | Recorded implementation |
| --- | --- | ---: | --- |
| Save Disc to Bag | Photo intake | `0.1.1` | Chosen image, retained re-fit surroundings, safe failed replacement. |
| Save Disc to Bag | RimFit | `0.1.1` | Background-edge Choices and bounded Other correction. Special-rim visual judgment remains. |
| Save Disc to Bag | Crop refinement and rotation | `0.1.1` | Short Choices, one live rotation slider, accepted re-fit. |
| Save Disc to Bag | Prepared image creation | `0.1.1` | Diameter-sized transparent depiction from the accepted fit. |
| Save Disc to Bag | Mold and plastic details | `0.1.1` | Catalog selection, plastic states, flight overrides and sparse provenance. The narrower mold-search proposal remains independent. |
| Save Disc to Bag | Save to Today’s Bag | `0.1.1` | One physical Disc identity holds depiction, facts and re-fit source. |
| Save Disc to Bag | Shelf persistence | `0.1.1` | Same-browser return restores saved Discs and re-fit context. |
| Define Graphics | Card selection | `0.1.1` | Five distinct portrait and five landscape recipes. |
| Define Graphics | Card rendering | `0.1.1` | Ten native designs with title-clearance fixes. B05 and margins still need creator critique. |
| Define Graphics | HighlightColor | `0.1.1` | Shared accent and dark-color warning that preserves the chosen hue. |
| Define Graphics | HighlightOn | `0.1.1` | Digits and tiles as separate accent targets. |
| Define Graphics | Mirrored | `0.1.1` | Disc on the outside edge with readable upright text. |
| Define Graphics | Canvas sizing and placement | `0.1.1` | Orientation-aware scale baseline and held placement. |
| Define Graphics | Preview | **`0.1.2`** | `0.1.1`: direct scene selection. `0.1.2`: independent portrait/landscape scene drag, focus and zoom, matching Canvas, Review and current combined PNG. |
| Define Graphics | Approval / Add to Export | `0.1.1` | Distinct held identity for each deliberate Add, including repeats. |
| Export Graphics | Approved graphic rendering | `0.1.1` | Earlier approval reproduces after editor and Disc changes. |
| Export Graphics | Transparent PNG export | `0.1.1` | Identified earlier approval downloads as a tight transparent card. |
| Export Graphics | ZIP packaging | `0.1.1` | One mapped PNG per approval, including repeats; failure yields no partial ZIP. |

The first checkpoint's [three-photo re-fit](https://drive.google.com/file/d/1nR-On-9VN6bDWhCbODVPhu9EtjuTKagx/view?usp=drivesdk), [ten-design sheet](https://drive.google.com/file/d/1NYWtlI8dkqvTOMSKrFMf8YMuENHQIWPr/view?usp=drivesdk), [continuous creator journey](https://drive.google.com/file/d/1_kj5QRdKeR7ahj-hzMTU_ZKUkkAl3o6w/view?usp=drivesdk), [strict Export receipt](https://drive.google.com/file/d/16sYsr19qaswSx_CVaASEq87mb52Po6sX/view?usp=drivesdk), and [direct preview selection](https://drive.google.com/file/d/13hBNOD6IhyVVCq9wKhQrFLqG7okyOoZP/view?usp=drivesdk) bind the first patch. Preview's second patch is bound to the [exact scene-framing receipt](https://drive.google.com/file/d/1jKKFnL_d8RkQcbhNpsnLD6v0-ufLhzMH/view?usp=drivesdk). Five later [cold search trials](https://drive.google.com/file/d/1JKuif7TnDXm4H9Pez60SuNYYPu499ML5/view?usp=drivesdk) strengthened evidence but did not add a mold-details implementation patch.

## Patch rule used here

One patch records a bounded implemented Feature slice with exact source/build evidence. A later, independently bounded behavior addition can earn another patch. Related fixes are coalesced at a checkpoint; test reruns and dependency repairs do not earn versions. This is a minimal operational rule under Sam's clarification. Broader cross-system counting remains open to refinement with Sam and Dot. Contract updates use the middle digit only after a changed consumer promise is accepted. `1.0.0` remains a separate release-readiness decision.

The three Stages and Demo remain `0.0.0` until their four proposed first contracts are accepted. NCTK and PxC remain `0.0.0`; the narrower mold-search candidate remains separately pending at `0.0.0`. Historical build `6.5.2` is not a maturity version. The frozen `91fb` and `d25c` receipts retain the versions captured when they were built; this later decision is append-only and should be bound into the next composition. It does not change canonical source or publish the app.

## AcceptByRejecting

**Initial claim:** Leave every Feature at `0.1.0` until the whole Demo can be called `1.0.0`.

**Strongest rejection and consequence:** `0.1.0` only records the accepted promise. It hides an implemented Save/re-fit handoff, ten card designs, held approvals and exact sticker exports, and then hides the distinct later scene-framing addition. A creator or collaborator reading versions would reasonably conclude that no work happened.

**Rewrite:** Accept a first evidenced implementation patch for each Feature at frozen `91fb`. Accept a second patch only for Preview on frozen `d25c`, whose source and output changed to let the creator frame the scene separately in both orientations. Keep contract and release acceptance independent.

**Adversarial re-review:** Existing code before contract acceptance, interim fixes, test reruns and a native dependency restoration could inflate the patch counter. Coalesce them into the first exact implementation snapshot; count the later Preview behavior once. These versions show progress but cannot prove Servo/Halo boundary quality, B05 composition, every search form, or the four Stage/Demo handoffs as release ready. Future increments need their own source/evidence checkpoint and must preserve these historical receipts.


## Successor implementation checkpoint · historical build 6.5.3

**Date:** 2026-10-01. This append-only implementation checkpoint advances four Features under their unchanged `0.1.0` contracts: Crop refinement and rotation `0.1.1 → 0.1.2`, RimFit `0.1.1 → 0.1.2`, Prepared image creation `0.1.1 → 0.1.2`, and Mold and plastic details `0.1.2 → 0.1.3`. All other Feature versions hold; the three Stages and Demo remain `0.0.0`. This candidate does not accept release readiness at `1.0.0` and does not promote the site.

The CircleFit circle remains the creator default. `Try ellipse fit` is opt-in: the frozen RimFit v3 result is mapped through its exact raster scales and source-pixel boundary checks, then shown only as a bounded `MAYBE` proposal. A creator must review or adjust its center, radii, and axis before `Use photo`. A failed or invalid proposal cannot fall through to a circle; the creator must explicitly choose `Use circle fit`. Accepted ellipse geometry circularizes the crop with independent stamp rotation and remains editable after save/reload. The mold field retains a selected mold when it receives focus. Exact lane and browser evidence, source version, build identity, and archive hashes are bound in `DiscStudio-ellipse-fit-integration-receipt.json`; the ledger avoids embedding its own build identity because it is a build input.

### Observed automatic-fit limits

The eight-photo full-source/384 review set produced one bounded MAYBE proposal and seven FAIL abstentions (`1/8` editable automatic proposals). The separate 720-working test without internal resize abstained on all eight. CircleFit and manual circle placement remain available; this small sample is implementation evidence, not general automatic-fit acceptance or a `1.0.0` readiness decision.

### UI inspection boundary

While the creator edits an ellipse, the preview shows source geometry over the original photo; it does not show the circularized output live beside the controls. The prepared output appears after Apply. This is recorded for human review and does not trigger broader UI work in this checkpoint.


## Current version decision · 6.5.6

On 2026-10-02 Sam explicitly requested overall **6.5.6** and **RimFit** / **Crop refinement and rotation** implementation **0.5.0**, after provisionally accepting default ellipse dot refinement. This explicit implementation milestone supersedes incremental patch counting for these two Features only. Contracts remain 0.1.0; other Feature, Stage and Demo versions hold. No 1.0 readiness is asserted.

The accepted behavior checkpoint is build 5332eac2f2c9e7fc, source 4c8fd8568acac1dfb67aea3f57706b147b149638fb1e1e51518f835af798bf02. Default eight-dot refinement holds the last placed contact, retains Undo/Fit view and disclosed precise controls, and accepts via OK. This release changes metadata only; geometry, fitting engines, rotation and persistence formats are unchanged. The 6.5.5 ledger checkpoint is preserved in historicalImplementationCheckpoints.


## Current version decision · 6.5.7

Sam requested Photo intake implementation 0.5.0 and Re-crop for prepared and saved photos. Overall 6.5.7 records the visible action. Reopening hydrates retained source, exact accepted edge and stamp rotation without rerunning fitting. Draft OK uses existing draft preparation; saved OK updates the same Disc. Cancel and failed reopening preserve the current depiction. Contracts, other Feature versions, Stage/Demo versions and persistence formats hold. Prior 6.5.6 decision is retained.
