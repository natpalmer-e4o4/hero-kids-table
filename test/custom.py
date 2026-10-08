import json, subprocess, sys, time
from playwright.sync_api import sync_playwright
LIB, OUT = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "5199", "-d", "/home/claude/hero-kids-table/dist-mock"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
errors = []
def wait_api(page, api, n):
    page.wait_for_function(f"window.__obr.log.filter(l => l.api === '{api}').length >= {n}", timeout=120000)
    page.wait_for_function("!document.querySelector('.busy')", timeout=120000)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={"width": 440, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e))); page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.goto("http://localhost:5199/index.html?role=GM"); page.wait_for_selector("nav.tabs")
    page.set_input_files("#folder", LIB); wait_api(page, "assets.uploadImages", 1)
    for kind, n in (("tokens", 1), ("cards", 2), ("maps", 3)):
        if kind != "tokens":
            page.click(f"[data-act=upkind][data-kind={kind}]"); wait_api(page, "assets.uploadImages", n)
        page.click(f"[data-act=linkkind][data-kind={kind}]"); wait_api(page, "assets.downloadImages", n)
    hints = page.evaluate("window.__obr.log.filter(l => l.api === 'assets.uploadImages').map(l => l.args[1])")
    print("upload types:", hints); assert hints == ["CHARACTER", "PROP", "MAP"], hints
    # party: Ava
    page.click("[data-tab=campaign]"); page.click("[data-act=addhero]"); page.wait_for_timeout(300)
    page.locator("input[data-mf=kid]").nth(0).fill("Ava"); page.locator("input[data-mf=kid]").nth(0).dispatch_event("change"); page.wait_for_timeout(300)
    page.locator("select[data-mf=device]").nth(0).select_option("kid-1"); page.wait_for_timeout(300)
    # create a custom monster from a library figure
    page.click("[data-tab=create]"); page.click("[data-act=cnew][data-k=monster]"); page.wait_for_timeout(500)
    page.fill("[data-cf=name]", "Grumble the Goblin King")
    page.select_option("[data-cf=libimg]", index=40)
    page.fill("[data-cf='dice.melee']", "3"); page.fill("[data-cf=health]", "4"); page.fill("[data-cf=size]", "2")
    page.fill("[data-cf='attack.name']", "Royal Bonk"); page.fill("[data-cf='attack.text']", "Melee attack at an adjacent target. On a hit, the target is knocked prone.")
    page.fill("[data-cf='special.name']", "Call the Guards"); page.fill("[data-cf='special.text']", "Once per encounter, place 2 goblin warriors next to the king.")
    page.wait_for_timeout(1500); page.screenshot(path=f"{OUT}/c1-editor.png", full_page=True)
    page.click("[data-act=csave]"); page.wait_for_timeout(1500)
    # custom item with uploaded picture
    page.click("[data-act=cnew][data-k=item]"); page.wait_for_timeout(400)
    page.fill("[data-cf=name]", "Grandma's Lucky Spoon"); page.fill("[data-cf=itemType]", "Item")
    page.fill("[data-cf=effect]", "Once per adventure, reroll one die. The spoon is very proud of itself.")
    page.set_input_files("#cpic", f"{LIB}/hero-kids-fantasy-rpg/tokens/token-026.webp"); page.wait_for_timeout(1200)
    page.click("[data-act=csave]"); page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/c2-list.png", full_page=True)
    page.click("[data-act=cupload][data-kind=tokens]"); wait_api(page, "assets.uploadImages", 4)
    page.click("[data-act=cupload][data-kind=cards]"); wait_api(page, "assets.uploadImages", 5)
    page.click("[data-act=clink][data-kind=tokens]"); wait_api(page, "assets.downloadImages", 4)
    if page.locator("[data-act=clink][data-kind=cards]").count():  # the mock's picker returns every type at once
        page.click("[data-act=clink][data-kind=cards]"); wait_api(page, "assets.downloadImages", 5)
    page.wait_for_timeout(500)
    page.locator("select[data-give]").first.select_option(index=1); page.wait_for_timeout(800)
    # place the custom monster on an open scene
    page.evaluate("window.__obr.openScene({product:'darkness-neath-rivenshore', map:'map-01', encounter:'1', cols:12, rows:8})"); page.wait_for_timeout(500)
    page.locator("[data-act=cplace]").first.click(); wait_api(page, "scene.addItems", 1)
    page.screenshot(path=f"{OUT}/c3-after.png", full_page=True)
    # party hero picker includes custom heroes? (none made) — check monster in add-monster list
    page.click("[data-tab=play]"); page.select_option("#adv", "darkness-neath-rivenshore"); page.wait_for_timeout(400)
    page.click("[data-enc='1']"); page.wait_for_timeout(600)
    opts = page.locator("#addmon option").all_inner_texts()
    print("n options:", len(opts), "groups:", page.locator("#addmon optgroup").evaluate_all("gs => gs.map(g => g.label)"))
    print("custom group:", page.locator("#addmon optgroup[label=Custom] option").evaluate_all("os => os.map(o => o.textContent)"))
    L = page.evaluate("window.__obr.log.map(l => [l.api, JSON.stringify(l.args).slice(0, 600)])")
    for a, x in L:
        if a in ("notify",) or (a == "scene.addItems"): print(a, x[:300])
        if a == "assets.uploadImages": print(a, x[:200])
    state = page.evaluate("window.__obr.dump()")
    pp = b.new_page(viewport={"width": 440, "height": 900}); pp.on("pageerror", lambda e: errors.append("player: " + str(e)))
    pp.goto("http://localhost:5199/index.html?role=PLAYER"); pp.wait_for_selector("nav.tabs")
    pp.evaluate("s => window.__obr.seed(s)", state); pp.wait_for_timeout(1200)
    pp.screenshot(path=f"{OUT}/c4-player.png", full_page=True)
    b.close()
finally:
  srv.terminate()
print("ERRORS:", errors)
