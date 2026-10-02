"""Reference model of the INTENDED Homeroom Heroes behavior.

Each fix corresponds to one of Claude's test fixtures A/B/C
(#collab-hh). These are deliberate, reviewed deltas from hh_current.py,
not silent drift: the parity battery forces every delta to be explicit.
"""

AFFILIATE_TAG = "h0mer00mher0-20"


def render_wishlist_link(url: str) -> str:
    """Intended (fixture B): wishlist must be an Amazon wishlist link, and
    the tag is set as a real query parameter."""
    if "amazon." not in url:
        raise ValueError(f"not an Amazon wishlist link: {url}")
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}tag={AFFILIATE_TAG}"


def approve_teacher(approval_district: str, profile_district: str) -> dict:
    """Intended (fixture A): the approver's district comes from the
    approved record, never the profile."""
    return {
        "approved_district": approval_district,
        "profile_district": profile_district,
        "can_approve_in": approval_district,
    }


def pick_teacher_of_day(featured_last_90d: list, all_teachers: list):
    """Intended (fixture C): returns NONE_ELIGIBLE instead of looping."""
    eligible = [t for t in all_teachers if t not in featured_last_90d]
    if not eligible:
        return "NONE_ELIGIBLE"
    return eligible[0]


VERSION = "hh-fixed@fixtures-A/B/C"
