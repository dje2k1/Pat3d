#!/bin/sh
# private build for the post role: dev/post/<SITE:-site>/{index,test}.html from the committed (HEAD) parts of the other
# roles plus the working-tree 15-post.js / 16-vfx.js (MIX=work: every part from the working tree). Served from the repo
# root at /dev/post/site/test.html (lib, assets, legacy are symlinks), so other roles' half-done edits don't break my
# runs and my runs never overwrite the shared test.html. SITE=site2 builds a second copy (experiments while an e2e run
# uses site/).
set -e
R=$(cd "$(dirname "$0")/../.." && pwd)
S="$R/dev/post/${SITE:-site}"
mkdir -p "$S/src"
for l in lib assets legacy; do [ -e "$S/$l" ] || ln -s "../../../$l" "$S/$l"; done
cp "$R/build.sh" "$S/build.sh"
for f in $(cd "$R/src" && ls); do
  case "$f" in
    15-post.js|16-vfx.js) cp "$R/src/$f" "$S/src/$f" ;;
    *) if [ "$MIX" = "work" ]; then cp "$R/src/$f" "$S/src/$f"; else git -C "$R" show "HEAD:src/$f" > "$S/src/$f"; fi ;;
  esac
done
sh "$S/build.sh"
