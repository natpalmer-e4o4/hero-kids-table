#!/usr/bin/env python3
"""Merge per-product extraction folders into one library and (re)write library.json."""
import json, os, re, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hk_extract as hk
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
    # re-split encounters on their headings (older extractions split per page)
    if d.get("kind") == "adventure":
        head = lambda md: md.split("\n", 1)[0].strip()
        old_maps = {head(e["md"]): e.get("map") for e in d.get("encounters", [])}
        old_pages = {head(e["md"]): e.get("pages", []) for e in d.get("encounters", [])}
        full = "\n\n".join([d.get("intro_md", "")] + [e["md"] for e in d.get("encounters", [])])
        intro, encs = hk.split_encounters(full)
        for e in encs:
            e["map"] = old_maps.get(head(e["md"]))
            e["pages"] = old_pages.get(head(e["md"]), [])
        d["intro_md"], d["encounters"] = intro, encs
        for mp in d["maps"]:
            mp["name"] = f"Map {int(mp['id'].split('-')[1])}"
        for e in encs:
            for mp in d["maps"]:
                if mp["id"] == e.get("map") and mp["name"].startswith("Map "):
                    mp["name"] = f"E{e['n']} · {e['title']}"
    # readable names for figures with no matching card
    k = 0
    for t in d.get("tokens", []):
        if t["name"].startswith("token-"):
            k += 1
            t["name"] = f"Figure {k} ({d['title']})"
    if "Gazetteer" in d["title"]:
        for c in d["cards"]:
            c["kind"] = "npc"
    json.dump(d, open(pj, "w"), indent=1, ensure_ascii=False)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(os.path.join(out, pid)) for f in fs)
    prods.append(dict(id=d["id"], title=d["title"], kind=d["kind"], maps=len(d["maps"]), cards=len(d["cards"]),
                      tokens=len(d["tokens"]), encounters=len(d.get("encounters", [])), bytes=size))
prods.sort(key=lambda p: (order[p["kind"]], p["title"]))
json.dump(dict(version=1, products=prods), open(os.path.join(out, "library.json"), "w"), indent=1)
print(f"{len(prods)} products, {sum(p['bytes'] for p in prods)/1e6:.0f} MB")
