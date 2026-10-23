"""Додає ?v=<час> до локальних .js і .css у всіх HTML, щоб браузер і iPhone не тримали старі версії з кешу.
Запускати перед кожним комітом зі змінами коду сайту: python scripts/bump.py"""
import re, time
from pathlib import Path
v = str(int(time.time()))
for p in Path(__file__).resolve().parent.parent.glob("*.html"):
    t = p.read_text(encoding="utf-8")
    n = re.sub(r'((?:src|href)=")((?!https?:)[\w./-]+\.(?:js|css))(?:\?v=\d+)?(")', rf'\g<1>\g<2>?v={v}\g<3>', t)
    if n != t:
        p.write_text(n, encoding="utf-8")
print(v)
