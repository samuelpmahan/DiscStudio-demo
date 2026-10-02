"""Runner: log-and-return execution of a Battery against a binding.

Contract with dab's harness:
- dab's side owns node execution and the tree; each node declares
  inputs/outputs/guarantees and logs its invocation.
- this side owns the checks: a Battery binds Tests to node addresses, the
  runner invokes (or reuses), evaluates expectations, and records receipts.

Execution discipline (log-and-return):
- every invocation is logged BEFORE it runs (node, inputs hash, versions).
- a stub (unbound target) returns UNIMPLEMENTED explicitly: never a pass,
  never a fail. The trace shows exactly which guarantees have no
  implementation yet.
- a cache hit reuses the prior receipt: same (test, test version, target
  version, inputs) always yields the same verdict. Runner/classifier
  version changes invalidate (dab's stoplight finding, honored here).
- faults: a fault map forces named nodes to fail/raise, so a battery can
  assert the composition preserves valid state under injected failure
  (ladder rung 2: injected failures across composed operations).
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from .core import (UNBOUND, UNIMPLEMENTED, Battery, Expectation, Test,
                   check_expectation)

PASS, FAIL, UNIMPLEMENTED_V, ERROR = "PASS", "FAIL", "UNIMPLEMENTED", "ERROR"


def _hash_inputs(inputs: Dict[str, Any]) -> str:
    blob = json.dumps(inputs, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


@dataclass
class Receipt:
    """What ran, at what version, on what inputs, with what verdict.

    The PxC receipt concept, kept as plain data so it can live anywhere
    (file, Part store, pyto px.receipt.*). `env` names the execution
    environment ("local-headless" | "cloud-browser" | ...); it is part of
    the cache key, because a pass in one environment must never satisfy a
    run in another."""
    test_address: str
    test_version: str
    target: str
    target_version: str
    inputs_hash: str
    verdict: str
    ts: str = ""
    detail: str = ""
    env: str = "local"

    def key(self) -> str:
        raw = "|".join([self.test_address, self.test_version, self.target,
                        self.target_version, self.inputs_hash, self.env])
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "test": self.test_address, "test_version": self.test_version,
            "target": self.target, "target_version": self.target_version,
            "inputs_hash": self.inputs_hash, "verdict": self.verdict,
            "ts": self.ts, "detail": self.detail, "env": self.env,
        }


@dataclass
class TestResult:
    test: Test
    verdict: str
    actual: Any
    receipt: Receipt
    cached: bool
    trace: List[str] = field(default_factory=list)


@dataclass
class Report:
    battery: str
    results: List[TestResult]
    faults: Dict[str, str] = field(default_factory=dict)

    def counts(self) -> Dict[str, int]:
        c: Dict[str, int] = {}
        for r in self.results:
            c[r.verdict] = c.get(r.verdict, 0) + 1
        return c

    def summary(self) -> str:
        c = self.counts()
        parts = [f"{c.get(v, 0)} {v.lower()}" for v in
                 (PASS, FAIL, UNIMPLEMENTED_V, ERROR)]
        cached = sum(1 for r in self.results if r.cached)
        return (f"{self.battery}: " + ", ".join(parts) +
                f" ({cached} cache hits)")


class Runner:
    """Executes batteries. Binding maps node address -> callable | UNBOUND.

    target_versions maps node address -> version string of the bound
    implementation. A version change invalidates cached results for that
    node (no silent reuse across a changed classifier/runner).
    """

    def __init__(self, store_dir: Optional[str] = None):
        self._receipts: Dict[str, Receipt] = {}
        self._cache: Dict[str, TestResult] = {}
        if store_dir:
            self._load(store_dir)
        self._store_dir = store_dir

    # -- persistence -----------------------------------------------------
    def _load(self, store_dir: str):
        import os
        p = os.path.join(store_dir, "receipts.jsonl")
        if not os.path.exists(p):
            return
        with open(p) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                r = Receipt(**d)
                self._receipts[r.key()] = r

    def _persist(self, receipt: Receipt):
        if not self._store_dir:
            return
        import os
        os.makedirs(self._store_dir, exist_ok=True)
        with open(os.path.join(self._store_dir, "receipts.jsonl"), "a") as f:
            f.write(json.dumps(receipt.to_dict()) + "\n")

    # -- execution --------------------------------------------------------
    def run(self, battery: Battery,
            binding: Dict[str, Any],
            target_versions: Optional[Dict[str, str]] = None,
            faults: Optional[Dict[str, str]] = None,
            env: str = "local") -> Report:
        target_versions = target_versions or {}
        faults = faults or {}
        results = []
        for test in battery.tests():
            results.append(self._run_one(battery, test, binding,
                                         target_versions, faults, env))
        return Report(battery=battery.address, results=results, faults=faults)

    def _run_one(self, battery: Battery, test: Test,
                 binding: Dict[str, Any],
                 target_versions: Dict[str, str],
                 faults: Dict[str, str],
                 env: str = "local") -> TestResult:
        trace: List[str] = []
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        tver = target_versions.get(test.target, "unversioned")
        ihash = _hash_inputs(test.inputs)
        trace.append(f"invoke {test.target}@{tver} inputs#{ihash} "
                     f"for {test.address}@{test.version} env={env}")

        # stub discipline: unbound target -> UNIMPLEMENTED, explicitly.
        bound = binding.get(test.target, UNBOUND)
        if bound is UNBOUND or bound is None:
            trace.append(f"stub: {test.target} unbound -> UNIMPLEMENTED")
            receipt = Receipt(test.address, test.version, test.target, tver,
                              ihash, UNIMPLEMENTED_V, now,
                              "no implementation bound", env)
            self._persist(receipt)
            return TestResult(test, UNIMPLEMENTED_V, UNIMPLEMENTED, receipt,
                              False, trace)

        # fault injection (rung 2): force the node to fail/raise.
        fault = faults.get(test.target)
        if fault:
            trace.append(f"fault injected on {test.target}: {fault}")
            if fault == "raise":
                actual, verdict = None, ERROR
                trace.append("forced exception -> ERROR")
            else:  # "fail": node returns a wrong-shaped value
                actual, verdict = {"__fault__": True}, FAIL
                trace.append("forced bad value -> FAIL")
            receipt = Receipt(test.address, test.version, test.target, tver,
                              ihash, verdict, now, f"fault:{fault}", env)
            self._persist(receipt)
            return TestResult(test, verdict, actual, receipt, False, trace)

        # content-addressed reuse.
        probe = Receipt(test.address, test.version, test.target, tver,
                        ihash, "", now, env=env)
        hit = self._cache.get(probe.key())
        if hit is not None:
            trace.append(f"cache hit {probe.key()} -> reuse {hit.verdict}")
            return TestResult(test, hit.verdict, hit.actual, hit.receipt,
                              True, trace)

        # real invocation: log-and-return.
        try:
            actual = bound(dict(test.inputs))
        except Exception as e:  # noqa: BLE001 - the trace must show it
            trace.append(f"exception: {type(e).__name__}: {e} -> ERROR")
            receipt = Receipt(test.address, test.version, test.target, tver,
                              ihash, ERROR, now, f"{type(e).__name__}: {e}",
                              env)
            self._persist(receipt)
            return TestResult(test, ERROR, None, receipt, False, trace)

        try:
            ok = check_expectation(test.expect, actual, battery.predicates)
        except Exception as e:  # noqa: BLE001
            trace.append(f"expectation blew up: {e} -> ERROR")
            receipt = Receipt(test.address, test.version, test.target, tver,
                              ihash, ERROR, now, f"expectation: {e}", env)
            self._persist(receipt)
            return TestResult(test, ERROR, actual, receipt, False, trace)

        verdict = PASS if ok else FAIL
        trace.append(f"return {verdict} (actual={str(actual)[:120]!r})")
        receipt = Receipt(test.address, test.version, test.target, tver,
                          ihash, verdict, now, env=env)
        self._persist(receipt)
        result = TestResult(test, verdict, actual, receipt, False, trace)
        self._cache[probe.key()] = result
        return result
