import sys, json
for f in sys.argv[1:]:
    for l in open(f):
        if l.startswith('KITCOST '):
            d = json.loads(l[8:])
            for k, v in d.items():
                t = v.get('total', {}); lk = v.get('look', {})
                print(f, k, 'kit calls', v['calls'], 'kit tris', v['tris'], '| frame calls', t.get('frameCalls'), 'tris', t.get('frameTris'), '| shells', lk.get('furShells'), 'res', lk.get('res'))
