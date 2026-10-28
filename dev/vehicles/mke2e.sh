#!/bin/sh
# private copy of test/e2e.js that runs against dev/vehicles/site/test.html (my private build); shots in
# dev/vehicles/e2e-shots/, report in dev/vehicles/
R=$(cd "$(dirname "$0")/../.." && pwd)
sed -e "s#require('./serve.js')#require('../../test/serve.js')#" \
    -e "s#path.join(__dirname, 'page-helpers.js')#path.join(__dirname, '../../test/page-helpers.js')#" \
    -e "s#BASE + 'test.html'#BASE + 'dev/vehicles/site/test.html'#g" \
    -e "s#path.resolve(__dirname, '..')#path.resolve(__dirname, '../..')#" \
    -e "s#const SHOTS = path.join(ROOT, 'shots');#const SHOTS = path.join(__dirname, 'e2e-shots');#" \
    "$R/test/e2e.js" > "$R/dev/vehicles/e2e-private.js"
mkdir -p "$R/dev/vehicles/e2e-shots"
grep -c "dev/vehicles/site/test.html" "$R/dev/vehicles/e2e-private.js"
