#!/bin/sh
# Assembles the game from the parts in src/:
#   index.html        full document, played on GitHub Pages
#   kit-rush-3d.html  the same page in Claude Artifact form (no document tags)
#   test.html         full document with window.__K exposed, used by test/e2e.js (not committed)
set -e
cd "$(dirname "$0")"
PARTS="00-shell.html 10-core.js 15-post.js 16-vfx.js 20-world.js 25-city.js 30-player.js 35-board.js 40-entities.js 90-main.js"
for f in $PARTS; do [ -f "src/$f" ] || { echo "ERROR: missing part src/$f" >&2; exit 1; }; done
for f in 10-core.js 15-post.js 16-vfx.js 20-world.js 25-city.js 30-player.js 35-board.js 40-entities.js; do node --check "src/$f"; done
# 90-main.js ends with the closing </script>; check it without that line
sed '$d' src/90-main.js > .main-check.js && node --check .main-check.js && rm -f .main-check.js
out=kit-rush-3d.html
: > "$out"
for f in $PARTS; do cat "src/$f" >> "$out"; printf '\n' >> "$out"; done
fail() { echo "ERROR: $1" >&2; exit 1; }
if grep -q '__K' "$out"; then fail "shipped file contains __K"; fi
head -c 26 "$out" | grep -q '^<title>Kit Rush 3D</title>' || fail "shipped file must start with <title>"
if grep -qiE '<!doctype|<html[ >]|</html>|<head[ >]|</head>|<body[ >]|</body>' "$out"; then fail "shipped file has document tags"; fi
# external resources: cdnjs three r128, the jsDelivr three@0.128.0 example scripts, Google Fonts; nothing else
bad=$(grep -oE '(src|href)="https?://[^"]*"' "$out" | grep -vE '^src="https://cdnjs\.cloudflare\.com/ajax/libs/three\.js/r128/three\.min\.js"$' \
  | grep -vE '^src="https://cdn\.jsdelivr\.net/npm/three@0\.128\.0/examples/js/(shaders|postprocessing)/[A-Za-z0-9]+\.js"$' \
  | grep -vE '^href="https://fonts\.(googleapis|gstatic)\.com[^"]*"$' || true)
[ -z "$bad" ] || fail "unexpected external resource(s): $bad"
for u in $(grep -oE 'src="https://cdn\.jsdelivr\.net/npm/three@0\.128\.0/examples/js/[^"]*"' "$out" | sed 's|^src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/||; s|"$||'); do
  [ -f "vendor/examples/$u" ] || fail "no vendored copy for $u (tests could not route it)"
done
hook='const start = data => K.boot(data);'
n=$(grep -cF "$hook" "$out" || true)
[ "$n" = "1" ] || fail "boot hook line found $n times"
doc_open='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
{
  printf '%s\n' "$doc_open"
  cat "$out"
  printf '%s\n' '</body></html>'
} > index.html
{
  printf '%s' "$doc_open"
  sed "s|^const start = data => K.boot(data);|window.__K = K;\nconst start = data => K.boot(data);|" "$out"
  printf '%s\n' '</body></html>'
} > test.html
grep -q 'window.__K = K;' test.html || fail "__K injection failed"
echo "built index.html ($(wc -c < index.html) bytes), $out ($(wc -c < "$out") bytes) and test.html ($(wc -c < test.html) bytes)"
