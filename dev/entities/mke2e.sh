#!/bin/sh
# private copy of test/e2e.js that runs against dev/entities/site/test.html (my private build), reports in dev/entities/
R=$(cd "$(dirname "$0")/../.." && pwd)
SITE=${SITE:-site}
sed -e "s#require('./serve.js')#require('../../test/serve.js')#" \
    -e "s#path.join(__dirname, 'page-helpers.js')#path.join(__dirname, '../../test/page-helpers.js')#" \
    -e "s#BASE + 'test.html'#BASE + 'dev/entities/$SITE/test.html'#g" \
    -e "s#path.resolve(__dirname, '..')#path.resolve(__dirname, '../..')#" \
    "$R/test/e2e.js" > "$R/dev/entities/e2e-private.js"
grep -c "dev/entities/$SITE/test.html" "$R/dev/entities/e2e-private.js"
sed -i "s#const SHOTS = path.join(ROOT, 'shots');#const SHOTS = path.join(ROOT, 'dev/entities/e2eshots');#" "$R/dev/entities/e2e-private.js"
mkdir -p "$R/dev/entities/e2eshots"
