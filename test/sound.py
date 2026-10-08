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
window.__played = [];
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
        # share with players
        gm.check("#sndshare"); gm.wait_for_timeout(600)
        meta = gm.evaluate("window.__obr.dump().roomMeta['app.herokids.table/sound']")
        print("  shared:", meta)
        check(meta and meta["share"] and "cave" in meta["loops"], "sharing publishes playing loops")
        gm.click("[data-snd=bats]"); gm.wait_for_timeout(300)
        bc = gm.evaluate("window.__obr.log.filter(l => l.api === 'broadcast' && l.args[0] === 'app.herokids.table/sfx').map(l => l.args[1].id)")
        check(bc == ["bats"], "one-shot broadcast to players")
        gm.screenshot(path=f"{OUT}/s3-shared.png", full_page=True)
        state = gm.evaluate("window.__obr.dump()")
        # player device
        pl = b.new_page(viewport={"width": 440, "height": 700})
        pl.add_init_script(SPY)
        pl.on("pageerror", lambda e: errors.append("player: " + str(e)))
        pl.goto("http://localhost:5198/index.html?role=PLAYER")
        pl.wait_for_selector("nav.tabs")
        pl.evaluate("s => window.__obr.seed(s)", state); pl.wait_for_timeout(800)
        check(pl.locator("[data-snd-unlock]").count() == 1, "player sees Turn on sounds")
        pl.screenshot(path=f"{OUT}/s4-player-off.png", full_page=True)
        pl.click("[data-snd-unlock]")
        pl.wait_for_function("window.__played.some(p => p.loop)", timeout=10000)
        check(True, "player joins the GM's loop after tapping")
        pl.evaluate("window.__obr.OBR.broadcast.sendMessage('app.herokids.table/sfx', {id:'goblin'})")
        pl.wait_for_function("window.__played.filter(p => !p.loop).length >= 1", timeout=10000)
        check(True, "player plays GM one-shot")
        pl.screenshot(path=f"{OUT}/s5-player-on.png", full_page=True)
        n = pl.evaluate("window.__played.length")
        pl.click("[data-snd-mute]"); pl.wait_for_timeout(300)
        pl.evaluate("window.__obr.OBR.broadcast.sendMessage('app.herokids.table/sfx', {id:'goblin'})"); pl.wait_for_timeout(500)
        check(pl.evaluate("window.__played.length") == n, "muted player ignores sounds")
        # GM turns sharing off -> player's loops stop (metadata loops empty)
        pl.evaluate("window.__obr.OBR.room.setMetadata({'app.herokids.table/sound': {share:false, loops:[]}})"); pl.wait_for_timeout(500)
        check(pl.locator("[data-snd-unlock], [data-snd-mute]").count() == 0, "banner hidden when GM stops sharing")
        b.close()
finally:
    srv.terminate()
print("errors:", errors)
print("FAILED" if fails or errors else "ALL PASSED", fails)
