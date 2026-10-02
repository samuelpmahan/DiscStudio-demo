"""test-infra core: tests as Parts, batteries as trees, guarantees.

PxC mapping (deliberate, minimal):
- A Test IS a Part: its identity is its address, not its current verdict.
- A Battery is a tree of Tests (seek(tree) for tests).
- A Guarantee is what a node declares (inputs/outputs/text). A Test binds
  to a Guarantee: the test is the executable form of the guarantee.
- UNIMPLEMENTED is a first-class verdict. The trace never pretends a stub
  did real work.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Union

# pyto source: PYTO_SRC overrides the local default (see SETUP-RECIPE.md).
sys.path.insert(0, os.environ.get(
    "PYTO_SRC",
    "/home/hatch/workspace/repos/DiscStudio-staging/pyto/src"))
from pyto import Part  # noqa: E402  (address type; identity is the address)


# ---------------------------------------------------------------------------
# Sentinels
# ---------------------------------------------------------------------------

class _Unimplemented:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self):
        return "UNIMPLEMENTED"

    def __bool__(self):
        return False


UNIMPLEMENTED = _Unimplemented()
"""Return value of a stub node: explicit, falsy, never a fake pass."""


class _Unbound:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self):
        return "UNBOUND"


UNBOUND = _Unbound()
"""Binding slot with no implementation yet."""


# ---------------------------------------------------------------------------
# Expectations: declarative, so tests stay data (Parts), not code.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Expectation:
    """Declarative expectation over a node's output.

    ops: eq | contains | true | false | none | raises:<ExcName> | custom
    `custom` names a predicate in the battery's predicate registry.
    """
    op: str
    operand: Any = None
    custom: str = ""


def check_expectation(exp: Expectation, actual: Any,
                      registry: Dict[str, Callable[[Any], bool]]) -> bool:
    if exp.op == "eq":
        return actual == exp.operand
    if exp.op == "contains":
        return exp.operand in actual
    if exp.op == "true":
        return actual is True
    if exp.op == "false":
        return actual is False
    if exp.op == "none":
        return actual is None
    if exp.op == "custom":
        pred = registry.get(exp.custom)
        if pred is None:
            raise KeyError(f"unknown predicate: {exp.custom!r}")
        return bool(pred(actual, exp.operand))
    raise ValueError(f"unknown expectation op: {exp.op!r}")


# ---------------------------------------------------------------------------
# Guarantee: what a node declares. Test: the executable form of a guarantee.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Guarantee:
    """What a node declares about itself (inputs/outputs/text).

    This is the contract dab's harness nodes publish; a Test binds to one.
    """
    node: str              # node address, e.g. "hh/wishlist/render"
    inputs: tuple          # declared input names
    outputs: tuple         # declared output names
    text: str              # human-readable guarantee


@dataclass(frozen=True)
class Test:
    """A test is a Part: addressable, versioned, composable.

    kind:
      "parity"   pins CURRENT behavior (bugs documented as bugs).
      "intended" pins a deliberate change (a fix). Failing against the
                 current model is how an intended test proves it
                 discriminates; it must go green against the fixed model.
    """
    address: str
    kind: str              # "parity" | "intended"
    target: str            # node address under test
    version: str           # test-definition version
    inputs: Dict[str, Any]
    expect: Expectation
    note: str = ""

    def __post_init__(self):
        if self.kind not in ("parity", "intended"):
            raise ValueError(f"kind must be parity|intended, got {self.kind!r}")
        # The address is a real PxC Part: identity is the address.
        object.__setattr__(self, "part", Part(self.address))

    part: Part = field(init=False, repr=False, compare=False)


@dataclass
class Battery:
    """A battery is a tree of Tests (and sub-batteries). seek(tree), but
    for tests: the tree declares the composed verification."""
    address: str
    children: List[Union["Test", "Battery"]] = field(default_factory=list)
    predicates: Dict[str, Callable[[Any], bool]] = field(default_factory=dict)

    def tests(self) -> List[Test]:
        out: List[Test] = []
        for child in self.children:
            if isinstance(child, Test):
                out.append(child)
            else:
                out.extend(child.tests())
        return out
