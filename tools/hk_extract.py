#!/usr/bin/env python3
"""
Hero Kids -> Owlbear Rodeo library extractor.

Reads the Hero Kids PDFs (DriveThruRPG folder layout) and writes a library
folder that the "Hero Kids Table" Owlbear extension imports:

  <out>/library.json
  <out>/<product-id>/product.json     text sections, encounters, maps, cards, tokens
  <out>/<product-id>/maps/*.jpg       grid-aligned: 1 square = 150 px
  <out>/<product-id>/cards/*.webp     hero / monster / item cards
  <out>/<product-id>/tokens/*.webp    stand-up art with transparency

Usage:
  python3 hk_extract.py <hero-forge-games-folder> <out-folder> [--only substr ...]
"""
import argparse, io, json, os, re, subprocess, sys, tempfile, unicodedata, collections
import numpy as np
import pymupdf as fitz
from PIL import Image
from scipy.signal import find_peaks

CELL = 200           # px per grid square in exported maps (Owlbear image dpi)
MAP_RENDER_DPI = 240
SKIP = ("Printer_Friendly", "_-_BW", "POD_Version")

# ---------------------------------------------------------------- utilities

def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def area(b):
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])

def xref_rgba(doc, xref):
    """Embedded image (with its soft mask) as an RGBA PIL image."""
    info = doc.extract_image(xref)
    img = Image.open(io.BytesIO(info["image"]))
    if img.mode == "CMYK":
        img = img.convert("RGB")
    img = img.convert("RGBA")
    sm = info.get("smask")
    if sm:
        m = Image.open(io.BytesIO(doc.extract_image(sm)["image"])).convert("L")
        if m.size != img.size:
            m = m.resize(img.size)
        img.putalpha(m)
    return img

def ocr(img, psm=6):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        img.save(f.name)
        try:
            r = subprocess.run(["tesseract", f.name, "-", "--psm", str(psm)],
                               capture_output=True, text=True, timeout=60)
            return r.stdout
        except Exception:
            return ""
        finally:
            os.unlink(f.name)

# ---------------------------------------------------------- page classifier

def classify(page):
    pa = page.rect.width * page.rect.height
    info = page.get_image_info(xrefs=True)
    words = len(page.get_text().split())
    full = [i for i in info if area(i["bbox"]) > 0.8 * pa]
    cards = [i for i in info if 0.12 * pa < area(i["bbox"]) < 0.4 * pa]
    small = collections.Counter(i["xref"] for i in info
                                if area(i["bbox"]) < 0.03 * pa and (i["bbox"][3] - i["bbox"][1]) > 35)
    repeated = sum(1 for v in small.values() if v >= 2)
    if words > 150:
        return "text"
    if len(full) >= 2:
        return "map"
    if len(cards) >= 2 or (len(cards) == 1 and repeated == 0):
        return "cards"
    if repeated >= 2:
        return "standups"
    if len(full) == 1 and words < 30:
        return "art"
    return "other"

# ------------------------------------------------------------ text -> md

def page_markdown(page, title_is_h2=False):
    """Two-column Hero Kids page -> markdown. Italic body = read-aloud (>)."""
    W = page.rect.width
    lines = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            spans = [s for s in l["spans"] if s["text"].strip()]
            if not spans:
                continue
            size = max(s["size"] for s in spans)
            if size < 9:            # running footer
                continue
            text = "".join(s["text"] for s in l["spans"]).strip()
            text = re.sub(r"\s+", " ", text)
            fonts = " ".join(s["font"] for s in spans)
            x0 = l["bbox"][0]
            col = 0 if x0 < W / 2 - 10 else 1
            kind = "body"
            if "Monogram" in fonts:
                kind = "h1"
            elif size >= 18.5:
                kind = "h2" if title_is_h2 else "h1"
            elif "Bold" in fonts and size >= 15:
                kind = "h2"
            elif size >= 15:           # small-caps chapter headings in the rulebook
                kind = "h1"
            elif all("Italic" in s["font"] for s in spans):
                kind = "read"
            if text in ("•",):
                kind = "bullet-mark"
            lines.append(dict(col=col, y=l["bbox"][1], y1=l["bbox"][3], x=x0, text=text, kind=kind, size=size))
    lines.sort(key=lambda d: (d["col"], round(d["y"]), d["x"]))
    # merge lines on the same baseline within a column (bullet marks, split spans)
    merged = []
    for d in lines:
        if merged and merged[-1]["col"] == d["col"] and abs(merged[-1]["y"] - d["y"]) < 3:
            m = merged[-1]
            if m["kind"] == "bullet-mark":
                d = dict(d, text="• " + d["text"]); merged[-1] = d
            else:
                sep = "" if (m["kind"] == d["kind"] == "h1") else " "
                m["text"] += sep + d["text"]
            continue
        merged.append(d)
    out, prev = [], None
    for d in merged:
        t = d["text"]
        gap = (d["y"] - prev["y1"]) if prev and prev["col"] == d["col"] else 99
        newpara = gap > d["size"] * 0.45 or prev is None or prev["kind"] != d["kind"] or t.startswith("•")
        if d["kind"] == "h1":
            if prev and prev["kind"] == "h1" and gap < 8:
                out[-1] += " " + t; prev = d; continue
            out += ["", "# " + t, ""]
        elif d["kind"] == "h2":
            out += ["", "## " + t, ""]
        elif t.startswith("•"):
            out.append("- " + t.lstrip("• ").strip())
        elif d["kind"] == "read":
            if newpara and out and out[-1].startswith(">"):
                out.append(">")
            if newpara or not out or not out[-1].startswith(">"):
                out.append("> " + t)
            else:
                out[-1] += " " + t
        else:
            if prev and prev["kind"] == "body" and not newpara and out and out[-1] and not out[-1].startswith(("#", ">")):
                out[-1] += " " + t
            else:
                if out and out[-1].startswith("- ") and not newpara:
                    out[-1] += " " + t
                else:
                    out += ["", t] if newpara else [t]
        prev = d
    md = "\n".join(out)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    # de-hyphenate soft line breaks
    md = re.sub(r"(\w)- (\w)", r"\1\2", md)
    return md

# ----------------------------------------------------------------- maps

def detect_lines(gray, axis):
    prof = gray.mean(axis)
    prof = prof.max() - prof
    hp = prof - np.convolve(prof, np.ones(31) / 31, "same")
    pk, _ = find_peaks(hp, distance=120, prominence=max(hp.std() * 0.8, 0.5))
    if len(pk) < 4:
        return None
    P = np.median(np.diff(pk))
    if not (150 <= P <= 300):
        return None
    idx = np.round((pk - pk[0]) / P)
    A = np.vstack([idx, np.ones_like(idx)]).T
    sol = np.linalg.lstsq(A, pk, rcond=None)[0]
    keep = np.abs(pk - A @ sol) < 8
    if keep.sum() < 4:
        return None
    sol = np.linalg.lstsq(A[keep], pk[keep], rcond=None)[0]
    first, last = pk[keep].min(), pk[keep].max()
    return dict(period=float(sol[0]), first=float(first), last=float(last), n=int(keep.sum()))

def extract_map(page, out_path, max_side=2400):
    pix = page.get_pixmap(dpi=MAP_RENDER_DPI)
    img = Image.frombytes("RGB", (pix.w, pix.h), pix.samples)
    gray = np.asarray(img.convert("L"), dtype=float)
    gx, gy = detect_lines(gray, 0), detect_lines(gray, 1)
    if gx and gy:
        sx, sy = CELL / gx["period"], CELL / gy["period"]
        img = img.resize((round(img.width * sx), round(img.height * sy)), Image.LANCZOS)
        ox = (gx["first"] * sx) % CELL
        oy = (gy["first"] * sy) % CELL
        cols = int((img.width - ox) // CELL)
        rows = int((img.height - oy) // CELL)
        img = img.crop((round(ox), round(oy), round(ox) + cols * CELL, round(oy) + rows * CELL))
        grid = dict(dpi=CELL, cols=cols, rows=rows, aligned=True)
    else:
        if max(img.size) > max_side:
            k = max_side / max(img.size)
            img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
        grid = dict(dpi=CELL, cols=round(img.width / CELL), rows=round(img.height / CELL), aligned=False)
    img.save(out_path, "JPEG", quality=86, optimize=True, progressive=True)
    return dict(width=img.width, height=img.height, bytes=os.path.getsize(out_path), **grid)

def token_sig(rgba):
    a = np.asarray(flatten(rgba).convert("L").resize((24, 32), Image.BILINEAR), dtype=float)
    a = a - a.mean()
    return a / (np.linalg.norm(a) + 1e-6)

def thumb_vec(img):
    g = img.convert("L").resize((48, 36), Image.BILINEAR)
    a = np.asarray(g, dtype=float)
    a = a - a.mean()
    return a / (np.linalg.norm(a) + 1e-6)

# ---------------------------------------------------------------- cards

NAME_RE = re.compile(r"^([A-Z][a-z’'-]+(?:-[A-Z][a-z’']+)?)( (of|the|[A-Z][a-z’'-]+)){0,4}:?$")

def card_name(img):
    """OCR the title of a Hero Kids card (monster title centred, hero class top-left)."""
    w, h = img.size
    for box in [(0.25, 0.13, 0.70, 0.232), (0.12, 0.14, 0.50, 0.235), (0.20, 0.11, 0.75, 0.24)]:
        c = img.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3]))).convert("L")
        c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS).point(lambda v: 255 if v > 150 else 0)
        for psm in (7, 6):
            for line in ocr(c, psm).splitlines():
                line = line.strip().strip("_—-~ .,|").strip()
                line = re.sub(r"\s*:.*$", ":", line)
                if NAME_RE.match(line):
                    return line.rstrip(":")
    return ""

def card_text(img):
    w, h = img.size
    crop = img.crop((int(w * 0.52), int(h * 0.12), int(w * 0.98), int(h * 0.95)))
    crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS).convert("L")
    t = ocr(crop, psm=6)
    lines = [re.sub(r"^[^A-Za-z(]+", "", l).strip() for l in t.splitlines()]
    lines = [l for l in lines if len(l) > 2]
    return "\n".join(lines)

def health_boxes(img, debug=False):
    """Count health boxes (KO, Hurt, Bruised, ...) at their fixed card positions."""
    g = np.asarray(img.convert("L"), dtype=float); H, W = g.shape
    dark = g < 120
    def band(y0, y1, x0, x1, axis):
        y0, y1, x0, x1 = int(y0), int(y1), int(x0), int(x1)
        if y1 <= y0 or x1 <= x0: return 0.0
        return float(dark[y0:y1, x0:x1].mean(axis).max())
    n, info = 0, []
    t, b = 0.781 * H, 0.869 * H
    p = 0.006
    for i in range(7):
        l = (0.137 + i * 0.074) * W; r = l + 0.062 * W
        if r > 0.62 * W: break
        e = [band(t - p*H, t + p*H, l + 0.01*W, r - 0.01*W, 1),   # top edge
             band(b - p*H, b + p*H, l + 0.01*W, r - 0.01*W, 1),   # bottom edge
             band(t + 0.01*H, b - 0.01*H, l - p*W, l + p*W, 0),   # left edge
             band(t + 0.01*H, b - 0.01*H, r - p*W, r + p*W, 0)]   # right edge
        inner = float(dark[int(t + 0.015*H):int(b - 0.015*H), int(l + 0.01*W):int(r - 0.01*W)].mean())
        info.append([round(v, 2) for v in e] + [round(inner, 2)])
        if sum(v > 0.7 for v in e) >= 3 and inner < 0.2: n += 1
        else: break
    return (n, info) if debug else n


def card_details(img, ocr_txt):
    """Kind, main attack name and number of health boxes from a card."""
    health = health_boxes(img)
    m = re.search(r"(Melee|Ranged|Magic) Attack:\s*([^\n]+)", ocr_txt)
    attack = m.group(2).strip() if m else ""
    kind = "hero" if re.search(r"Inventory|Skills", ocr_txt) else "monster"
    return kind, attack, health or None

def flatten(img, bg=(255, 255, 255)):
    b = Image.new("RGBA", img.size, bg + (255,))
    b.alpha_composite(img)
    return b.convert("RGB")

def trim_alpha(img, pad=4):
    bbox = img.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


# ------------------------------------------------------ token <-> card match

def _gray_on_white(path, width=None, height=None):
    im = Image.open(path).convert("RGBA")
    if width or height:
        if width:
            k = width / im.width
        else:
            k = height / im.height
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
    return np.asarray(bg.convert("L"), dtype=np.float32)

def match_tokens(pdir, tokens, cards, band=None, min_keep=0.0):
    """Name each stand-up token after the card whose portrait it matches."""
    try:
        import cv2
        from scipy.optimize import linear_sum_assignment
    except ImportError:
        return
    cands = [c for c in cards if c.get("kind") in ("monster", "hero", "pet", None)]
    if not tokens or not cands:
        return
    def hist(rgb, mask):
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        hh = cv2.calcHist([hsv], [0, 1], mask, [18, 8], [0, 180, 0, 256])
        return cv2.normalize(hh, hh).flatten()
    arts, ahist = [], []
    for c in cands:
        im = Image.open(os.path.join(pdir, c["file"])).convert("RGBA")
        im = im.resize((240, round(im.height * 240 / im.width)), Image.LANCZOS)
        rgb = np.asarray(flatten(im))
        H, W = rgb.shape[:2]
        crop = rgb[int(H * .15):int(H * .97), int(W * .12):int(W * .62)]
        arts.append(cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY).astype(np.float32))
        mask = (crop.min(2) < 225).astype(np.uint8) * 255
        ahist.append(hist(crop, mask))
    S = np.full((len(tokens), len(cands)), -1.0, dtype=np.float32)
    for i, t in enumerate(tokens):
        im = Image.open(os.path.join(pdir, t["file"])).convert("RGBA")
        rgb = np.asarray(flatten(im)); mask = (np.asarray(im.getchannel("A")) > 128).astype(np.uint8) * 255
        th = hist(rgb, mask)
        hs = np.array([cv2.compareHist(th, a, cv2.HISTCMP_CORREL) for a in ahist])
        cand = set(int(x) for x in np.argsort(-hs)[:10])
        if band:
            mid = i * len(cands) / max(1, len(tokens))
            cand |= {j for j in range(len(cands)) if abs(j - mid) <= band * len(cands)}
        for j in sorted(cand):
            art = arts[j]; best = -1.0
            for frac in np.linspace(0.45, 0.98, 8):
                h = int(art.shape[0] * frac)
                tg = _gray_on_white(os.path.join(pdir, t["file"]), height=h)
                if tg.shape[1] >= art.shape[1] or tg.shape[0] >= art.shape[0] or tg.shape[1] < 8:
                    continue
                r = cv2.matchTemplate(art, tg, cv2.TM_CCOEFF_NORMED)
                best = max(best, float(np.nanmax(r)))
            S[i, j] = best
    for t in tokens:
        for k in ("card", "match"):
            t.pop(k, None)
        t["name"] = t["id"]
    for c in cands:
        c.pop("token", None)
    if band:
        # sequence prior: reward pairs near the expected alphabetical position
        for i in range(len(tokens)):
            mid = i * len(cands) / max(1, len(tokens))
            for j in range(len(cands)):
                if S[i, j] > -1:
                    S[i, j] += 0.08 * max(0.0, 1 - abs(j - mid) / (band * len(cands)))
    rows, cols = linear_sum_assignment(-S)
    for i, j in zip(rows, cols):
        if S[i, j] >= max(min_keep, 0.3 if len(tokens) <= len(cands) else 0.5):
            tokens[i]["name"] = cands[j]["name"]
            tokens[i]["card"] = cands[j]["id"]
            tokens[i]["match"] = round(float(S[i, j]), 2)
            cands[j]["token"] = tokens[i]["id"]
    # leftovers: score every remaining pair exhaustively, then assign
    lt = [i for i, t in enumerate(tokens) if "card" not in t]
    lc = [j for j, c in enumerate(cands) if "token" not in c]
    if lt and lc and not band:
        for i in lt:
            for j in lc:
                if S[i, j] > -1: continue
                art = arts[j]; best = -1.0
                for frac in np.linspace(0.3, 0.98, 10):
                    h = int(art.shape[0] * frac)
                    tg = _gray_on_white(os.path.join(pdir, tokens[i]["file"]), height=h)
                    if tg.shape[1] >= art.shape[1] or tg.shape[0] >= art.shape[0] or tg.shape[1] < 8:
                        tg = _gray_on_white(os.path.join(pdir, tokens[i]["file"]), width=int(art.shape[1] * frac))
                        if tg.shape[1] >= art.shape[1] or tg.shape[0] >= art.shape[0]:
                            continue
                    r = cv2.matchTemplate(art, tg, cv2.TM_CCOEFF_NORMED)
                    best = max(best, float(np.nanmax(r)))
                S[i, j] = best
        sub = S[np.ix_(lt, lc)]
        r2, c2 = linear_sum_assignment(-sub)
        for a_, b_ in zip(r2, c2):
            i, j = lt[a_], lc[b_]
            if S[i, j] >= 0.25 or (len(lt) == 1 and len(lc) == 1):
                tokens[i].update(name=cands[j]["name"], card=cands[j]["id"], match=round(float(S[i, j]), 2))
                cands[j]["token"] = tokens[i]["id"]
    # leftover tokens: best card even if already taken (e.g. two poses of one monster)
    for i, t in enumerate(tokens):
        if "card" not in t:
            j = int(np.argmax(S[i]))
            if S[i, j] >= 0.6:
                t.update(name=cands[j]["name"] + " (alt)", card=cands[j]["id"], match=round(float(S[i, j]), 2))


def name_variants(img):
    w, hh = img.size
    out = []
    for box in [(0.25, 0.13, 0.70, 0.232), (0.20, 0.12, 0.78, 0.235), (0.30, 0.14, 0.68, 0.225)]:
        c = img.crop((int(w * box[0]), int(hh * box[1]), int(w * box[2]), int(hh * box[3]))).convert("L")
        for scale in (3, 4):
            cc = c.resize((c.width * scale, c.height * scale), Image.LANCZOS)
            for thr in (120, 150, 180, None):
                x = cc if thr is None else cc.point(lambda v, t=thr: 255 if v > t else 0)
                for psm in (7, 8):
                    for line in ocr(x, psm).splitlines():
                        line = re.sub(r"[^A-Za-z' ]", "", line).strip()
                        if len(line) >= 3:
                            out.append(line)
    return out

def repair_card_names(pdir, cards, vocab):
    """Re-read monster card titles that don't look like words from the books."""
    small = {"of", "the", "and"}
    def known(word):
        w = word.lower()
        return w in small or w in vocab or (w + "s") in vocab or (w + "es") in vocab
    def ok(name):
        ws = name.split()
        return bool(ws) and all(known(w) for w in ws) and not name.startswith("card-")
    fixed = {}
    for c in cards:
        if c.get("kind") not in ("monster", "pet", None) or ok(c["name"]):
            continue
        img = flatten(Image.open(os.path.join(pdir, c["file"])).convert("RGBA"))
        vs = name_variants(img)
        if not c["name"].startswith("card-") and sum(1 for v in vs if v.endswith(c["name"])) >= 2:
            continue  # OCR is consistent; the word just isn't in the text
        votes = collections.Counter()
        for v in vs:
            words = v.split()
            while words and (len(words[0]) <= 2 or not words[0][0].isupper()) and words[0].lower() not in small:
                words = words[1:]
            pref = []
            for wd in words:
                if not known(wd):
                    break
                pref.append(wd)
            while pref and pref[-1].lower() in small:
                pref.pop()
            if pref and pref[0][0].isupper():
                votes[" ".join(pref)] += 1
        if votes:
            best = max(votes, key=lambda k: (votes[k] >= 2, len(k.split()), votes[k]))
            fixed[c["id"]] = (c["name"], best)
            c["name"] = best
        elif c["name"].startswith("card-") and vs:
            common = collections.Counter(" ".join(w for w in v.split() if len(w) > 2) for v in vs).most_common(1)
            if common and common[0][0]:
                fixed[c["id"]] = (c["name"], common[0][0]); c["name"] = common[0][0]
    return fixed


def item_details(img):
    """Portrait item/equipment cards: title, type line and rules text."""
    w, h = img.size
    def read(box, psm):
        c = img.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3]))).convert("L")
        c = c.resize((c.width * 2, c.height * 2), Image.LANCZOS).point(lambda v: 255 if v > 150 else 0)
        return ocr(c, psm)
    title = re.sub(r"[^A-Za-z'’ \-]", "", read((0.05, 0.17, 0.95, 0.255), 7)).strip()
    title = re.sub(r"^(?:[A-Za-z]{1}\s+)+", "", title).strip()
    kind = re.sub(r"[^A-Za-z ]", "", read((0.2, 0.25, 0.8, 0.31), 7)).strip()
    body = " ".join(read((0.05, 0.58, 0.95, 0.93), 6).split())
    return title, kind, body

# --------------------------------------------------------------- product

class Product:
    def __init__(self, pid, title, kind, out_root):
        self.id, self.title, self.kind = pid, title, kind
        self.dir = os.path.join(out_root, pid)
        for sub in ("maps", "cards", "tokens"):
            os.makedirs(os.path.join(self.dir, sub), exist_ok=True)
        self.pages_md = []           # [(source, page_no, md)]
        self.maps, self.cards, self.tokens = [], [], []
        self.thumbs = {}             # map id -> vec
        self.meta = {}
        self.sources = []
        self.encounter_thumbs = {}   # (source,page)-> [vec]
        self.token_sigs = []

    def add_pdf(self, path, *, text=True, maps=True, cards=True, tokens=True):
        doc = fitz.open(path)
        src = os.path.basename(path)
        self.sources.append(src)
        seen_cards, seen_tokens = set(), set()
        kinds = [classify(p) for p in doc]
        last_text = max([i for i, k in enumerate(kinds) if k == "text"], default=-1)
        for pn, page in enumerate(doc):
            kind = kinds[pn]
            if kind == "standups" and pn < last_text:
                kind = "other"
            if pn == 0 and kind != "map":
                self.meta.setdefault("cover_text", re.sub(r"\s+", " ", page.get_text()).strip())
                if kind in ("cards", "art", "other") and len(page.get_text().split()) < 60:
                    continue
            if kind == "text" and text:
                md = page_markdown(page, title_is_h2=(self.kind == "core"))
                self.pages_md.append((src, pn + 1, md))
                # small map thumbnails on encounter pages
                pa = page.rect.width * page.rect.height
                vecs = []
                for im in page.get_image_info(xrefs=True):
                    a = area(im["bbox"])
                    if 0.04 * pa < a < 0.3 * pa and im["xref"]:
                        try:
                            vecs.append(thumb_vec(flatten(xref_rgba(doc, im["xref"]), (240, 230, 205))))
                        except Exception:
                            pass
                if vecs:
                    self.encounter_thumbs[(src, pn + 1)] = vecs
            elif kind == "map" and maps:
                mid = f"map-{len(self.maps) + 1:02d}"
                fn = f"maps/{mid}.jpg"
                g = extract_map(page, os.path.join(self.dir, fn))
                self.maps.append(dict(id=mid, file=fn, page=pn + 1, source=src, name=f"Map {len(self.maps) + 1}", **g))
                pix = page.get_pixmap(dpi=30)
                self.thumbs[mid] = thumb_vec(Image.frombytes("RGB", (pix.w, pix.h), pix.samples))
            elif kind == "cards" and cards:
                pa = page.rect.width * page.rect.height
                infos = sorted(page.get_image_info(xrefs=True), key=lambda i: (round(i["bbox"][1] / 50), i["bbox"][0]))
                for im in infos:
                    if not (0.12 * pa < area(im["bbox"]) < 0.4 * pa) or im["xref"] in seen_cards or not im["xref"]:
                        continue
                    seen_cards.add(im["xref"])
                    rgba = xref_rgba(doc, im["xref"])
                    # rotated placement (portrait cards in landscape pages, etc.)
                    flat = flatten(rgba)
                    name = card_name(flat)
                    txt = card_text(flat)
                    ckind, attack, health = card_details(flat, txt)
                    portrait_item = flat.height > flat.width and ("Advancement" in self.title or "Equipment" in self.title)
                    if portrait_item:
                        t2, typ, body = item_details(flat)
                        if len(t2) < 3 and len(body) < 20:
                            continue
                        name, txt = t2 or name, body
                    elif not re.search(r"(Melee|Ranged|Magic) Attack:\s*\w", txt) and (not name or "Normal Attack" in txt):
                        continue  # blank template card
                    if not re.search(r"(Melee|Ranged|Magic) Attack:", txt) and ckind != "hero":
                        ckind = "item"
                    if "Pet" in self.title: ckind = "pet"
                    elif "Equipment" in self.title: ckind = "item"
                    elif "Advancement" in self.title: ckind = "advancement"
                    elif ckind == "hero" and not (self.kind == "core" or "Heroes" in self.title):
                        ckind = "monster"
                    name = name.rstrip(":").strip()
                    if ckind == "hero" and attack:
                        name = f"{name} ({attack})" if name else attack
                    cid = f"card-{len(self.cards) + 1:03d}"
                    fn = f"cards/{cid}.webp"
                    rgba.save(os.path.join(self.dir, fn), "WEBP", quality=85, method=6)
                    self.cards.append(dict(id=cid, file=fn, name=name or cid, kind=ckind, attack=attack, health=health,
                                           ocr=txt, page=pn + 1, source=src, width=rgba.width, height=rgba.height))
            if kind == "standups" and cards:
                pa = page.rect.width * page.rect.height
                for im in page.get_image_info(xrefs=True):
                    if 0.12 * pa < area(im["bbox"]) < 0.4 * pa and im["xref"] and im["xref"] not in seen_cards:
                        seen_cards.add(im["xref"])
                        rgba = xref_rgba(doc, im["xref"]); flat = flatten(rgba)
                        name, txt = card_name(flat), card_text(flat)
                        ckind, attack, health = card_details(flat, txt)
                        if not name:
                            continue
                        cid = f"card-{len(self.cards) + 1:03d}"; fn = f"cards/{cid}.webp"
                        rgba.save(os.path.join(self.dir, fn), "WEBP", quality=85, method=6)
                        self.cards.append(dict(id=cid, file=fn, name=name, kind="monster", attack=attack, health=health,
                                               ocr=txt, page=pn + 1, source=src, width=rgba.width, height=rgba.height))
            if kind == "standups" and tokens:
                pa = page.rect.width * page.rect.height
                infos = sorted(page.get_image_info(xrefs=True), key=lambda i: (round(i["bbox"][1] / 40), i["bbox"][0]))
                # one entry per image; prefer an upright placement (front of the stand-up)
                placements = collections.OrderedDict()
                for im in infos:
                    bb = im["bbox"]
                    if not im["xref"] or im["xref"] in seen_tokens or max(bb[3] - bb[1], bb[2] - bb[0]) < 35 \
                            or min(bb[3] - bb[1], bb[2] - bb[0]) < 12 or area(bb) > 0.05 * pa:
                        continue
                    t = im.get("transform") or (1, 0, 0, 1, 0, 0)
                    cur = placements.get(im["xref"])
                    if cur is None or (cur["transform"][3] < 0 <= t[3]):
                        placements[im["xref"]] = dict(im, transform=t)
                for im in placements.values():
                    a_, _, _, d_, _, _ = im["transform"]
                    seen_tokens.add(im["xref"])
                    rgba = xref_rgba(doc, im["xref"])
                    if d_ < 0:
                        rgba = rgba.transpose(Image.FLIP_TOP_BOTTOM); a_ = -a_
                    if a_ < 0:
                        rgba = rgba.transpose(Image.FLIP_LEFT_RIGHT)
                    rgba = trim_alpha(rgba)
                    if max(rgba.width, rgba.height) < 60 or min(rgba.width, rgba.height) < 20:
                        continue
                    sig = token_sig(rgba)
                    dup = next((k for k, o in enumerate(self.token_sigs)
                                if max(float((sig * o).sum()), float((np.flipud(np.fliplr(sig)) * o).sum()),
                                       float((np.flipud(sig) * o).sum())) > 0.93), None)
                    if dup is not None:
                        # stand-ups print the back (upside down) above the front: keep the lower copy
                        tk = self.tokens[dup] if dup < len(self.tokens) else None
                        if tk and float((sig * self.token_sigs[dup]).sum()) < 0.93:
                            rgba.save(os.path.join(self.dir, tk["file"]), "WEBP", quality=88, method=6)
                            tk.update(width=rgba.width, height=rgba.height)
                            self.token_sigs[dup] = sig
                        continue
                    self.token_sigs.append(sig)
                    tid = f"token-{len(self.tokens) + 1:03d}"
                    fn = f"tokens/{tid}.webp"
                    rgba.save(os.path.join(self.dir, fn), "WEBP", quality=88, method=6)
                    bbw = im["bbox"][2] - im["bbox"][0]
                    self.tokens.append(dict(id=tid, file=fn, name=tid, page=pn + 1, source=src,
                                            width=rgba.width, height=rgba.height,
                                            cells=max(1, int(round(bbw / 64.0))),
                                            uses=sum(1 for j in infos if j["xref"] == im["xref"])))
            elif kind == "art" and pn == 0:
                txt = page.get_text()
                self.meta["cover_text"] = re.sub(r"\s+", " ", txt).strip()
        doc.close()

    # ---- adventure structure
    def structure(self):
        full, page_of = [], []
        for src, pn, md in self.pages_md:
            full.append(md)
        full_md = "\n\n".join(full)
        intro, encs = split_encounters(full_md)
        for e in encs:
            # pages whose text contains this encounter's heading (+ the page after it)
            pages = [pn for _, pn, md in self.pages_md if e["md"][:60] in md or md[:60] in e["md"]]
            e["pages"] = pages
            e["map"] = self.match_map(pages)
        return [dict(md=intro)], encs

    def match_map(self, pages):
        best, bscore = None, 0.55
        for (src, pn), vecs in self.encounter_thumbs.items():
            if pn not in pages:
                continue
            for v in vecs:
                for mid, mv in self.thumbs.items():
                    s = float((v * mv).sum())
                    if s > bscore:
                        best, bscore = mid, s
        return best

    def write(self):
        big = len(self.tokens) > 60
        match_tokens(self.dir, self.tokens, self.cards, band=0.08 if big else None, min_keep=0.5 if big else 0.0)
        data = dict(id=self.id, title=self.title, kind=self.kind, sources=self.sources, meta=self.meta,
                    maps=self.maps, cards=self.cards, tokens=self.tokens)
        if self.kind == "adventure":
            intro, enc = self.structure()
            data["intro_md"] = "\n\n".join(s["md"] for s in intro)
            data["encounters"] = enc
            for e in enc:
                if e["map"]:
                    for mp in self.maps:
                        if mp["id"] == e["map"] and mp["name"].startswith("Map "):
                            mp["name"] = f"E{e['n']} · {e['title']}"
            cov = self.meta.get("cover_text", "")
            for key in ("ENCOUNTERS", "DIFFICULTY", "DURATION"):
                m = re.search(key + r":\s*([A-Z0-9\- ]+?)(?=\s+[A-Z]+:|\s+DESIGNED|$)", cov, re.I)
                if m:
                    data["meta"][key.lower()] = m.group(1).strip().title()
        else:
            data["sections"] = split_sections("\n\n".join(md for _, _, md in self.pages_md))
        with open(os.path.join(self.dir, "product.json"), "w") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
        return data

def split_sections(md):
    parts = re.split(r"(?m)^# ", md)
    out = []
    if parts[0].strip():
        out.append(dict(title="Overview", md=parts[0].strip()))
    for p in parts[1:]:
        title, _, body = p.partition("\n")
        title = re.sub(r"\s+", " ", title).strip().title()
        if out and out[-1]["title"] == title:
            out[-1]["md"] += "\n\n" + body.strip()
        else:
            out.append(dict(title=title, md=body.strip()))
    return [s for s in out if s["md"]]

def parse_monsters(md):
    """'1 Hero: 2 x Giant Rats 2 Heroes: ...' -> {1: [{'count':2,'name':'Giant Rat'}], ...}"""
    sec = re.search(r"## Monsters\n(.*?)(?=\n## |\Z)", md, re.S)
    text = re.sub(r"\s+", " ", sec.group(1) if sec else md)
    res = {}
    for n, body in re.findall(r"(\d)\s*Heroe?s?\s*:\s*(.*?)(?=\d\s*Heroe?s?\s*:|Use these|$)", text):
        items = []
        for cnt, name in re.findall(r"(\d+)\s*x\s*([A-Z][A-Za-z'’\-]*(?:\s+(?:(?:of|the|and)\b|[A-Z][A-Za-z'’\-]*))*)", body.strip()):
            name = re.sub(r"(\s+(of|the|and))+$", "", name)
            name = singular(name.strip())
            items.append(dict(count=int(cnt), name=name))
        if items:
            res[int(n)] = items
    return res


ENC_RE = re.compile(r"(?m)^# Encounter (\d+\s*[a-z]?)\b\s*:?\s*(.*)$")

def split_encounters(full_md):
    """Split adventure markdown on '# Encounter N: Title' headings -> (intro_md, [encounter dicts])."""
    hits = [m for m in ENC_RE.finditer(full_md) if not m.group(2).lower().startswith("list")]
    if not hits:
        return full_md, []
    intro = full_md[:hits[0].start()].strip()
    encs = []
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(full_md)
        md = full_md[m.start():end].strip()
        encs.append(dict(n=m.group(1).replace(" ", ""), title=m.group(2).strip(), md=md,
                         monsters=parse_monsters(md),
                         read_aloud=["\n".join(l[2:] for l in blk.splitlines()) for blk in
                                     re.findall(r"(?:^> .*(?:\n>.*)*)", md, re.M)]))
    return intro, encs

def singular(name):
    for a, b in (("ves", "f"), ("ies", "y")):
        if name.endswith(a):
            return name[:-len(a)] + b
    if name.endswith("s") and not name.endswith(("ss", "us")):
        return name[:-1]
    return name

# ---------------------------------------------------------------- driver

def product_key(path):
    base = os.path.basename(path)[:-4]
    folder = os.path.basename(os.path.dirname(path))
    b = base.replace("Hero_Kids_-_Fantasy_", "")
    for suf in ("_-_Map_Tiles_and_Monsters", "_-_Bonus_Items", "_-_Color", "_-_Core",
                "_-_Monster_Cards_Only", "_-_Monster_Stand-Ups"):
        b = b.replace(suf, "")
    title = re.sub(r"^(Adventure|Expansion|RPG)_-_", "", b).replace("_", " ").strip()
    title = re.sub(r"^(.*) The$", r"The \1", title)
    title = title.replace("Wizards Tower", "Wizard's Tower").replace("Basement O Rats", "Basement O' Rats")
    title = title.replace("Neath", "'Neath").replace("Hero Cards - ", "")
    if base.endswith("Fantasy_RPG"):
        kind, title = "core", "Hero Kids Fantasy RPG"
    elif "Adventure" in base:
        kind = "adventure"
    else:
        kind = "expansion"
    return slug(title), title, kind

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--only", nargs="*", default=[])
    a = ap.parse_args()
    pdfs = []
    for root, _, files in os.walk(a.src):
        if "_Owlbear Library" in root:
            continue
        for f in files:
            if f.endswith(".pdf") and not any(s in f for s in SKIP):
                pdfs.append(os.path.join(root, f))
    groups = collections.OrderedDict()
    for p in sorted(pdfs):
        pid, title, kind = product_key(p)
        groups.setdefault(pid, dict(title=title, kind=kind, files=[]))["files"].append(p)
    lib_path = os.path.join(a.out, "library.json")
    library = json.load(open(lib_path)) if os.path.exists(lib_path) else dict(version=1, products=[])
    index = {p["id"]: p for p in library["products"]}
    for pid, g in groups.items():
        if a.only and pid not in a.only:
            continue
        print(f"== {pid} ({g['kind']}) {len(g['files'])} pdf", flush=True)
        prod = Product(pid, g["title"], g["kind"], a.out)
        files = sorted(g["files"], key=lambda f: ("Stand-Ups" in f, "Cards_Only" in f, "Map_Tiles" in f, f))
        for f in files:
            opts = {}
            if "Monster_Compendium_-_Core" in f:
                opts = dict(cards=False, tokens=False)   # cards come from 'Cards Only'
            if "Cards_Only" in f:
                opts = dict(text=False)
            prod.add_pdf(f, **opts)
        d = prod.write()
        size = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(prod.dir) for fn in fns)
        index[pid] = dict(id=pid, title=g["title"], kind=g["kind"], maps=len(d["maps"]), cards=len(d["cards"]),
                          tokens=len(d["tokens"]), encounters=len(d.get("encounters", [])), bytes=size)
        print(f"   maps={len(d['maps'])} cards={len(d['cards'])} tokens={len(d['tokens'])} "
              f"enc={len(d.get('encounters', []))} size={size/1e6:.1f}MB", flush=True)
        library["products"] = sorted(index.values(), key=lambda p: ({"core": 0, "adventure": 1, "expansion": 2}[p["kind"]], p["title"]))
        json.dump(library, open(lib_path, "w"), indent=1)

if __name__ == "__main__":
    main()
