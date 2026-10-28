#!/bin/sh
# private build of the working tree: dev/integrator/<OUT>/{index,test}.html (lib, assets, legacy symlinked), served
# from the repo root at /dev/integrator/<OUT>/test.html (lets a long e2e run keep using the root test.html)
set -e
R=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${OUT:-site}
S="$R/dev/integrator/$OUT"
mkdir -p "$S/src"
for l in lib assets legacy vendor; do [ -e "$S/$l" ] || ln -s "../../../$l" "$S/$l"; done
cp "$R/build.sh" "$S/build.sh"
rm -f "$S/src/"*
cp "$R/src/"* "$S/src/"
sh "$S/build.sh" | tail -1
