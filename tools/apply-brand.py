#!/usr/bin/env python3
"""Apply brand/brand.json (name, short name, English name, icon variant) across the app.
Usage: python3 tools/apply-brand.py   (then: node tools/build-store.js)"""
import json, os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = json.load(open(os.path.join(ROOT, "brand/brand.json"), encoding="utf-8"))
applied_p = os.path.join(ROOT, "brand/.applied.json")
A = json.load(open(applied_p, encoding="utf-8")) if os.path.exists(applied_p) else {
    "name": "دفتر الاستوديو", "short_name": "الدفتر", "name_en": "Studio Ledger"}
FILES = ["index.html", "app.js", "manifest.webmanifest", "privacy.html", "google-sheet-script.gs", "README.md", "store/listing.md"]
pairs = [(A["name"], B["name"]), (A["name_en"], B["name_en"])]
for f in FILES:
    p = os.path.join(ROOT, f)
    s = open(p, encoding="utf-8").read()
    for old, new in pairs:
        if old and old != new: s = s.replace(old, new)
    if f == "manifest.webmanifest":
        m = json.loads(s); m["short_name"] = B["short_name"]; s = json.dumps(m, ensure_ascii=False, indent=2)
    open(p, "w", encoding="utf-8").write(s)
shutil.copy(os.path.join(ROOT, "brand/icon-%s.svg" % B["icon"]), os.path.join(ROOT, "icons/icon.svg"))
json.dump({k: B[k] for k in ("name", "short_name", "name_en")}, open(applied_p, "w", encoding="utf-8"), ensure_ascii=False)
print("applied:", B["name"], "/", B["name_en"], "/ icon", B["icon"])
