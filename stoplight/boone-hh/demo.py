"""Demo: define requirements (tests), then assemble. End to end.

1. Battery defined. Nothing bound -> every test UNIMPLEMENTED.
   (The skeleton stands before the code exists.)
2. Bind hh_current (documents live behavior, bugs included).
   Parity 5/5 PASS; intended 1/4 (F3 pins preserved behavior, the other
   three FAIL: they discriminate).
3. Bind hh_fixed (fixtures A/B/C). Intended 4/4 PASS. Parity shows exactly
   the three reviewed deltas as FAIL; P1 and P5 still PASS (preserved).
4. Rerun unchanged -> all cache hits, instant. (PixelCache-style reuse.)
5. New target version -> cache invalidates, reruns. (Dab's stoplight
   finding: runner/classifier changes must invalidate.)
6. Fault injection: force wishlist/render to fail -> FAIL, never a fake
   pass. (Ladder rung 2: injected failures across composed operations.)
"""
import sys
import os
import json

# pyto source: PYTO_SRC overrides the local default (see SETUP-RECIPE.md).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get(
    "PYTO_SRC",
    "/home/hatch/workspace/repos/DiscStudio-staging/pyto/src"))

from test_infra import Battery, Runner, UNBOUND
from batteries import hh_parity
from models import hh_current, hh_fixed


def bind(model, wrap_render=False):
    def render(d, _model=model, _wrap=wrap_render):
        try:
            return _model.render_wishlist_link(d["url"])
        except ValueError:
            # Adapter: the battery's vocabulary for rejection is a value,
            # the implementation's native form is an exception.
            if _wrap:
                return "RAISED:ValueError"
            raise

    def approve(d):
        return model.approve_teacher(d["approval_district"],
                                     d["profile_district"])

    def tod(d):
        return model.pick_teacher_of_day(d["featured_last_90d"],
                                         d["all_teachers"])

    return {"hh/wishlist/render": render,
            "hh/teacher/approve": approve,
            "hh/teacher/tod": tod}


def show(report, title):
    print(f"\n=== {title} ===")
    print(report.summary())
    for r in report.results:
        if r.verdict != "PASS":
            print(f"  {r.verdict:13} {r.test.address} [{r.test.kind}]"
                  f"{' (cached)' if r.cached else ''}")
            if r.verdict == "FAIL":
                print(f"                 actual={str(r.actual)[:100]!r}")
    return report.counts()


class Expectations:
    """Counts EXPECTATIONS, not raw PASS/FAIL.

    An expectation is met when the observed outcome matches what the
    demo stage declared (e.g. "exactly these 3 parity tests FAIL as
    deliberate deltas"). A stoplight reads the summary: exit code agrees
    with the counts, never "failures with exit 0".
    """
    def __init__(self):
        self.met = 0
        self.unmet = []

    def check(self, cond, label):
        if cond:
            self.met += 1
        else:
            self.unmet.append(label)
            print(f"  EXPECTATION NOT MET: {label}")
        return cond


def main():
    exp = Expectations()
    # Receipt store: HH_PARITY_STORE overrides the local default so CI
    # can point it at a clean workspace.
    store = os.environ.get("HH_PARITY_STORE", "/tmp/hh-parity-store")
    import shutil
    shutil.rmtree(store, ignore_errors=True)
    runner = Runner(store_dir=store)
    battery = hh_parity.build()
    n_tests = len(battery.tests())
    print(f"battery {hh_parity.BATTERY_ADDRESS}: {n_tests} tests as Parts")

    # 1. Nothing bound: the skeleton stands before the code.
    r1 = runner.run(battery, {})
    c1 = show(r1, "run 1: no implementations bound")
    exp.check(c1.get("UNIMPLEMENTED", 0) == n_tests,
              f"run 1: all {n_tests} UNIMPLEMENTED when nothing bound")

    # 2. Bind current behavior. Parity must hold; intended must discriminate.
    cur = bind(hh_current)
    cur_ver = {k: hh_current.VERSION for k in cur}
    r2 = runner.run(battery, cur, target_versions=cur_ver)
    c2 = show(r2, "run 2: bound hh_current (live behavior, bugs included)")
    parity_pass = sum(1 for r in r2.results
                      if r.test.kind == "parity" and r.verdict == "PASS")
    intended_pass = sum(1 for r in r2.results
                        if r.test.kind == "intended" and r.verdict == "PASS")
    exp.check(parity_pass == 5,
              f"run 2: parity 5/5 PASS on hh_current (got {parity_pass})")
    exp.check(intended_pass == 1,
              f"run 2: intended 1/4 PASS on hh_current, rest discriminate "
              f"(got {intended_pass})")  # F3 pins preserved behavior

    # 3. Bind the fixed model. Intended goes green; parity names the deltas.
    fix = bind(hh_fixed, wrap_render=True)
    fix_ver = {k: hh_fixed.VERSION for k in fix}
    r3 = runner.run(battery, fix, target_versions=fix_ver)
    c3 = show(r3, "run 3: bound hh_fixed (fixtures A/B/C)")
    intended_pass3 = sum(1 for r in r3.results
                         if r.test.kind == "intended" and r.verdict == "PASS")
    parity_fail3 = [r.test.address for r in r3.results
                    if r.test.kind == "parity" and r.verdict == "FAIL"]
    exp.check(intended_pass3 == 4,
              f"run 3: intended 4/4 PASS on hh_fixed (got {intended_pass3})")
    exp.check(len(parity_fail3) == 3,
              f"run 3: exactly 3 parity FAILs as deliberate deltas "
              f"(got {len(parity_fail3)})")
    print("  deliberate deltas (reviewed, not drift):")
    for a in parity_fail3:
        print(f"    - {a}")

    # 4. Rerun unchanged: every result reused.
    r4 = runner.run(battery, fix, target_versions=fix_ver)
    c4 = show(r4, "run 4: rerun unchanged")
    exp.check(all(r.cached for r in r4.results),
              "run 4: every result reused from cache")

    # 5. Version bump invalidates (no silent reuse across a changed runner).
    fix_ver2 = {k: v + "+rebuild" for k, v in fix_ver.items()}
    r5 = runner.run(battery, fix, target_versions=fix_ver2)
    c5 = show(r5, "run 5: target version bumped")
    exp.check(not any(r.cached for r in r5.results),
              "run 5: version bump invalidates the cache")

    # 6. Fault injection: forced failure surfaces as FAIL, never a fake pass.
    r6 = runner.run(battery, fix, target_versions=fix_ver,
                    faults={"hh/wishlist/render": "fail"})
    c6 = show(r6, "run 6: fault injected on hh/wishlist/render")
    faulted = [r for r in r6.results if r.test.target == "hh/wishlist/render"]
    exp.check(all(r.verdict == "FAIL" for r in faulted),
              "run 6: faulted tests FAIL, never a fake pass")
    exp.check(all(r.verdict != "UNIMPLEMENTED" for r in faulted),
              "run 6: faulted tests are executed, not skipped")

    # Show one trace: log-and-return, invocation logged before it runs.
    print("\n=== trace: one log-and-return invocation ===")
    for line in r3.results[0].trace:
        print("  " + line)

    # Stoplight summary: expectations, not raw verdicts. The exit code
    # agrees with the counts.
    n_fail = len(exp.unmet)
    print(f"\n# tests {n_tests}")
    print(f"# pass {exp.met}")
    print(f"# fail {n_fail}")
    print(json.dumps({"tests": n_tests, "pass": exp.met, "fail": n_fail}))
    if exp.unmet:
        print("\nunmet expectations:")
        for label in exp.unmet:
            print(f"  - {label}")
        sys.exit(1)
    print("\nDEMO GREEN: requirements defined as tests, then assembled.")
    print("Parity with current HH is pinned; fixes are explicit deltas.")


if __name__ == "__main__":
    main()
