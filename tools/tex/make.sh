#!/bin/sh
# Regenerates every texture: runs each tools/tex/<role>_*.py (they write assets/tex/<role>/ and merge its manifest).
# Usage: tools/tex/make.sh [role ...]   (no argument = every role)
set -e
cd "$(dirname "$0")/../.."
if [ $# -eq 0 ]; then set -- foundation post kit world city vehicles entities; fi
for role in "$@"; do
  for f in tools/tex/"$role"_*.py; do
    [ -f "$f" ] || continue
    echo "== $f"
    python3 "$f"
  done
done
du -sh assets 2>/dev/null || true
