"""test-infra: reusable test batteries that become automatable test infra.

Tests are Parts (addressable, versioned). Batteries are trees of tests.
The runner executes with log-and-return discipline, records receipts,
reuses content-addressed results, and never lets a stub fake a pass.
Built to plug into dab's harness via the guarantee contract; runs
standalone with plain callables too.
"""
from .core import (UNBOUND, UNIMPLEMENTED, Battery, Expectation, Guarantee,
                   Test)
from .runner import ERROR, FAIL, PASS, Report, Runner, TestResult

__all__ = ["UNBOUND", "UNIMPLEMENTED", "Battery", "Expectation", "Guarantee",
           "Test", "ERROR", "FAIL", "PASS", "Report", "Runner", "TestResult"]
