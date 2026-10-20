#!/bin/sh
# private copy of test/e2e.js that runs against dev/post/site/test.html (my private build), reports in dev/post/
R=$(cd "$(dirname "$0")/../.." && pwd)
sed -e "s#require('./serve.js')#require('../../test/serve.js')#" \
    -e "s#path.join(__dirname, 'page-helpers.js')#path.join(__dirname, '../../test/page-helpers.js')#" \
    -e "s#BASE + 'test.html'#BASE + 'dev/post/site/test.html'#g" \
    -e "s#path.resolve(__dirname, '..')#path.resolve(__dirname, '../..')#" \
    "$R/test/e2e.js" > "$R/dev/post/e2e-private.js"
grep -c "dev/post/site/test.html" "$R/dev/post/e2e-private.js"
