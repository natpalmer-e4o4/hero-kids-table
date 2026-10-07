import json, os, sys
FIX = {("yuletide-journey", "card-003"): "Warg", ("heroes-ii", "card-007"): "Storm-Mage (Lighting Bolt)", ("pets-i", "card-011"): "Wolf"}
root = sys.argv[1]
for (pid, cid), name in FIX.items():
    pj = os.path.join(root, pid, "product.json")
    d = json.load(open(pj))
    for c in d["cards"]:
        if c["id"] == cid:
            c["name"] = name
            for t in d["tokens"]:
                if t.get("card") == cid:
                    t["name"] = name
    json.dump(d, open(pj, "w"), indent=1, ensure_ascii=False)
    print("fixed", pid, cid, name)
