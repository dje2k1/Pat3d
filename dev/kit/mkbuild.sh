#!/bin/sh
# private build for the kit role: dev/kit/<OUT>/{index,test}.html from the committed (HEAD) parts of the other roles
# plus my working-tree 30-player.js / 35-board.js (KIT=head: HEAD's too -> baseline; MIX=work: every part from the
# working tree). Served from the repo root at /dev/kit/<OUT>/test.html (lib, assets, legacy symlinked).
set -e
R=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${OUT:-site}
S="$R/dev/kit/$OUT"
mkdir -p "$S/src"
for l in lib assets legacy; do [ -e "$S/$l" ] || ln -s "../../../$l" "$S/$l"; done
cp "$R/build.sh" "$S/build.sh"
for f in $(cd "$R/src" && ls); do
  case "$f" in
    30-player.js|35-board.js) if [ "$KIT" = "head" ]; then git -C "$R" show "HEAD:src/$f" > "$S/src/$f"; else cp "$R/src/$f" "$S/src/$f"; fi ;;
    *) if [ "$MIX" = "work" ]; then cp "$R/src/$f" "$S/src/$f"; else git -C "$R" show "HEAD:src/$f" > "$S/src/$f"; fi ;;
  esac
done
sh "$S/build.sh" >/dev/null && echo "built dev/kit/$OUT"
