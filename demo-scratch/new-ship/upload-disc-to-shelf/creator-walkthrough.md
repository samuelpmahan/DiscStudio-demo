# DiscStudio creator walkthrough

The app renders this authored walkthrough from `creator-walkthrough.ts` and pins the same grouped rows in the Neat `tick-part-checklist` component. Each row provides creator steps, recovery, developer boundary, evidence, and checkpoint detail.

The current MVP is photo-only. Its prepare flow is to choose the closest complete rim from Circle 1, Circle 2, or Circle 3; optionally use Refine choice, Find other circles, or Adjust manually; then choose Use photo. It starts a fresh empty session each load while retaining legacy and prior session archives without displaying or restoring them. Cards enter output only through the explicit **Add to output queue** action; selecting a card and style creates a preview only. Export packages only the held output queue as a ZIP.

Checklist inspection is local and checkpoint-scoped. It records inspection separately from human acceptance. This demo does not claim a formal Neat PQL/PCR ledger or invent a PCR identity. Real iPhone/touch/download behavior remains unknown until a real-device run records it.
