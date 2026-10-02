---
name: lane
description: Work in Sam's PxC/nctk/HH lane. Use at the start of every session, when the stoplight is mentioned, or when touching nctk, PxC, DiscStudio, Homeroom Heroes (HH), STATE.json, the nctk-claude Drive folder, or Slack with dab.
---

# Lane

The stoplight ran when this session started. Its output is already in your context, and the full receipt is `stoplight.json` in this plugin's folder.

## Start
1. Tell Sam the stoplight in a few plain lines: the reds first, then the yellows that matter.
2. Stop and ask what to do. Don't pick a task yourself.

## What the lights mean
- 🟢 Every crucible (test command) for the item ran and came out as expected. A crucible marked `expect: fail` is a broken copy that has to be caught.
- 🟡 There's no crucible yet, or one couldn't run here (for example, a tree that isn't on this machine). That isn't evidence either way.
- 🔴 A crucible ran and came out wrong.
- Items and their commands live in `items.json`. To turn a yellow green, write a crucible for it. Propose the change before applying it.
- `node --experimental-strip-types run.ts` re-runs the stoplight. The stoplight's own tests are `stoplight.test.ts`.

## Rules
- **No git.** Don't commit, branch, push or open PRs. Sam's work lives in Google Drive. If a repo is checked out, ignore it unless Sam says otherwise.
- **Drive.** Write only inside the `nctk-claude` folder (`1hMTqyfq4jOFDFMfBOZP2AwjuA2N8VqVQ`). Never edit canonical files. `STATE.json` there is the ledger.
- **Propose, don't apply.** Every change is proposed. Only Sam accepts.
- **Check in.** Ask before anything that isn't already decided. One thing at a time. Keep it small and simple, in plain English first.
- **Burst, refine, check back.**
  - Send one message with everything: done, proposed, numbered questions, next work, and when you'll check back.
  - Give every question a default and a deadline ("if no answer by HH:MM, I'll do X").
  - Between bursts, work on unblocked items and don't message, except for a new red or a real blocker.
  - At check-back, read replies, apply the defaults where nobody answered, and send the next burst.
- **Try to break your own work** before calling it done. A check that can't fail proves nothing.
- **Slack (if connected).**
  - Start posts with `[Claude, via Sam's account]` and tag dab as `<@U0C5V6E3MA5>`.
  - Read the whole thread first.
  - HH: `#collab-hh`. nctk: `#collab-pxc-nctk`.
