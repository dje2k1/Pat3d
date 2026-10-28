#!/bin/sh
# private build for the entities role: dev/entities/<OUT>/{index,test}.html from the committed (HEAD) parts of the
# other roles plus my working-tree 40-entities.js (ENT=head: HEAD's too -> baseline; MIX=work: every part from the
# working tree). Served from the repo root at /dev/entities/<OUT>/test.html (lib, assets, legacy symlinked).
set -e
R=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${OUT:-site}
S="$R/dev/entities/$OUT"
mkdir -p "$S/src"
for l in lib assets legacy; do [ -e "$S/$l" ] || ln -s "../../../$l" "$S/$l"; done
cp "$R/build.sh" "$S/build.sh"
for f in $(cd "$R/src" && ls); do
  case "$f" in
    40-entities.js) if [ "$ENT" = "head" ]; then git -C "$R" show "HEAD:src/$f" > "$S/src/$f"; else cp "$R/src/$f" "$S/src/$f"; fi ;;
    *) if [ "$MIX" = "work" ]; then cp "$R/src/$f" "$S/src/$f"; else git -C "$R" show "HEAD:src/$f" > "$S/src/$f"; fi ;;
  esac
done
sh "$S/build.sh" >/dev/null && echo "built dev/entities/$OUT"
