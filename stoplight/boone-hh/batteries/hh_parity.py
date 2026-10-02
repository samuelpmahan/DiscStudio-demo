"""HH parity battery: DEFINES parity with current Homeroom Heroes.

Source: Claude's parity checklist (#collab-hh, from Engsmallz/hithero
@ cc195c2) + fixtures A/B/C.

Two kinds of tests, kept visibly separate:
- parity: pins CURRENT live behavior. Bugs are documented as bugs and
  pinned anyway, so the rewrite can't drop or silently change them.
- intended: pins a deliberate fix (fixtures A/B/C). An intended test
  FAILING against the current model is how it proves it discriminates;
  it must go green against the fixed model. Flipping a parity test from
  PASS to FAIL is only allowed as a reviewed delta, never silent drift.
"""
from test_infra import Battery, Expectation, Test

BATTERY_ADDRESS = "battery/hh-parity@v0"


def _t(address, kind, target, inputs, expect, note=""):
    return Test(address=f"test/hh/{address}", kind=kind,
                target=f"hh/{target}", version="v0", inputs=inputs,
                expect=expect, note=note)


def build() -> Battery:
    parity = Battery(address="battery/hh-parity/parity@v0", children=[
        _t("wishlist-affiliate-tag", "parity", "wishlist/render",
           {"url": "https://www.amazon.com/hz/wishlist/ls/ABC123"},
           Expectation("contains", "tag=h0mer00mher0-20"),
           "Every wishlist link gets the affiliate tag. Revenue: never drop."),
        _t("wishlist-any-link-accepted", "parity", "wishlist/render",
           {"url": "https://example.com/not-a-wishlist"},
           Expectation("contains", "tag=h0mer00mher0-20"),
           "BUG pinned: currently ANY link is accepted, no URL check."),
        _t("district-bypass", "parity", "teacher/approve",
           {"approval_district": "Granite Falls",
            "profile_district": "Everett"},
           Expectation("custom", operand="Everett",
                       custom="can_approve_in_eq"),
           "BUG pinned: authority follows the profile, not the approval."),
        _t("tod-loops-when-exhausted", "parity", "teacher/tod",
           {"featured_last_90d": ["amy", "bo"],
            "all_teachers": ["amy", "bo"]},
           Expectation("eq", "LOOP_FOREVER"),
           "BUG pinned: Teacher of the Day loops forever once everyone was "
           "featured in the last 90 days."),
        _t("tod-picks-unfeatured", "parity", "teacher/tod",
           {"featured_last_90d": ["amy"], "all_teachers": ["amy", "bo"]},
           Expectation("eq", "bo"),
           "Normal case pinned: picks an unfeatured teacher."),
    ])

    intended = Battery(address="battery/hh-parity/intended@v0", children=[
        _t("fix-district-authority", "intended", "teacher/approve",
           {"approval_district": "Granite Falls",
            "profile_district": "Everett"},
           Expectation("custom", operand="Granite Falls",
                       custom="can_approve_in_eq"),
           "Fixture A: approver's district comes from the approved record, "
           "never the profile."),
        _t("fix-wishlist-amazon-only", "intended", "wishlist/render",
           {"url": "https://example.com/not-a-wishlist"},
           Expectation("custom", custom="is_value_error"),
           "Fixture B: non-Amazon wishlist links are rejected."),
        _t("fix-wishlist-tag-as-param", "intended", "wishlist/render",
           {"url": "https://www.amazon.com/hz/wishlist/ls/ABC123?x=1"},
           Expectation("custom", custom="tag_is_real_query_param"),
           "Fixture B: tag is set as a real query parameter."),
        _t("fix-tod-none-eligible", "intended", "teacher/tod",
           {"featured_last_90d": ["amy", "bo"],
            "all_teachers": ["amy", "bo"]},
           Expectation("eq", "NONE_ELIGIBLE"),
           "Fixture C: returns NONE_ELIGIBLE instead of looping."),
    ])

    root = Battery(address=BATTERY_ADDRESS, children=[parity, intended])
    root.predicates = {
        "can_approve_in_eq":
            lambda actual, want: isinstance(actual, dict)
            and actual.get("can_approve_in") == want,
        "is_value_error":
            lambda actual, _: actual == "RAISED:ValueError",
        "tag_is_real_query_param":
            lambda actual, _: isinstance(actual, str) and (
                "?tag=h0mer00mher0-20" in actual
                or "&tag=h0mer00mher0-20" in actual),
    }
    return root
