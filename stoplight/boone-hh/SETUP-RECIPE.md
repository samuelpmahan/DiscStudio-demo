# test-infra — setup recipe (fresh machine)

Verified 2026-10-02 on the build box (`python3 demo.py` → "DEMO GREEN").

## 1. Prerequisites

- Python 3.10+ (stdlib only otherwise: dataclasses, hashlib, json, time).
- The `pyto` package — Sam's dependency-free PxC Python package. Only
  `pyto.Part` is used (test identity as address).

## 2. pyto source

pyto is NOT on PyPI. Get it from the DiscStudio-staging repo, directory
`pyto/src` (the package lives in `src/`). On the build box the path is
`/home/hatch/workspace/repos/DiscStudio-staging/pyto/src`.

Point at it with the `PYTO_SRC` env var:

```
export PYTO_SRC=/path/to/DiscStudio-staging/pyto/src
```

Both `demo.py` and `test_infra/core.py` honor `PYTO_SRC`; each falls back
to the build-box path above when it is unset. On a fresh machine you can
also drop a `pyto/` package directory next to `test-infra/` and set
`PYTO_SRC` to its parent (or delete the `sys.path.insert` line).

## 3. Layout (upload/download this tree as-is)

- `test_infra/` — core, runner, receipts/cache/fault injection
- `batteries/` — battery definitions (start here to add one)
- `models/` — reference implementations under test
- `demo.py` — end-to-end workflow proof
- `README.md` — concepts

## 4. Proof run

```
cd test-infra
python3 demo.py
```

Expected final summary (expectations, not raw verdicts):

```
# tests 9
# pass <expectations met>
# fail <expectations not met>
{"tests": 9, "pass": <met>, "fail": <unmet>}
```

Exit code is 0 only when every expectation is met (a stoplight treats
"failures with exit 0" as an inconsistent run).

Receipts live in `/tmp/hh-parity-store` by default; set `HH_PARITY_STORE`
to point the run at a clean workspace (e.g. in CI):

```
HH_PARITY_STORE=/tmp/ci-hh-parity python3 demo.py
```

9 tests: 5 parity pinned against current HH behavior; 4 intended fixes;
cache-hit replay, version-bump invalidation, fault injection all exercised.
