import sys,json
d=json.load(open(sys.argv[1]))
n=int(sys.argv[2]) if len(sys.argv)>2 else 14
for q,v in d.items():
  for sp in v:
    print(q, sp.get('at'), 'calls', sp['calls'], 'tris', sp['tris'], 'world', sp.get('world'))
    if n: print('   ', ' | '.join(sp['top'][:n]))
