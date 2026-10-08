"""Soundboard flow against the mock Owlbear: GM board, loops, editing, sharing to a player."""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = "/home/claude/hero-kids-table/dist-mock"
LIB, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "5198", "-d", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors, fails = [], []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)
# record every sound that actually starts playing
SPY = """
window.__played = []; window.__media = [];
const _play = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () { window.__media.push({ loop: this.loop }); return _play.call(this); };
const _start = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...a) {
  if (this.buffer && this.buffer.length > 1) window.__played.push({ dur: +this.buffer.duration.toFixed(2), loop: this.loop, ls: this.loopStart, le: this.loopEnd });
  return _start.apply(this, a);
};
"""
def wait_api(page, api, n):
    page.wait_for_function(f"window.__obr.log.filter(l => l.api === '{api}').length >= {n}", timeout=120000)
    page.wait_for_function("!document.querySelector('.busy')", timeout=120000)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        gm = b.new_page(viewport={"width": 440, "height": 900})
        gm.add_init_script(SPY)
        gm.on("pageerror", lambda e: errors.append(str(e)))
        gm.on("console", lambda m: m.type == "error" and errors.append(m.text))
        gm.goto("http://localhost:5198/index.html?role=GM")
        gm.wait_for_selector("nav.tabs")
        gm.set_input_files("#folder", LIB)
        wait_api(gm, "assets.uploadImages", 1)
        gm.click("[data-tab=play]")
        gm.select_option("#adv", "darkness-neath-rivenshore"); gm.wait_for_timeout(500)
        check(gm.locator("#soundboard").count() == 1, "soundboard shown on Play tab")
        label = gm.locator("#soundboard summary").inner_text()
        print("  board:", label)
        gm.evaluate("window.__obr.openScene({product:'darkness-neath-rivenshore', map:'map-02', encounter:'2', cols:12, rows:8})")
        gm.wait_for_timeout(300)
        gm.evaluate("window.__obr.OBR.scene.items.addItems([])")  # nudge onChange like a real scene load
        gm.wait_for_timeout(800)
        label = gm.locator("#soundboard summary").inner_text()
        print("  board:", label)
        check("Cistern" in label, "board follows the map on the table")
        shots = gm.eval_on_selector_all("[data-snd]", "els => els.map(e => e.dataset.snd)")
        loops = gm.eval_on_selector_all("[data-snd-loop]", "els => els.map(e => e.dataset.sndLoop)")
        print("  loops:", loops, " shots:", shots)
        check("splash" in shots, "splash suggested for the cistern")
        check("cave" in loops, "cave ambience suggested")
        gm.screenshot(path=f"{OUT}/s1-board.png", full_page=True)
        # one-shot plays a real decoded file
        gm.click("[data-snd=splash]"); gm.wait_for_function("window.__played.length >= 1", timeout=10000)
        check(gm.evaluate("window.__played[0].dur") > 0.1, "splash decoded and played")
        # loop on, seamless range set, then off
        gm.click("[data-snd-loop=cave]")
        gm.wait_for_function("window.__played.some(p => p.loop)", timeout=10000)
        lp = gm.evaluate("window.__played.find(p => p.loop)")
        print("  loop:", lp)
        check(lp["le"] > lp["ls"] and lp["ls"] < 0.2, "loop playing with trimmed loop points")
        check("on" in gm.get_attribute("[data-snd-loop=cave]", "class"), "loop chip shows playing")
        # editing: add Bats, remove Rat
        gm.click("[data-snd-edit]"); gm.wait_for_timeout(300)
        gm.screenshot(path=f"{OUT}/s2-editor.png", full_page=True)
        gm.click("[data-snd-pick=bats]"); gm.wait_for_timeout(400)
        gm.click("[data-snd-pick=splash]"); gm.wait_for_timeout(400)
        gm.click("[data-snd-done]"); gm.wait_for_timeout(300)
        shots2 = gm.eval_on_selector_all("[data-snd]", "els => els.map(e => e.dataset.snd)")
        check("bats" in shots2 and "splash" not in shots2, "board edits saved")
        check("(your board)" in gm.locator("#soundboard summary").inner_text(), "custom board labelled")
        # survives re-render (tab switch) and loop keeps playing
        gm.click("[data-tab=dice]"); gm.click("[data-tab=play]"); gm.wait_for_timeout(500)
        check("bats" in gm.eval_on_selector_all("[data-snd]", "els => els.map(e => e.dataset.snd)"), "board persisted")
        check("on" in gm.get_attribute("[data-snd-loop=cave]", "class"), "loop still on after re-render")
        check(gm.locator("#sndshare").count() == 0, "no player sharing option (GM computer only)")
        # My sounds: import two files from "this computer"
        import shutil, os
        tmp = os.path.join(OUT, "mine"); os.makedirs(tmp, exist_ok=True)
        cave = os.path.join(tmp, "Dark_Cave_Drips_Ambience.mp3"); shutil.copy("public/sounds/cave.mp3", cave)
        growl = os.path.join(tmp, "Water_Beast_Growl.mp3"); shutil.copy("public/sounds/growl-1.mp3", growl)
        gm.click("[data-snd-edit]"); gm.wait_for_timeout(300)
        gm.set_input_files("#myfiles", [cave, growl])
        gm.wait_for_function("document.querySelectorAll('.myrow').length === 2", timeout=20000)
        rows = gm.eval_on_selector_all(".myrow", "els => els.map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
        print("  my sounds:", rows)
        check(any("Dark Cave Drips Ambience" in r and "Loop" in r for r in rows), "ambience file detected as a loop")
        check(any("Water Beast Growl" in r and "One-shot" in r for r in rows), "short file detected as a one-shot")
        gm.screenshot(path=f"{OUT}/s3-mysounds.png", full_page=True)
        gm.click("[data-snd-reset]"); gm.wait_for_timeout(500)
        loops = gm.eval_on_selector_all("[data-snd-loop]", "els => els.map(e => e.dataset.sndLoop)")
        shots = gm.eval_on_selector_all("[data-snd]", "els => els.map(e => e.dataset.snd)")
        print("  suggested now:", loops, shots)
        check("my:dark-cave-drips-ambience" in loops, "imported cave ambience suggested for the cistern")
        check("my:water-beast-growl" in shots, "imported growl suggested for the water beasts")
        gm.click("[data-snd-done]"); gm.wait_for_timeout(300)
        gm.click("[data-snd-loop='my:dark-cave-drips-ambience']")
        gm.wait_for_function("window.__media.length >= 1", timeout=10000)
        check(gm.evaluate("window.__media[0].loop"), "imported loop streams via a looping media element")
        n = gm.evaluate("window.__played.length")
        gm.click("[data-snd='my:water-beast-growl']")
        gm.wait_for_function(f"window.__played.length > {n}", timeout=10000)
        check(True, "imported one-shot plays")
        gm.screenshot(path=f"{OUT}/s4-board-mine.png", full_page=True)
        # survives a reload (stored in this browser)
        gm.reload(); gm.wait_for_selector("nav.tabs"); gm.click("[data-tab=play]"); gm.wait_for_timeout(500)
        gm.select_option("#adv", "darkness-neath-rivenshore"); gm.wait_for_timeout(800)  # the mock room resets on reload
        gm.click("[data-snd-edit]"); gm.wait_for_timeout(400)
        check(gm.locator(".myrow").count() == 2, "my sounds persist after reload")
        gm.click("[data-my-del='my:water-beast-growl']"); gm.wait_for_timeout(500)
        check(gm.locator(".myrow").count() == 1, "my sound deleted")
        # players get no sound UI
        pl = b.new_page(viewport={"width": 440, "height": 700})
        pl.goto("http://localhost:5198/index.html?role=PLAYER"); pl.wait_for_selector("nav.tabs"); pl.wait_for_timeout(500)
        check(pl.locator("[data-snd-unlock], #soundboard").count() == 0, "player device has no sound UI")
        b.close()
finally:
    srv.terminate()
print("errors:", errors)
print("FAILED" if fails or errors else "ALL PASSED", fails)
