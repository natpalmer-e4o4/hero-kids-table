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
# vocabulary from every book's text, for repairing OCR'd card titles
vocab = set()
for pid in os.listdir(out):
    pj = os.path.join(out, pid, "product.json")
    if os.path.isfile(pj):
        d = json.load(open(pj))
        txt = " ".join([d.get("intro_md", "")] + [e["md"] for e in d.get("encounters", [])] + [s["md"] for s in d.get("sections", [])])
        vocab |= {w.lower() for w in re.findall(r"[A-Za-z']{3,}", txt)}
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
        n_art = 0
        for c in d["cards"]:
            r = c["height"] / max(1, c["width"])
            if 1.36 <= r <= 1.46:
                c["kind"] = "npc"
            else:
                n_art += 1
                c["kind"], c["name"] = "art", f"Illustration {n_art}"
    for c in d.get("cards", []):
        if c.get("kind") in ("item", "npc") and c["height"] > c["width"] and not c.get("item_type"):
            from PIL import Image
            img = hk.flatten(Image.open(os.path.join(out, pid, c["file"])).convert("RGBA"))
            title, typ, body = hk.item_details(img)
            if len(title) >= 3:
                c["name"] = title
            c["item_type"], c["ocr"] = typ, body
    fixed = hk.repair_card_names(os.path.join(out, pid), d.get("cards", []), vocab)
    for cid, (old, new) in fixed.items():
        print(f"  {pid}: card '{old}' -> '{new}'")
        for t in d.get("tokens", []):
            if t.get("card") == cid:
                t["name"] = new
    # large monsters: card text says e.g. "occupy 2x2 squares"
    cards = {c["id"]: c for c in d.get("cards", [])}
    for t in d.get("tokens", []):
        c = cards.get(t.get("card"))
        m = re.search(r"occup\w*\s+(\d)\s*[x×]\s*(\d)", (c or {}).get("ocr", ""), re.I)
        if m:
            t["cells"] = max(int(m.group(1)), int(m.group(2)))
    json.dump(d, open(pj, "w"), indent=1, ensure_ascii=False)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(os.path.join(out, pid)) for f in fs)
    prods.append(dict(id=d["id"], title=d["title"], kind=d["kind"], maps=len(d["maps"]), cards=len(d["cards"]),
                      tokens=len(d["tokens"]), encounters=len(d.get("encounters", [])), bytes=size))
prods.sort(key=lambda p: (order[p["kind"]], p["title"]))
json.dump(dict(version=1, products=prods), open(os.path.join(out, "library.json"), "w"), indent=1)
print(f"{len(prods)} products, {sum(p['bytes'] for p in prods)/1e6:.0f} MB")
