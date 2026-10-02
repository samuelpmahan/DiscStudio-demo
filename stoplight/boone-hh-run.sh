#!/bin/sh
# Runs Boone's HH parity battery (boone-hh/, from Drive nctk-claude/test-infra) for the stoplight.
# pyto is pinned to an exact DiscStudio-staging commit so delta reuse stays honest.
# Usage: sh boone-hh-run.sh            -> the battery as shipped
#        sh boone-hh-run.sh district   -> broken copy: approval authority follows the profile again
set -eu
PYTO_COMMIT=941f3544f82f80f88c7228abec646b0889d575fa
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if [ -z "${PYTO_SRC:-}" ]; then
  git init -q "$work/staging"
  git -C "$work/staging" fetch -q --depth 1 https://github.com/samuelpmahan/DiscStudio-staging "$PYTO_COMMIT"
  git -C "$work/staging" checkout -q FETCH_HEAD
  PYTO_SRC="$work/staging/pyto/src"
fi
cp -R "$here/boone-hh" "$work/battery"
if [ "${1:-}" = district ]; then
  sed -i 's/"can_approve_in": approval_district/"can_approve_in": profile_district/' "$work/battery/models/hh_fixed.py"
  grep -q '"can_approve_in": profile_district' "$work/battery/models/hh_fixed.py" || { echo "broken copy not applied"; exit 2; }
fi
cd "$work/battery"
PYTO_SRC="$PYTO_SRC" HH_PARITY_STORE="$work/store" python3 demo.py
