#!/usr/bin/env python3
"""Merge per-product extraction folders into one library and (re)write library.json."""
import json, os, re, shutil, sys
src_root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
order = {"core": 0, "adventure": 1, "expansion": 2}
prods = []
for job in sorted(os.listdir(src_root)):
    jd = os.path.join(src_root, job)
    for pid in os.listdir(jd):
        pd = os.path.join(jd, pid)
        pj = os.path.join(pd, "product.json")
        if not os.path.isfile(pj):
            continue
        dst = os.path.join(out, pid)
        if os.path.abspath(pd) != os.path.abspath(dst):
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(pd, dst)
for pid in sorted(os.listdir(out)):
    pj = os.path.join(out, pid, "product.json")
    if not os.path.isfile(pj):
        continue
    d = json.load(open(pj))
    # normalise encounter ids ("4a") from each encounter's own heading
    changed = False
    for e in d.get("encounters", []):
        m = re.match(r"# Encounter (\d+\s*[a-z]?)\b\s*:?\s*(.*)", e.get("md", ""))
        if m:
            n, title = m.group(1).replace(" ", ""), m.group(2).strip() or e["title"]
            if str(e["n"]) != n or e["title"] != title:
                changed = True
            e["n"], e["title"] = n, title
        else:
            e["n"] = str(e["n"])
        for mp in d["maps"]:
            if mp["id"] == e.get("map"):
                mp["name"] = f"E{e['n']} · {e['title']}"
    if changed or any(isinstance(e["n"], str) for e in d.get("encounters", [])):
        json.dump(d, open(pj, "w"), indent=1, ensure_ascii=False)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(os.path.join(out, pid)) for f in fs)
    prods.append(dict(id=d["id"], title=d["title"], kind=d["kind"], maps=len(d["maps"]), cards=len(d["cards"]),
                      tokens=len(d["tokens"]), encounters=len(d.get("encounters", [])), bytes=size))
prods.sort(key=lambda p: (order[p["kind"]], p["title"]))
json.dump(dict(version=1, products=prods), open(os.path.join(out, "library.json"), "w"), indent=1)
print(f"{len(prods)} products, {sum(p['bytes'] for p in prods)/1e6:.0f} MB")
