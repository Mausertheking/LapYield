"""One-off rebrand: Eco-Line Coach -> LapYield. Usage: python3 rename_lapyield.py <app-folder>"""
import os, sys
root = sys.argv[1]
reps = [('Eco-Line Coach', 'LapYield'), ('"short_name": "Eco-Line"', '"short_name": "LapYield"'),
        ('ecoline-${', 'lapyield-${'), ("'ecoline-v3'", "'lapyield-v4'"), ('?v=3', '?v=4'),
        ("eco-line-coach/1", "lapyield/1")]
changed = []
for dp, dn, fn in os.walk(root):
    if '.git' in dp: continue
    for f in fn:
        if not f.endswith(('.js', '.html', '.webmanifest', '.md', '.css', '.py', '.mjs')) or f == 'rename_lapyield.py': continue
        p = os.path.join(dp, f); s = open(p, encoding='utf-8').read(); o = s
        for a, b in reps: s = s.replace(a, b)
        if f == 'README.md': s = s.replace('eco-line-coach', 'LapYield')
        if s != o: open(p, 'w', encoding='utf-8').write(s); changed.append(os.path.relpath(p, root))
print('changed:', changed)
