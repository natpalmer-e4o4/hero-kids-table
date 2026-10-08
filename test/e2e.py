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
        wait_api(page, "assets.uploadImages", 1)          # step 2 starts by itself
        shot(page, "02-setup-after-upload")
        for kind, n in (("tokens", 1), ("cards", 2), ("maps", 3)):
            if kind != "tokens":
                page.click(f"[data-act=upkind][data-kind={kind}]"); wait_api(page, "assets.uploadImages", n)
            page.click(f"[data-act=linkkind][data-kind={kind}]"); wait_api(page, "assets.downloadImages", n)
        hints = page.evaluate("window.__obr.log.filter(l => l.api === 'assets.uploadImages').map(l => l.args[1])")
        print("upload types:", hints); assert hints == ["CHARACTER", "PROP", "MAP"], hints
        page.click("[data-act=tablescene]"); wait_api(page, "assets.uploadScenes", 1)
        page.wait_for_timeout(800)
        shot(page, "03-library-uploaded")
        # campaign: two heroes share Ava's iPad ("kid-1"), Leo has none
        page.click("[data-tab=campaign]")
        page.click("[data-act=addhero]"); page.wait_for_timeout(400)
        page.click("[data-act=addhero]"); page.wait_for_timeout(400)
        kids = page.locator("input[data-mf=kid]")
        kids.nth(0).fill("Ava"); kids.nth(0).dispatch_event("change"); page.wait_for_timeout(300)
        page.locator("input[data-mf=kid]").nth(1).fill("Max"); page.locator("input[data-mf=kid]").nth(1).dispatch_event("change"); page.wait_for_timeout(300)
        page.locator("select[data-mf=hero]").nth(0).select_option(index=1); page.wait_for_timeout(400)
        page.locator("select[data-mf=hero]").nth(1).select_option(index=4); page.wait_for_timeout(400)
        page.locator("select[data-mf=device]").nth(0).select_option("kid-1"); page.wait_for_timeout(300)
        page.locator("select[data-mf=device]").nth(1).select_option("kid-1"); page.wait_for_timeout(300)
        page.fill("#cname", "Ava & Max's Saturday Quest"); page.click("[data-act=savecamp]")
        shot(page, "04-campaign")
        # play
        page.click("[data-tab=play]")
        page.select_option("#adv", "reign-of-the-dragon"); page.wait_for_timeout(400)
        shot(page, "05-play-intro")
        page.evaluate("window.__obr.openScene({product:'reign-of-the-dragon', map:'map-01', encounter:null, cols:12, rows:8})")
        page.wait_for_timeout(600)
        page.locator("details.gallery summary").click(); page.wait_for_timeout(1500)
        shot(page, "05b-gallery")
        page.locator("[data-act=showmap][data-map='map-03']").first.click(); wait_api(page, "viewport.animateToBounds", 1)
        page.wait_for_timeout(800)
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
        # player view: one iPad, two heroes, following the Initiative Tracker
        state = page.evaluate("window.__obr.dump()")
        pp = b.new_page(viewport={"width": 440, "height": 900})
        pp.on("pageerror", lambda e: errors.append("player: " + str(e)))
        pp.goto("http://localhost:5199/index.html?role=PLAYER"); pp.wait_for_selector("nav.tabs")
        pp.evaluate("s => window.__obr.seed(s)", state); pp.wait_for_timeout(800)
        heroes = [i["name"] for i in state["items"] if i.get("metadata", {}).get("app.herokids.table/token", {}).get("kind") == "hero"]
        print("hero tokens:", heroes)
        shot(pp, "09-player-turn1")
        print("player sees:", pp.locator(".turn").first.inner_text() if pp.locator(".turn").count() else None, "|", pp.locator("main h2").first.inner_text() if pp.locator("main h2").count() else None)
        pp.evaluate(f"window.__obr.setActive({json.dumps(heroes[1])})"); pp.wait_for_timeout(800)
        shot(pp, "09-player-turn2")
        print("player sees:", pp.locator(".turn").first.inner_text(), "|", pp.locator("main h2").first.inner_text())
        pp.evaluate("window.__obr.setActive('Cultist Guard')"); pp.wait_for_timeout(800)
        print("monster turn:", pp.locator(".turn").first.inner_text(), "| still shows:", pp.locator("main h2").first.inner_text())
        pp.select_option("#playas", index=0); pp.wait_for_timeout(500)
        print("manual pick:", pp.locator("main h2").first.inner_text())
        pp.click("[data-tab=dice]"); pp.click("[data-act=roll]"); pp.wait_for_timeout(400)
        print("roll by:", pp.evaluate("window.__obr.log.filter(l=>l.api==='broadcast').map(l=>l.args[1].who)"))
        pp2 = b.new_page(viewport={"width": 720, "height": 520})
        pp2.on("pageerror", lambda e: errors.append("shown: " + str(e)))
        pp2.goto("http://localhost:5199/index.html?view=shown&role=PLAYER"); pp2.wait_for_timeout(500)
        shot(pp2, "10-shown")
        b.close()
finally:
    srv.terminate()
print("ERRORS:", errors)
