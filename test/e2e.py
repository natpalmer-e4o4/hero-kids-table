import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = "/home/claude/hero-kids-table/dist-mock"
LIB = sys.argv[1]
OUT = sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "5199", "-d", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)
def wait_api(page, api, n):
    page.wait_for_function(f"window.__obr.log.filter(l => l.api === '{api}').length >= {n}", timeout=120000)
    page.wait_for_function("!document.querySelector('.busy')", timeout=120000)
def log(page):
    return page.evaluate("window.__obr.log.map(l => [l.api, JSON.stringify(l.args).slice(0, 4000)])")
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 440, "height": 760})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto("http://localhost:5199/index.html?role=GM")
        page.wait_for_selector("nav.tabs")
        shot(page, "01-library-empty")
        page.set_input_files("#folder", LIB)
        page.wait_for_function("!document.querySelector('.busy')", timeout=120000)
        page.wait_for_selector("table.lib", timeout=120000)
        shot(page, "02-library-loaded")
        # bulk: one dialog each
        page.click("[data-act=allscenes]"); wait_api(page, "assets.uploadScenes", 1)
        page.click("[data-act=alltokens]"); wait_api(page, "assets.uploadImages", 1)
        page.click("[data-act=allcards]"); wait_api(page, "assets.uploadImages", 2)
        page.click("[data-act=linkall]"); wait_api(page, "assets.downloadImages", 1)
        # single book button still works
        row = page.locator("table.lib tr", has_text="Basement O' Rats")
        row.locator("[data-act=scenes]").click(); wait_api(page, "assets.uploadScenes", 2)
        shot(page, "03-library-uploaded")
        # campaign: pick heroes
        page.click("[data-tab=campaign]")
        sels = page.locator("select[data-hero]")
        sels.nth(0).select_option(index=1); page.wait_for_timeout(800)
        shot(page, "04a-campaign-after-first")
        page.locator("select[data-hero]").nth(1).select_option(index=4); page.wait_for_timeout(300)
        page.fill("#cname", "Ava & Leo's Saturday Quest"); page.click("[data-act=savecamp]")
        shot(page, "04-campaign")
        # play
        page.click("[data-tab=play]")
        page.select_option("#adv", "reign-of-the-dragon"); page.wait_for_timeout(400)
        shot(page, "05-play-intro")
        page.evaluate("window.__obr.openScene({product:'reign-of-the-dragon', map:'map-03', encounter:'4a', cols:12, rows:8})")
        page.wait_for_timeout(600)
        page.click("[data-enc='4a']"); page.wait_for_timeout(600)
        shot(page, "06-play-encounter")
        if page.locator("[data-act=spawn]").count():
            page.click("[data-act=spawn]"); wait_api(page, "scene.addItems", 1)
        page.click("[data-act=party]"); wait_api(page, "scene.addItems", 2)
        page.wait_for_timeout(500)
        if page.locator("[data-act=weather][data-w=RAIN]").count():
            page.locator("[data-act=weather][data-w=RAIN]").click(); page.wait_for_timeout(500)
        shot(page, "06b-weather")
        if page.locator("button.share").count():
            page.locator("button.share").first.click(); page.wait_for_timeout(200)
        page.click("[data-act=done]"); page.wait_for_timeout(300)
        # dice
        page.click("[data-tab=dice]")
        page.click("[data-pool=attack][data-v='3']"); page.click("[data-act=roll]"); page.wait_for_timeout(200)
        page.click("[data-mode=test]"); page.click("[data-act=roll]"); page.click("[data-act=init]"); page.wait_for_timeout(800)
        shot(page, "07-dice")
        page.click("[data-tab=rules]"); page.fill("#rq", "prone"); page.wait_for_timeout(300)
        shot(page, "08-rules")
        L = log(page)
        json.dump(L, open(f"{OUT}/obr-log.json", "w"), indent=1)
        # player view
        pp = b.new_page(viewport={"width": 440, "height": 760})
        pp.on("pageerror", lambda e: errors.append("player: " + str(e)))
        pp.goto("http://localhost:5199/index.html?role=PLAYER"); pp.wait_for_selector("nav.tabs")
        shot(pp, "09-player")
        pp2 = b.new_page(viewport={"width": 720, "height": 520})
        pp2.on("pageerror", lambda e: errors.append("shown: " + str(e)))
        pp2.goto("http://localhost:5199/index.html?view=shown&role=PLAYER"); pp2.wait_for_timeout(500)
        shot(pp2, "10-shown")
        b.close()
finally:
    srv.terminate()
print("ERRORS:", errors)
