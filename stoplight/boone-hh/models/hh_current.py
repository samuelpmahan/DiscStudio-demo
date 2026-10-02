"""Reference model of CURRENT Homeroom Heroes live behavior.

Source: Claude's parity checklist (read from Engsmallz/hithero @ cc195c2,
posted in #collab-hh 2026-10-02). Bugs are modeled faithfully and marked;
the parity battery pins them so the rewrite can't drop or silently change
them. Fixes live in hh_fixed.py as explicit, reviewed deltas.
"""

AFFILIATE_TAG = "h0mer00mher0-20"


def render_wishlist_link(url: str) -> str:
    """Current: EVERY wishlist link gets the tag appended. No URL check:
    any link is accepted."""
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}tag={AFFILIATE_TAG}"


def approve_teacher(approval_district: str, profile_district: str) -> dict:
    """Current (BUG): approval doesn't carry the district over. The teacher
    types their school again when making a profile, so someone approved in
    one district can list themselves in another and approve people there."""
    return {
        "approved_district": approval_district,
        "profile_district": profile_district,
        # BUG: authority follows the profile, not the approval.
        "can_approve_in": profile_district,
    }


def pick_teacher_of_day(featured_last_90d: list, all_teachers: list):
    """Current (BUG): Teacher of the Day loops forever once everyone has
    been featured in the last 90 days. Modeled as an explicit LOOP
    sentinel so the battery can pin the behavior without hanging."""
    eligible = [t for t in all_teachers if t not in featured_last_90d]
    if not eligible:
        return "LOOP_FOREVER"
    return eligible[0]


VERSION = "hh-current@cc195c2"
