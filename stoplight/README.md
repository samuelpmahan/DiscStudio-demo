# lane-stoplight

A stoplight for Sam's lane, packaged as a Claude Code plugin. When a session starts, it runs every tracked item's tests ("crucibles") and shows a light per item. It also gives Claude the lane rules (no git, Drive lane only, propose don't apply). So a fresh session needs no hand-written prompt.

- 🟢 Everything ran and came out as expected. That includes broken copies that must be caught.
- 🟡 No crucible yet, or it couldn't run here.
- 🔴 It ran and came out wrong.

## Use it
You need Node 22 (no npm installs) and Claude Code 2.1.280 or later.

1. Download this folder from Drive. Its name must stay `lane-stoplight`.
2. Pick one way to load it:
   - **Every local session:** put the folder at `~/.claude/skills/lane-stoplight/`. It then loads in every terminal or desktop session on that machine, with no install step.
   - **One session:** `claude --plugin-dir /path/to/lane-stoplight`
   - **Without a flag:** set `CLAUDE_CODE_PLUGIN_DIRS=/path/to/lane-stoplight`
3. Start a session. The stoplight and the rules are in Claude's context before your first message.
4. To run it by hand: `node --experimental-strip-types run.ts` in this folder. The receipt goes to `stoplight.json`.

Check it loaded with `claude plugin validate /path/to/lane-stoplight`, which should print "Validation passed".

**Cloud sessions (claude.ai/code) don't load local plugins.** For those, the folder would have to live in the session's repo at `.claude/skills/lane-stoplight/`. That means a git commit, which is Sam's call.

## CI and the Page
- Every push to `main` runs the stoplight inside the Pages deploy (`.github/workflows/deploy-pages.yml`). The result is published at `/stoplight/` on this repo's Pages site, with the full receipt at `/stoplight/stoplight.json`. The step can't block the DiscStudio deploy.
- **Delta:** a crucible that lists its `inputs` in `items.json` gets a fingerprint covering the Node version, platform, command, working folder and expected result, plus every input file and the runner/classifier (`stoplight.ts`, `board.ts`). When the fingerprint matches the published run, the old result is reused instead of re-run. Results that couldn't run are never reused. Crucibles without `inputs` always re-run.
- Locally: `STOPLIGHT_PREVIOUS=path/to/old/stoplight.json node --experimental-strip-types run.ts`.

## Files
- `items.json`: the tracked items and their test commands. **This is the file to edit.** `cwd` is relative to this folder, and `expect: "fail"` marks a broken copy that must be caught.
- `run.ts`: runs everything, prints the lights, writes `stoplight.json` and `index.html`.
- `page.ts`: turns the receipt into the one-page HTML view.
- `stoplight.ts`: Calculations on a PxC board: `fn.Crucible.run`, `fn.Crucible.fingerprint` and `fn.Stoplight.light`.
- `board.ts`: ChainSpot's PxC board. It's copied verbatim from `samuelpmahan/ChainSpot` on branch `lab/s0-viewer` (`packages/alg/src/exec/board.ts`); the only change is local stand-ins for one type import.
- `stoplight.test.ts`: the stoplight's own tests. They put test results straight onto the board, skipping the running stage, and check the colour. `STOPLIGHT_IMPL=mutant` swaps in a broken light that counts "couldn't run" as a pass, and `STOPLIGHT_IMPL=stale` swaps in a fingerprint that ignores file contents. Both have to be caught.
- `hh-di/`: Homeroom Heroes teacher rules (register, approve, create profile, Teacher of the Day), written as tests of the same kind. `HH_IMPL=mutantA|B|C` puts back each live-site bug: the district bypass, the unchecked wishlist link and malformed tag, and the Teacher of the Day infinite loop. Each must turn red. This is a spec for the rewrite, not the rewrite itself.
- `.claude-plugin/plugin.json`, `hooks/hooks.json`, `skills/lane/SKILL.md`, `RULES.md`: the plugin wiring.

## The nctk items
`accepted-head`, `05+06` and `F11` need nctk trees at `trees/accepted-head` and `trees/candidate-05-06`. Without them they show 🟡 "not present here".
- How to rebuild them: see `STATE.json` and the lane journals in the `nctk-claude` folder. The steps are the f76e archive, then patch 04, then overlays 01 and 02, then patches 05, 06 and 06b.
- `vendor/discstudio/disc` needs `@napi-rs/canvas` installed.

## Last full run
Run 2026-10-02 in Claude's container, with the trees present:
- 4 green: the stoplight itself, accepted-head (76/76), 05+06 (85/85) and HH-spec (10/10, with all 3 bugs caught).
- 1 red: F11, where 9 of 11 old vendor tests fail, as recorded.
- 4 yellow, because they have no crucible yet: HH-rewrite, P02, D01 and F02.
