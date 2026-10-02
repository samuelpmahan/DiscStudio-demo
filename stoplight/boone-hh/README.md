# test-infra

Reusable test batteries that become automatable test infrastructure.
The workflow: define requirements (tests), then assemble (implementations).

## The split with dab's harness (no duplication)

dab's side owns: node execution, the tree, log-and-return invocation.
This side owns: test definitions (batteries), the guarantee contract,
receipts, content-addressed caching + invalidation, stub discipline,
fault injection.

Plug point: the log-and-return skeleton. Each node declares
inputs/outputs/guarantees. A Test binds to a node address and makes the
guarantee executable. The harness runs nodes; this layer checks the
guarantees and records receipts. It also runs standalone against plain
callables (see demo.py).

## Concepts (PxC, deliberately)

- **Test is a Part.** Identity is the address (`test/hh/...`), versioned,
  composable. Uses pyto's `Part` as the address type.
- **Battery is a tree** of Tests (seek(tree), but for verification).
- **Guarantee** is what a node declares; a Test is its executable form.
- **Receipt**: test address + test version + target + target version +
  inputs hash + verdict + timestamp. Plain data; can live as a file, a
  Part, or a pyto `px.receipt.*` observation.
- **Cache**: content-addressed on
  `(test, test version, target version, inputs hash)`. Same inputs always
  give the same verdict. A target version change invalidates (no silent
  reuse across a changed runner/classifier: dab's stoplight finding,
  honored).
- **Stubs**: an unbound target returns UNIMPLEMENTED explicitly. The
  battery report keeps unimplemented visibly separate from failed. The
  trace never pretends a stub did real work.
- **Faults**: force named nodes to fail/raise to assert the composition
  preserves valid state under injected failure (ladder rung 2).

## Kinds

- `parity`: pins CURRENT behavior. Bugs documented as bugs and pinned
  anyway. Flipping one is a reviewed delta, never silent drift.
- `intended`: pins a deliberate fix. Failing against the current model is
  how it proves it discriminates.

## HH parity battery

`batteries/hh_parity.py` DEFINES parity with current Homeroom Heroes,
from Claude's parity checklist (Engsmallz/hithero @ cc195c2) + fixtures
A/B/C. 5 parity tests, 4 intended tests. `models/hh_current.py` mirrors
documented live behavior (bugs included); `models/hh_fixed.py` carries
the three reviewed fixes.

## Demo

`python3 demo.py` runs the whole workflow:
1. no bindings -> 9 UNIMPLEMENTED (skeleton before code),
2. bind current -> parity 5/5, intended 1/4 (three discriminate),
3. bind fixed -> intended 4/4, parity names the 3 reviewed deltas,
4. rerun -> 9 cache hits,
5. version bump -> invalidation, 0 hits,
6. fault injection -> FAILs surface, never fake passes.

## Layout

- `test_infra/` core, runner, receipts/cache/faults
- `batteries/` battery definitions (start here to add one)
- `models/` reference implementations under test
- `demo.py` end-to-end workflow proof
