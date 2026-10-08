#!/usr/bin/env python3
"""Build the rehosted community sound library (public/sounds + src/sounds.json).

Every source below is CC0 (public domain dedication), so the files may be
trimmed, re-encoded and redistributed with the extension. Credits are written
to public/sounds/CREDITS.md anyway.

Usage: python3 -I tools/build_sounds.py <downloads-dir> <repo-dir>
  <downloads-dir> holds the unpacked Kenney packs (rpg-audio/, impact-sounds/,
  interface-sounds/, casino-audio/) and an oga/ folder with the OpenGameArt
  downloads (zips unpacked into x_<zipname>/).

One-shots: leading silence trimmed, loudness-matched (~-18 LUFS, peaks <= -1 dB),
mono MP3. Loops: up to 60 s, the tail cross-faded into the head so the loop is
seamless, quieter (~-27 LUFS) stereo MP3. MP3 because iPad Safari can't play Ogg.
"""
import json, os, re, subprocess, sys, tempfile

SRC, REPO = sys.argv[1], sys.argv[2]
OUT = os.path.join(REPO, "public", "sounds")
K = lambda p: os.path.join(SRC, p)
O = lambda p: os.path.join(SRC, "oga", p)
RD1, RD2 = O("x_80-CC0-creature-SFX_0"), O("x_80-CC0-creature-sfx-2")
RPG, LOOPS, WATER = O("x_80-CC0-RPG-SFX_0"), O("x_sfx_loops"), O("x_water-splash-slime-sfx")
S100, S100B = O("x_100-CC0-SFX_0"), O("x_sfx_100_v2")
TINY = O("x_tinysized/sfx-cc0")
KR, KI, KF, KC = K("rpg-audio/Audio"), K("impact-sounds/Audio"), K("interface-sounds/Audio"), K("casino-audio/Audio")

CREDITS = {
    "kenney-rpg": ("RPG Audio", "Kenney", "https://kenney.nl/assets/rpg-audio"),
    "kenney-impact": ("Impact Sounds", "Kenney", "https://kenney.nl/assets/impact-sounds"),
    "kenney-interface": ("Interface Sounds", "Kenney", "https://kenney.nl/assets/interface-sounds"),
    "kenney-casino": ("Casino Audio", "Kenney", "https://kenney.nl/assets/casino-audio"),
    "rd-creature": ("80 CC0 creature SFX", "rubberduck", "https://opengameart.org/content/80-cc0-creature-sfx"),
    "rd-creature2": ("80 CC0 creature SFX #2", "rubberduck", "https://opengameart.org/content/80-cc0-creture-sfx-2"),
    "rd-rpg": ("80 CC0 RPG SFX", "rubberduck", "https://opengameart.org/content/80-cc0-rpg-sfx"),
    "rd-water": ("40 CC0 water / splash / slime SFX", "rubberduck", "https://opengameart.org/content/40-cc0-water-splash-slime-sfx"),
    "rd-100": ("100 CC0 SFX", "rubberduck", "https://opengameart.org/content/100-cc0-sfx"),
    "rd-100b": ("100 CC0 SFX #2", "rubberduck", "https://opengameart.org/content/100-cc0-sfx-2"),
    "tiny": ("Tinysized SFX Library", "Vehicle (Jan Schupke)", "https://opengameart.org/content/fantasy-sound-effects-tinysized-sfx"),
    "rain": ("AMB Rain Loop 1", "kresiek-the-furry", "https://opengameart.org/content/amb-rain-loop-1"),
    "morning": ("AMB Morning Sounds (Perfect Loop)", "kresiek-the-furry", "https://opengameart.org/content/amb-morning-sounds-perfect-loop"),
    "storm": ("Rain + Long Thunder", "wuxiascrub", "https://opengameart.org/content/rain-long-thunder"),
    "park": ("Park Ambiences", "thimras", "https://opengameart.org/content/park-ambiences"),
    "fireplace": ("Fireplace Sound loop", "pagdev", "https://opengameart.org/content/fireplace-sound-loop"),
    "vistula": ("Sea and river wave sounds", "randommind", "https://opengameart.org/content/sea-and-river-wave-sounds"),
    "birds": ("Ambient Bird Sounds", "isaiah658", "https://opengameart.org/content/ambient-bird-sounds"),
    "crickets": ("Crickets Ambient Noise - loopable", "wolfgang", "https://opengameart.org/content/crickets-ambient-noise-loopable"),
    "drip": ("Dripping water loop", "qubodup", "https://opengameart.org/content/dripping-water-loop"),
    "dungeon": ("Loopable Dungeon Ambience", "jaggedstone", "https://opengameart.org/content/loopable-dungeon-ambience"),
    "ghostly": ("4 Atmospheric ghostly loops", "qubodup", "https://opengameart.org/content/4-atmospheric-ghostly-loops"),
    "swamp": ("Swamp Environment Audio", "lokif", "https://opengameart.org/content/swamp-environment-audio"),
    "crowd": ("Crowd Shouting/Speaking Ambience", "starninjas", "https://opengameart.org/content/crowd-shoutingspeaking-ambience"),
    "trot": ("Horse Trotting", "ezduzziteh", "https://opengameart.org/content/horse-trotting"),
    "swish": ("Swishes Sound Pack", "artisticdude", "https://opengameart.org/content/swishes-sound-pack"),
    "clash": ("20 Sword Sound Effects (Attacks and Clashes)", "starninjas", "https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes"),
    "battle": ("Battle Sound Effects", "ogrebane", "https://opengameart.org/content/battle-sound-effects"),
    "yells": ("Voice Effects Zombie-Skeleton-Monster", "arcadeparty", "https://opengameart.org/content/zombie-skeleton-monster-voice-effects"),
    "explosion": ("Chunky Explosion", "joth", "https://opengameart.org/content/chunky-explosion"),
    "magic": ("Magic Spell SFX", "jaggedstone", "https://opengameart.org/content/magic-spell-sfx"),
    "cure": ("Cure Magic", "someoneman", "https://opengameart.org/content/cure-magic"),
    "restore": ("Magic Words & Healing Sound Effect", "spring-spring", "https://opengameart.org/content/magic-words-healing-sound-effect"),
    "sparkle": ("Fantasy Magic Spell", "almitory", "https://opengameart.org/content/fantasy-magic-spell"),
    "laugh": ("Evil Laugh", "antumdeluge", "https://opengameart.org/content/evil-laugh"),
    "roar": ("CC0 Deep Monster Roar", "trazzz123", "https://opengameart.org/content/cc0-deep-monster-roar"),
    "troll": ("Big scary troll sounds", "darsycho", "https://opengameart.org/content/big-scary-troll-sounds"),
    "goblin": ("Goblins Sound Pack", "artisticdude", "https://opengameart.org/content/goblins-sound-pack"),
    "rat": ("Squeaky Rat", "qubodup", "https://opengameart.org/content/squeaky-rat"),
    "bat": ("Bat Screeches", "antumdeluge", "https://opengameart.org/content/bat-screeches"),
    "wolf": ("Wolf Monster Sound", "caveboytup", "https://opengameart.org/content/wolf-monster-sound"),
    "insect": ("Insect or Alien Scream (short)", "qubodup", "https://opengameart.org/content/insect-or-alien-scream-short"),
    "bones": ("Bones Rattle", "congusbongus", "https://opengameart.org/content/bones-rattle"),
    "ghost": ("Ghost/Monster Voice Moaning Growling", "qubodup", "https://opengameart.org/content/ghost-monster-voice-moaning-growling"),
    "flap": ("Dragon Flap", "vishwajai", "https://opengameart.org/content/dragon-flap-0"),
    "nature": ("Bird, Cricket, Frog and Mosquito Sounds", "aj-0", "https://opengameart.org/content/birdcricketfrog-and-mosquito-sounds"),
    "chest": ("Open Chest SFX", "oiboo", "https://opengameart.org/content/open-chest-sfx"),
    "win": ("Win Sound Effect", "listener", "https://opengameart.org/content/win-sound-effect"),
    "ding": ("Correct Bell", "fupi", "https://opengameart.org/content/correct-bell"),
}

def g(d, *names):
    return [os.path.join(d, n) for n in names]

def rng(d, pat, *nums):
    return [os.path.join(d, pat.format(n)) for n in nums]

# id, name, category, loop?, sources[], credit key(s), tags
A, C, M, Z, P, T = "Ambience", "Combat", "Magic", "Creatures", "Places & things", "Moments"
SOUNDS = [
    # ---- ambience loops
    ("rain", "Rain", A, True, [O("amb_rain_loop_1.ogg")], "rain", "rain rainy wet drizzle shower puddle"),
    ("storm", "Thunderstorm", A, True, [O("rain-thunder.ogg")], "storm", "storm stormy thunder lightning tempest"),
    ("wind", "Wind", A, True, [(O("park_ambience_wind.wav"), 30)], "park", "wind windy mountain cliff peak blizzard snow desert gust hill winter yule icy"),
    ("campfire", "Campfire", A, True, [O("fire.wav")], "fireplace", "fire campfire fireplace hearth flame flames burning forge camp"),
    ("river", "River", A, True, [(O("park_ambience_river.wav"), 60)], "park", "river stream creek brook waterfall bridge ford"),
    ("waves", "Lake shore", A, True, [(O("VistulaShort.mp3"), 20)], "vistula", "lake shore sea ocean beach coast boat ship dock harbor island pier pirate pirates"),
    ("forest", "Forest morning", A, True, [O("amb_morning.ogg")], "morning", "forest woods wood trees glade meadow field farm village outdoors"),
    ("birds", "Birdsong", A, True, [O("birds-isaiah658.ogg")], "birds", "bird birds garden park spring orchard"),
    ("night", "Night crickets", A, True, [O("crickets-oneloop.mp3")], "crickets", "night evening moon moonlight crickets dusk sleep"),
    ("cave", "Dripping cave", A, True, [O("atmo.mp3")], "drip", "cave cavern tunnel tunnels mine cellar basement sewer sewers underground grotto"),
    ("dungeon", "Dungeon", A, True, [O("dungeon_ambient_1.ogg")], "dungeon", "dungeon crypt tomb prison catacomb catacombs vault tower castle lair ruins"),
    ("haunted", "Haunted", A, True, [(O("at.mp3"), 0, 20)], "ghostly", "haunted ghost ghosts spirit spooky curse cursed graveyard cemetery undead necromancer mausoleum shadow shadows wight"),
    ("swamp", "Swamp", A, True, [O("x_swamp_sounds/atmosphere_2.ogg")], "swamp", "swamp bog marsh mire fen frog frogs pond lizardfolk lizardkin toads"),
    ("crowd", "Busy crowd", A, True, [O("crowd_shouting.ogg")], "crowd", "town market crowd festival city villagers tavern inn feast"),
    ("bubbling", "Bubbling cauldron", A, True, [O("x_water-splash-slime-sfx/loop_bubbles_02.ogg")], "rd-water", "cauldron potion potions alchemist laboratory witch brew bubbling ooze"),
    ("riding", "Riding", A, True, [O("Trot.ogg")], "trot", "horse horses ride riding cart wagon travel journey pony"),
    # ---- combat
    ("swing", "Swing", C, False, g(O("x_swishes/swishes"), *[f"swish-{n}.wav" for n in (1, 2, 3, 4, 5, 6)]), "swish", "swing sword axe club fight battle"),
    ("clash", "Sword clash", C, False, rng(O("x_sword_clash_-_starninjas_0"), "sword_clash.{}.ogg", 1, 2, 3, 4, 5, 6), "clash", "sword swords blade clash knight duel fight battle"),
    ("hit", "Hit!", C, False, rng(KI, "impactPunch_heavy_00{}.ogg", 0, 1, 2, 3, 4), "kenney-impact", "hit punch fight brawl"),
    ("arrow", "Arrow", C, False, [O("x_battle_sound_effects_0/battle_sound_effects/Bow.wav")], "battle", "bow arrow arrows archer archers ranger shoot hunter"),
    ("block", "Shield block", C, False, rng(KI, "impactMetal_heavy_00{}.ogg", 0, 1, 2, 3), "kenney-impact", "shield block armor armour knight guard guards"),
    ("draw", "Draw weapon", C, False, g(TINY, "seax-unsheathe-01.wav", "seax-unsheathe-02.wav", "knife-unsheathe-02.wav"), "tiny", "dagger knife blade ambush bandit bandits"),
    ("yell", "Battle yell", C, False, rng(O("x_Voice_Effects_Zombie-Skeleton-Monster_Human_Male/Voice Effects Zombie-Skeleton-Monster Human Male"), "humanYell{}.wav", 1, 2, 3, 4, 5), "yells", "charge bandit bandits guard guards soldier soldiers yell pirate pirates brigand brigands"),
    ("boom", "Boom", C, False, [O("Chunky_Explosion.mp3"), os.path.join(S100, "explosion.ogg")], "explosion rd-100", "explosion explode bomb blast boom powder barrel cannon"),
    # ---- magic
    ("spell", "Spell", M, False, [O(f"magical_{n}") for n in ("1.ogg", "2.ogg", "3.ogg", "4.ogg", "5.ogg", "6_0.ogg", "7_0.ogg")], "magic", "magic spell wizard mage sorcerer sorceress enchant enchanted arcane wand"),
    ("fireball", "Fireball", M, False, rng(RPG, "spell_fire_0{}.ogg", 1, 2, 3, 4, 5, 6, 7), "rd-rpg", "fireball flame burn dragon fire mage"),
    ("heal", "Healing", M, False, rng(O("x_curemagic"), "Cure{}.wav", 1, 2, 3, 4) + [O("health_restore.wav")], "cure restore", "heal healing cure potion cleric priest healer restore"),
    ("sparkle", "Sparkle", M, False, [O("fantasy_magic_button_1.mp3")], "sparkle", "fairy fairies sparkle enchanted crystal pixie wish unicorn unicorns wisp"),
    ("thunder", "Thunder", M, False, [os.path.join(S100B, "sfx100v2_thunder_01.ogg")], "rd-100b", "thunder lightning bolt storm"),
    ("zap", "Zap", M, False, g(TINY, "paralyzer-discharge-01.wav", "paralyzer-discharge-02.wav"), "tiny", "lightning shock zap bolt electric trap"),
    ("laugh", "Evil laugh", M, False, [O("laugh-evil-1.ogg")], "laugh", "villain evil witch necromancer laugh boss sorcerer"),
    # ---- creatures
    ("roar", "Big roar", Z, False, [O("monster_roar.wav")] + rng(RD1, "roar_0{}.ogg", 1, 2, 3) + rng(RD2, "roar_0{}.ogg", 4, 5, 6), "roar rd-creature rd-creature2", "dragon beast troll ogre roar bear boss minotaur wyrm hydra"),
    ("growl", "Growl", Z, False, rng(RD1, "monster_0{}.ogg", 1, 2, 3, 4, 5, 6, 7), "rd-creature", "beast growl bear wolf dog hound minotaur"),
    ("troll", "Troll grumble", Z, False, rng(RD1, "troll_0{}.ogg", 1, 2, 3), "rd-creature", "troll trolls ogre ogres giants yeti"),
    ("goblin", "Goblin", Z, False, rng(O("x_goblins_0/goblins"), "goblin-{}.wav", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), "goblin", "goblin goblins kobold kobolds imp gremlin hobgoblin"),
    ("rat", "Rat squeak", Z, False, g(O("x_rat/qubodupSqueakyRat"), "qubodupSqueakyRatAttack.ogg", "qubodupSqueakyRatPain.ogg", "qubodupSqueakyRatDeath.ogg"), "rat", "rat rats mouse mice rodent rodents sewer cellar basement"),
    ("bats", "Bats", Z, False, rng(O("x_bat/ogg"), "bat_0{}.ogg", 1, 2, 3), "bat", "bat bats cave cavern vampire belfry"),
    ("howl", "Howl", Z, False, [os.path.join(RD1, "howl.ogg"), O("wolf_monster_5.mp3")], "rd-creature wolf", "wolf wolves warg wargs howl werewolf moon fenrir"),
    ("spider", "Spider / bug", Z, False, [O("insectoralienshort_0.flac")] + rng(RD1, "bug_0{}.ogg", 1, 2, 3, 4), "insect rd-creature", "spider spiders insect insects bug bugs beetle ant ants scorpion centipede web"),
    ("bones", "Rattling bones", Z, False, rng(O("x_bones_rattle"), "{}.ogg", 0, 1, 2, 3, 4, 5), "bones", "skeleton skeletons bones undead crypt tomb graveyard"),
    ("zombie", "Zombie groan", Z, False, rng(O("x_Voice_Effects_Zombie-Skeleton-Monster_Human_Male/Voice Effects Zombie-Skeleton-Monster Human Male"), "zombieYell{}.wav", 1, 2, 3, 4, 5, 6), "yells", "zombie zombies undead ghoul ghouls mummy"),
    ("ghost", "Ghost moan", Z, False, rng(O("x_qubodup-GhostMoans/qubodup-GhostMoans/wav"), "qubodup-GhostMoan0{}.wav", 1, 2, 3, 4, 5), "ghost", "ghost ghosts spirit spirits haunted phantom wraith banshee"),
    ("slime", "Slime", Z, False, rng(RD2, "slime_0{}.ogg", 1, 2, 3, 4, 5, 6), "rd-creature2", "slime slimes ooze jelly blob sludge"),
    ("wings", "Wings", Z, False, [O("dragonflap.wav")], "flap", "dragon wings flying griffon harpy wyvern flap bird"),
    ("critter", "Cute critter", Z, False, rng(RD1, "cute_0{}.ogg", 1, 2, 3, 4, 5, 6), "rd-creature", "pet pets puppy kitten critter cute baby companion"),
    ("monsterhurt", "Monster hurt", Z, False, rng(RD1, "hurt_0{}.ogg", 1, 2, 3, 4, 5), "rd-creature", "hurt wounded"),
    ("defeated", "Monster defeated", Z, False, rng(RD2, "die_0{}.ogg", 1, 2, 3, 4), "rd-creature2", "defeat defeated vanquish"),
    ("snore", "Snore", Z, False, [os.path.join(RD1, "snore.ogg"), os.path.join(RD2, "snore_02.ogg")], "rd-creature rd-creature2", "sleep sleeping asleep snore sneak lullaby"),
    ("burp", "Burp", Z, False, rng(RD1, "burp_0{}.ogg", 1, 2), "rd-creature", "burp feast ogre troll"),
    ("munch", "Munching", Z, False, rng(RD1, "eat_0{}.ogg", 1, 2, 3, 4), "rd-creature", "eat eating feast munch hungry food"),
    ("frog", "Frog", Z, False, [O("x_birdsCrickets/birdsCrickets/frog.wav")], "nature", "frog frogs toad pond swamp"),
    ("owl", "Night bird", Z, False, [O("x_birdsCrickets/birdsCrickets/birdNight.wav")], "nature", "owl night bird crow raven"),
    # ---- places & things
    ("splash", "Splash", P, False, rng(WATER, "splash_0{}.ogg", 1, 2, 3, 4, 5, 6), "rd-water", "water splash river lake swim pond fish"),
    ("dooropen", "Door opens", P, False, g(KR, "doorOpen_1.ogg", "doorOpen_2.ogg"), "kenney-rpg", "door doors gate enter house hut cottage"),
    ("doorshut", "Door slams", P, False, g(KR, "doorClose_1.ogg", "doorClose_2.ogg", "doorClose_3.ogg", "doorClose_4.ogg"), "kenney-rpg", "door doors slam trap"),
    ("creak", "Creak", P, False, g(KR, "creak1.ogg", "creak2.ogg", "creak3.ogg") + g(TINY, "floor-creak-01.wav"), "kenney-rpg tiny", "creak creaky wooden floor stairs attic"),
    ("lock", "Lock & key", P, False, g(TINY, "keyhole-lockbox-turn-01.wav") + rng(RPG, "lock_0{}.ogg", 1, 2, 3), "tiny rd-rpg", "lock locked key keys unlock gate prison cell jail"),
    ("chest", "Open chest", P, False, [O("open_chest_0.wav"), os.path.join(S100, "wooded_box_open.ogg")], "chest rd-100", "chest chests treasure loot box trunk"),
    ("coins", "Coins", P, False, g(KR, "handleCoins.ogg", "handleCoins2.ogg") + rng(RPG, "item_coins_0{}.ogg", 1, 2, 3, 4), "kenney-rpg rd-rpg", "coin coins gold money treasure merchant shop buy pay"),
    ("gems", "Gems", P, False, rng(RPG, "item_gem_0{}.ogg", 1, 2, 3, 4), "rd-rpg", "gem gems jewel jewels crystal crystals diamond"),
    ("steps", "Footsteps", P, False, [("seq", g(KR, "footstep00.ogg", "footstep01.ogg", "footstep02.ogg", "footstep03.ogg", "footstep04.ogg"))], "kenney-rpg", "footsteps steps corridor sneak"),
    ("grasssteps", "Footsteps (grass)", P, False, [("seq", rng(KI, "footstep_grass_00{}.ogg", 0, 1, 2, 3, 4))], "kenney-impact", "footsteps grass meadow field sneak"),
    ("book", "Book & pages", P, False, g(KR, "bookOpen.ogg", "bookFlip1.ogg", "bookFlip2.ogg", "bookFlip3.ogg"), "kenney-rpg", "book books scroll letter library spellbook"),
    ("uncork", "Uncork potion", P, False, g(TINY, "vial-glass-uncork-01.wav", "bottle-glass-uncork-01.wav", "bottle-clay-uncork-01.wav"), "tiny", "potion potions bottle drink vial flask"),
    ("chains", "Chains", P, False, rng(RPG, "chain_0{}.ogg", 1, 2, 3), "rd-rpg", "chain chains prison shackles cage jail"),
    ("rocks", "Rockfall", P, False, rng(RPG, "stones_0{}.ogg", 1, 2, 3, 4), "rd-rpg", "rock rocks rockfall collapse rubble boulder boulders mine golem construct constructs earthquake"),
    ("bell", "Bell", P, False, rng(KI, "impactBell_heavy_00{}.ogg", 0, 1, 2) + rng(S100, "bell_0{}.ogg", 1, 2, 3), "kenney-impact rd-100", "bell bells church temple chapel alarm"),
    ("gong", "Gong", P, False, g(S100, "gong_01.ogg", "gong_02.ogg"), "rd-100", "gong temple monastery arena tournament"),
    ("twig", "Twig snaps", P, False, g(TINY, "wood-twigs-break-01.wav", "wood-twigs-break-02.wav"), "tiny", "twig snap ambush hiding hidden sneak"),
    ("drip", "Water drop", P, False, g(TINY, "water-drop-01.wav", "water-drop-02.wav", "water-drop-03.wav"), "tiny", "drip drop leak"),
    ("torch", "Light a torch", P, False, g(TINY, "match-light-01.wav", "lighter-light-01.wav"), "tiny", "torch torches candle candles lantern darkness"),
    ("dice", "Dice", P, False, rng(KC, "dice-throw-{}.ogg", 1, 2, 3), "kenney-casino", "gamble gambling"),
    # ---- moments
    ("victory", "Victory!", T, False, [O("Win_sound.wav")], "win", "victory win celebrate hooray"),
    ("ding", "Ding!", T, False, [O("bell.wav")], "ding", "idea clue discover discovered secret"),
    ("success", "Success", T, False, rng(KF, "confirmation_00{}.ogg", 1, 2, 3, 4), "kenney-interface", "success solve solved puzzle"),
    ("oops", "Oops", T, False, rng(KF, "error_00{}.ogg", 1, 2, 3, 4), "kenney-interface", "fail oops"),
    ("hmm", "Hmm?", T, False, rng(KF, "question_00{}.ogg", 1, 2, 3, 4), "kenney-interface", "mystery riddle question puzzle"),
]

# Always offered on every board, then topped up with keyword matches.
STAPLES = ["swing", "clash", "hit", "spell", "heal", "victory"]

def run(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True)

def loudness(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    j = json.loads(m.group(0))
    return float(j["input_i"]), float(j["input_tp"])

def dur(path):
    return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path).stdout)

def wav(src, out, start=None, length=None, mono=False):
    a = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if start is not None: a += ["-ss", str(start)]
    a += ["-i", src]
    if length is not None: a += ["-t", str(length)]
    a += ["-ar", "44100", "-ac", "1" if mono else "2", "-c:a", "pcm_s16le", out]
    subprocess.run(a, check=True)

def one_shot(src, dst, tmp):
    w = os.path.join(tmp, "a.wav")
    if isinstance(src, tuple) and src[0] == "seq":  # a few steps in a row
        parts = []
        for k, f in enumerate(src[1]):
            p = os.path.join(tmp, f"s{k}.wav"); wav(f, p, mono=True); parts.append(p)
        flt = "".join(f"[{k}]apad=pad_dur=0.12,atrim=0:0.42[s{k}];" for k in range(len(parts)))
        flt += "".join(f"[s{k}]" for k in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *sum([["-i", p] for p in parts], []), "-filter_complex", flt, w], check=True)
    else:
        t = os.path.join(tmp, "t.wav"); wav(src, t, mono=True)
        # drop leading silence and anything past 6 s
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", t, "-af",
                        "silenceremove=start_periods=1:start_threshold=-50dB,atrim=0:6,afade=t=out:st=5.8:d=0.2", w], check=True)
    i, tp = loudness(w)
    gain = min(-18 - i, -1 - tp)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", w, "-af", f"volume={gain:.2f}dB",
                    "-c:a", "libmp3lame", "-b:a", "80k", dst], check=True)

def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".mp3"): os.remove(os.path.join(OUT, f))
    catalog, used = [], set()
    with tempfile.TemporaryDirectory() as tmp:
        for sid, name, cat, is_loop, srcs, credit, tags in SOUNDS:
            files, length = [], None
            for k, src in enumerate(srcs):
                fn = f"{sid}.mp3" if len(srcs) == 1 else f"{sid}-{k + 1}.mp3"
                dst = os.path.join(OUT, fn)
                if is_loop:
                    path, start, ln = (src + (60,))[:3] if isinstance(src, tuple) else (src, 0, 60)
                    length = _loop(path, start, ln, dst, tmp)
                else:
                    one_shot(src, dst, tmp)
                files.append(fn)
            credit = credit.split() 
            used.update(credit)
            e = {"id": sid, "name": name, "cat": cat, "files": files, "tags": tags.split(), "credit": credit}
            if is_loop: e["loop"] = True; e["len"] = length
            catalog.append(e)
            print(f"{sid:12} {len(files)} file(s)", flush=True)
    credits = {k: {"title": v[0], "author": v[1], "url": v[2]} for k, v in CREDITS.items() if k in used}
    with open(os.path.join(REPO, "src", "sounds.json"), "w") as f:
        json.dump({"staples": STAPLES, "credits": credits, "sounds": catalog}, f, indent=1)
    with open(os.path.join(OUT, "CREDITS.md"), "w") as f:
        f.write("# Sound credits\n\nEvery sound here comes from a pack released under **CC0 1.0** (public domain dedication, "
                "https://creativecommons.org/publicdomain/zero/1.0/). They were trimmed, loudness-matched and re-encoded "
                "to MP3 by tools/build_sounds.py. Credit is not required by CC0, but here it is with thanks:\n\n")
        for k, c in sorted(credits.items(), key=lambda kv: kv[1]["title"].lower()):
            ids = ", ".join(e["id"] for e in catalog if k in e["credit"])
            f.write(f"- [{c['title']}]({c['url']}) by {c['author']} — {ids}\n")

def _loop(path, start, length, dst, tmp):
    import numpy as np
    w = os.path.join(tmp, "l.wav"); wav(path, w, start=start, length=length)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", w, "-f", "f32le", "-ac", "2", "-ar", "44100", "-"],
                         check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    n = len(x); c = min(int(3 * 44100), n // 4)
    # seamless loop: the old tail cross-fades (equal power) into the old head
    t = np.linspace(0, np.pi / 2, c)[:, None]
    y = x[: n - c].copy()
    y[:c] = x[:c] * np.sin(t) + x[n - c:] * np.cos(t)
    s = os.path.join(tmp, "s.raw")
    y.astype(np.float32).tofile(s)
    s2 = os.path.join(tmp, "s.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ac", "2", "-ar", "44100", "-i", s, s2], check=True)
    i, tp = loudness(s2)
    gain = min(-27 - i, -3 - tp)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", s2, "-af", f"volume={gain:.2f}dB",
                    "-c:a", "libmp3lame", "-b:a", "96k", dst], check=True)
    return round(len(y) / 44100, 3)

if __name__ == "__main__":
    main()
