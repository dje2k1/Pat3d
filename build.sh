#!/bin/sh
# Assembles the game (v3, three.js r186 WebGPURenderer) from the parts in src/:
#   index.html  full document played on GitHub Pages: head + HUD markup from src/00-shell.html, the import map, ONE
#               <script type="module"> = the THREE/TSL imports + every .js part concatenated (IIFEs sharing K)
#   test.html   the same page with window.__K / window.THREE exposed, used by test/e2e.js (not committed)
# legacy/ (frozen v2 build, three r128 from cdnjs/jsDelivr) is not rebuilt.
# A part may start with its own top-level `import { x } from 'three/addons/...';` lines (before its IIFE): imports
# are hoisted, so every local name must be unique across all parts (prefix it with the part's role if in doubt).
set -e
cd "$(dirname "$0")"
PARTS="10-core.js 12-tex.js 15-post.js 16-vfx.js 20-world.js 25-city.js 26-vehicles.js 30-player.js 35-board.js 40-entities.js 90-main.js"
fail() { echo "ERROR: $1" >&2; exit 1; }
[ -f src/00-shell.html ] || fail "missing part src/00-shell.html"
for f in $PARTS; do [ -f "src/$f" ] || fail "missing part src/$f"; done
grep -q '^<!-- BODY -->$' src/00-shell.html || fail "src/00-shell.html needs the <!-- BODY --> line between head and body markup"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# ---- each part parses on its own as an ES module
for f in $PARTS; do
  cp "src/$f" "$tmp/${f%.js}.mjs"
  node --check "$tmp/${f%.js}.mjs" || fail "src/$f does not parse"
done

# ---- no GLSL / legacy pipeline left in the sources
bad=$(grep -nE 'onBeforeCompile|ShaderMaterial|RawShaderMaterial|EffectComposer|gl_FragColor|#include <|WebGLRenderer\(|outputEncoding|sRGBEncoding' src/*.js src/00-shell.html || true)
[ -z "$bad" ] || fail "GLSL / r128 API left in src (port it to TSL):
$bad"

# ---- the module: imports, K, the parts
mod="$tmp/module.mjs"
{
  printf '%s\n' "import * as THREE from 'three/webgpu';"
  printf '%s\n' "import * as TSL from 'three/tsl';"
  printf '%s\n' "const K = {};"
  for f in $PARTS; do printf '// ---------------- src/%s\n' "$f"; cat "src/$f"; printf '\n'; done
} > "$mod"
node --check "$mod" || fail "the assembled module does not parse (duplicate import names across parts?)"
grep -q '</script' "$mod" && fail "a part contains </script"
hook='const start = data => K.boot(data);'
n=$(grep -cF "$hook" "$mod" || true)
[ "$n" = "1" ] || fail "boot hook line found $n times"

# ---- every import resolves to a vendored file (recursively through the addons' own relative imports)
resolve() { # $1 = specifier, $2 = importing file (for relative ones)
  case "$1" in
    three|three/webgpu) echo lib/three/three.webgpu.js ;;
    three/tsl) echo lib/three/three.tsl.js ;;
    three/addons/*) echo "lib/three/addons/${1#three/addons/}" ;;
    ./*|../*) echo "$(dirname "$2")/$1" ;;
    *) echo "UNRESOLVED:$1" ;;
  esac
}
# (comment lines are skipped: addons quote import lines in their doc comments, e.g. FSR1Node.js's @three_import)
specs() { sed -e 's#^[[:space:]]*\*.*##' -e 's#^[[:space:]]*//.*##' "$1" | grep -oE "(^|[;}[:space:]])(import|export)[^;'\"]*from[[:space:]]*['\"][^'\"]+['\"]|^[[:space:]]*import[[:space:]]*['\"][^'\"]+['\"]|^[[:space:]]*}[[:space:]]*from[[:space:]]*['\"][^'\"]+['\"]" | grep -oE "['\"][^'\"]+['\"]$" | tr -d "'\"" | sort -u; }
seen="$tmp/seen"; : > "$seen"
queue="$tmp/queue"; specs "$mod" | while read -r s; do resolve "$s" "$mod"; done > "$queue"
while [ -s "$queue" ]; do
  next="$tmp/next"; : > "$next"
  while read -r f; do
    case "$f" in UNRESOLVED:*) fail "import '${f#UNRESOLVED:}' is not mapped (use three, three/webgpu, three/tsl or three/addons/...)" ;; esac
    f=$(realpath -m --relative-to=. "$f")
    grep -qxF "$f" "$seen" && continue
    [ -f "$f" ] || fail "imported file $f is not vendored under lib/"
    echo "$f" >> "$seen"
    case "$f" in lib/three/three.*.js) continue ;; esac  # the builds only import each other
    specs "$f" | while read -r s; do resolve "$s" "$f"; done >> "$next"
  done < "$queue"
  mv "$next" "$queue"
done
[ -f lib/three/three.core.js ] || fail "lib/three/three.core.js missing"

# ---- the document
head_part="$tmp/head.html"; body_part="$tmp/body.html"
sed '/^<!-- BODY -->$/,$d' src/00-shell.html > "$head_part"
sed '1,/^<!-- BODY -->$/d' src/00-shell.html > "$body_part"
importmap='<script type="importmap">{"imports":{"three":"./lib/three/three.webgpu.js","three/webgpu":"./lib/three/three.webgpu.js","three/tsl":"./lib/three/three.tsl.js","three/addons/":"./lib/three/addons/"}}</script>'
# shown when the module graph cannot load or run at all (no import maps / ES modules, a missing file): French
# message + link to the classic version; the game itself reports renderer failures through the same overlay
fallback='<script>
window.__kitFail = function (msg) {
  var f = document.getElementById("fatal"); if (!f) return;
  if (msg) { var m = document.getElementById("fatal-msg"); if (m) m.textContent = msg; }
  f.hidden = false;
};
window.addEventListener("error", function (e) {
  if (!window.__kitRun && e && !(e.target && e.target !== window)) window.__kitFail("Le jeu n’a pas pu se charger (" + (e.message || "erreur de script") + ").");
});
</script>
<script nomodule>window.__kitFail("Ce navigateur est trop ancien pour la version 3D moderne du jeu.");</script>'
build_doc() { # $1 = output, $2 = extra line injected before the boot hook (test only)
  {
    printf '%s\n' '<!doctype html>'
    printf '%s\n' '<html lang="fr">'
    printf '%s\n' '<head>'
    printf '%s\n' '<meta charset="utf-8">'
    printf '%s\n' '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    printf '%s\n' '<meta name="description" content="Kit Rush 3D : un jeu de plateforme 3D rapide dans le navigateur, sur PC et téléphone.">'
    printf '%s\n' '<meta name="theme-color" content="#070a1d">'
    cat "$head_part"
    printf '%s\n' '</head>'
    printf '%s\n' '<body>'
    cat "$body_part"
    printf '%s\n' "$fallback"
    printf '%s\n' "$importmap"
    printf '%s\n' '<script type="module" onerror="window.__kitFail &amp;&amp; window.__kitFail()">'
    printf '%s\n' 'window.__kitRun = true;'
    if [ -n "$2" ]; then
      sed "s|^const start = data => K.boot(data);|$2\nconst start = data => K.boot(data);|" "$mod"
    else
      cat "$mod"
    fi
    printf '%s\n' '</script>'
    printf '%s\n' '</body>'
    printf '%s\n' '</html>'
  } > "$1"
}
build_doc index.html ""
build_doc test.html "window.__K = K; window.THREE = THREE;"

# ---- shipped-file checks
grep -q '__K' index.html && fail "index.html contains __K"
grep -q 'window.__K = K;' test.html || fail "__K injection failed"
head -c 15 index.html | grep -qi '^<!doctype html>' || fail "index.html must start with <!doctype html>"
grep -q '<title>Kit Rush 3D</title>' index.html || fail "title missing"
n=$(grep -c '<script type="module"' index.html || true); [ "$n" = "1" ] || fail "expected ONE module script, found $n"
ext=$(grep -oE 'https?://[^"'"'"' )<>]*' index.html | grep -vE '^https://fonts\.(googleapis|gstatic)\.com' | sort -u || true)
[ -z "$ext" ] || fail "external URL(s) in index.html (only Google Fonts allowed):
$ext"
[ -f legacy/index.html ] || fail "legacy/index.html missing"
echo "built index.html ($(wc -c < index.html) bytes, $(wc -l < "$seen") vendored module files) and test.html ($(wc -c < test.html) bytes)"
