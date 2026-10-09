#!/usr/bin/env python3
"""Map the GM's organized LEOHPAZ sound library onto soundboard buttons.

Writes src/packs/leohpaz.json: for each built-in button ("slot") the pack files that
replace it, plus "extras" — new buttons only this pack provides. Only file *paths*
go into the extension; the audio stays on the GM's computer and is imported into
their browser by the panel.

Usage: python3 tools/build_pack_leohpaz.py <index.json> <repo>
  index.json: [[relpath, seconds, mean_dB, max_dB], ...] scanned from the GM's
  `_Sounds` folder (paths relative to it).
"""
import fnmatch, json, os, sys

INDEX = {r[0]: r for r in json.load(open(sys.argv[1]))}
OUT = os.path.join(sys.argv[2], "src", "packs", "leohpaz.json")

def F(*patterns):
    """Files matching the glob patterns (relative to _Sounds, no .mp3), in order, de-duplicated."""
    out = []
    for p in patterns:
        hits = sorted(k for k in INDEX if fnmatch.fnmatchcase(k, p + ".mp3"))
        if not hits:
            raise SystemExit(f"no match: {p}")
        out += [h for h in hits if h not in out]
    return out

# ---- built-in buttons the pack replaces (ids from src/sounds.json)
SLOTS = {
    # ambience loops
    "rain": F("Ambience/Rain/1 rain outside"),
    "storm": F("Ambience/Storm/1 storm outside"),
    "wind": F("Ambience/Wind/1 wind outside"),
    "river": F("Ambience/River/1 river outside"),
    "waves": F("Ambience/Sea/1 sea outside close"),
    "forest": F("Ambience/Birds/1 birds outside"),
    "birds": F("Ambience/Birds/2 birds inside"),
    "night": F("Ambience/Night/1 night outside"),
    "cave": F("Ambience/Cave/1 cave"),
    "dungeon": F("Ambience/Cave/Layers/4 cave atmosphere layer"),
    "haunted": F("Ambience/Horror/1 creepy 1"),
    "swamp": F("Ambience/Swamp/1 swamp outside"),
    "crowd": F("Places & Crafts/Medieval Carnival/Ambience/Ambience People"),
    "bubbling": F("Ambience/Swamp/Layers/2 swamp bubbles layer"),
    # combat
    "swing": F("Combat/Battle/3[123] swoosh sword*", "Combat/Battle/3[123] Swoosh*", "Combat/Battle/28 swoosh 01", "Combat/Battle/29 swoosh 02"),
    "clash": F("Combat/Weapons/Hits/Hit Metal on metal", "Combat/Battle/3[789] Block 0*", "Combat/Battle/40 Block 04"),
    "hit": F("Combat/Battle/1[45678] Impact flesh 0*", "Combat/Weapons/Hits/Hit Wood on flesh"),
    "arrow": F("Combat/Battle/4[456] bow shot 0*", "Combat/Weapons/Ranged Attacks/Bow Release"),
    "block": F("Combat/Weapons/Guard/*"),
    "draw": F("Combat/Weapons/Charged Attacks/Charge [12]"),
    "yell": F("Places & Crafts/Human Units/Voice Commands/Attack Male 1 [ABCD]", "Places & Crafts/Human Units/Voice Commands/Attack Female 1 [ABC]"),
    "boom": F("Magic/Battle Magic/0[56] Fire explosion 0* large", "Magic/Fire/09 Fire Bomb"),
    # magic
    "spell": F("Magic/Spell Effects II/Arcane Magic School/Arcane Missile/Arcane Missile Cast", "Magic/Spell Effects II/Arcane Magic School/Arcane Burst/Arcane Burst Explosion",
               "Magic/Sorcery/Spells/Holy/01 Holy Cast", "Magic/Sorcery/Spells/Wind/01 Wind Cast"),
    "fireball": F("Magic/Battle Magic/0[789] Fireball 0*", "Magic/Sorcery/Spells/Fire/03 Fire Throw"),
    "heal": F("Magic/Healing & Buffs/0[1234] Heal 0*", "Magic/Healing & Buffs/0[678] Regen 0*"),
    "sparkle": F("Magic/Battle Magic/3[234] Light 0*", "Magic/Sorcery/Spells/Holy/03 Holy Aura"),
    "thunder": F("Magic/Battle Magic/1[789] Thunder 0*", "Magic/Battle Magic/20 Thunder 04"),
    "zap": F("Magic/Lightning/02 Hit", "Magic/Lightning/06 Shock", "Magic/Lightning/04 Lightning II"),
    "laugh": F("Magic/Dark/05 Laughter", "Magic/Dark/02 Laughter Low"),
    # creatures
    "roar": F("Creatures/Demons/Dragon/Dragon Attack OneShot", "Creatures/Beasts & Monsters/Big Guys/Minotaur/01 Minotaur Attack",
              "People/Grunts & Voices/Giant/Giant Wind up [123]"),
    "growl": F("Creatures/Beasts & Monsters/Beasts/Wolf/0[56] Wolf growl *", "People/Grunts & Voices/Beast/Beast Idle [123]"),
    "troll": F("People/Grunts & Voices/Troll/Troll Idle [123]", "People/Grunts & Voices/Troll/Troll Wind up [123]"),
    "goblin": F("People/Grunts & Voices/Goblin/Goblin Laugh [12]", "People/Grunts & Voices/Goblin/Goblin Idle [12]", "People/Grunts & Voices/Goblin/Goblin Attack [123]"),
    "bats": F("Creatures/Beasts & Monsters/Beasts/Bat/0[123] Bat cry *", "Creatures/Beasts & Monsters/Beasts/Bat/0[45] Bat attack *"),
    "spider": F("Creatures/Insects/Insectoid Creatures/Insectoid Click [1234]", "Creatures/Insects/Insectoid Creatures/Insectoid Mandible [123]"),
    "bones": F("Creatures/Undead/Skeleton/0[4567] Skeleton *", "Creatures/Undead II/Skeletons/Skeleton Generic Activate"),
    "zombie": F("Creatures/Beasts & Monsters/Monsters/Zombie/0[67] Zombie idle *", "People/Grunts & Voices/Undead/Undead Idle [124]"),
    "ghost": F("Creatures/Undead II/Ghost/Ghost Appear", "Creatures/Undead II/Ghost/Ghost Attack", "Creatures/Undead/Wraith/Wraith Attack", "Creatures/Undead/Wraith/Wraith Through Floor"),
    "slime": F("Creatures/Beasts & Monsters/Monsters/Slime/0[1345] Slime *"),
    "critter": F("Creatures/Pets & Companions/Squeaks/Squeak Short [1234]", "Creatures/Pets & Companions/Squeaks/Squeak Long [12]"),
    "monsterhurt": F("People/Grunts & Voices/Beast/Beast Damage [1234]", "People/Grunts & Voices/Troll/Troll Damage [12]"),
    "defeated": F("Combat/Battle/69 Enemy death 01", "Combat/Battle/70 Enemy death 02"),
    "frog": F("Creatures/Otherworldly/SwampWitch/Frog Walk", "Creatures/Otherworldly/SwampWitch/Frog Damage"),
    # places & things
    "splash": F("Magic/Water/07 Wave hit", "Magic/Water/08 Wave hit", "Movement/Player Movement/4[89] Landing on water 0*"),
    "dooropen": F("Places & Crafts/Farm/Ambient/Barn Door Open"),
    "doorshut": F("Places & Crafts/Farm/Ambient/Barn Door Close"),
    "lock": F("Interface/Inventory/Managing/Item Unlock", "Interface/Inventory/Managing/Item Lock"),
    "chest": F("Creatures/Pets & Companions/Chest/Chest Open"),
    "coins": F("Interface/Inventory/Drops/Coins", "Interface/RPG UI/0[78][0-9] Buy sell 0*"),
    "gems": F("Interface/Inventory/Drops/Jewel", "Interface/Inventory/Drops/Rare Drop"),
    "book": F("Interface/Book & Parchment/01 book open *", "Interface/Book & Parchment/03 flip page once *"),
    "uncork": F("Places & Crafts/Crafting I/Crafting Professions/Alchemy/0[234] Alchemy Glass handling *"),
    "rocks": F("Magic/Earth/13 Rockfall", "Magic/Earth/14 Stomp"),
    "drip": F("Places & Crafts/Mining Cave/Water Drops/Single Drops [1-6]"),
    # moments
    "victory": F("Music/Jingles & Fanfares/Jingles and Fanfares/Battle/Battle Victory Fanfare"),
    "ding": F("Music/Jingles & Fanfares/Jingles and Fanfares/Secrets/Small Secret"),
    "success": F("Music/Jingles & Fanfares/Jingles and Fanfares/Puzzle Minigame/Success 1", "Music/Jingles & Fanfares/Jingles and Fanfares/Puzzle Minigame/Puzzle Solved"),
    "oops": F("Music/Jingles & Fanfares/Jingles and Fanfares/Puzzle Minigame/Failure", "Combat/Battle/3[456] Miss Evade 0*"),
}

A, C, M, Z, P, T, MU = "Ambience", "Combat", "Magic", "Creatures", "Places & things", "Moments", "Music"
# ---- buttons only this pack has: id, name, category, loop, files, keywords
EXTRAS = [
    ("rainindoors", "Rain on the roof", A, True, F("Ambience/Rain/2 rain house"), "roof shelter hut cottage"),
    ("stormcave", "Storm from a cave", A, True, F("Ambience/Storm/3 storm cave"), "thunderstorm"),
    ("graveyard", "Graveyard", A, True, F("Ambience/Horror/3 graveyard"), "graveyard cemetery grave graves crypt tomb mausoleum crows"),
    ("creepy", "Creepy", A, True, F("Ambience/Horror/2 creepy 2"), "creepy cursed curse witch"),
    ("lavacave", "Lava cave", A, True, F("Ambience/Cave/3 cave lava outside"), "lava volcano magma lair"),
    ("seacave", "Sea cave", A, True, F("Ambience/Cave/2 cave waves"), "grotto smugglers cove"),
    ("beach", "Beach & seagulls", A, True, F("Ambience/Island/2 island beach seagulls"), "island beach seagull seagulls coast cove pirate pirates"),
    ("ship", "Ship at sea", A, True, F("Ambience/Ship/1 ship outside"), "ship ships deck sail sailing boat pirate pirates captain"),
    ("belowdeck", "Below deck", A, True, F("Ambience/Ship/2 ship inside"), "cabin brig"),
    ("waterfall", "Waterfall", A, True, F("Ambience/Waterfall/1 waterfall outside"), "waterfall falls spring fountain"),
    ("underwater", "Underwater", A, True, F("Ambience/Underwater/1 Underwater"), "underwater dive diving mermaid"),
    ("windcave", "Wind in a cave", A, True, F("Ambience/Wind/3 wind cave"), "tunnel tunnels passage chasm"),
    ("farm", "Farmyard", A, True, F("Places & Crafts/Farm/Ambient/Farm Ambience Loop"), "farm farms farmer barn field fields village"),
    ("beehive", "Beehive", A, True, F("Places & Crafts/Farm/Ambient/Beehive Loop"), "bee bees beehive hive honey"),
    ("minecart", "Mine cart", A, True, F("Places & Crafts/Mining Cave/MiningCart/Cart Moving Loop"), "mines miner miners cart minecart"),
    ("dripslow", "Slow drips", A, True, F("Places & Crafts/Mining Cave/Water Drops/Loop LowDrops Slow"), "cistern sewer drain well cellar"),
    ("carnival", "Festival", A, True, F("Places & Crafts/Medieval Carnival/Ambience/Ambience"), "festival fair carnival celebration parade"),
    ("feast", "Feast hall music", MU, True, F("Places & Crafts/Medieval Carnival/Music/FeastHall Retro"), "feast tavern inn hall party festival celebration"),
    ("mystery", "Mystery music", MU, True, F("Music/Synth Beds/Fading Synths/Fading Synth 1"), "mystery mysterious secret puzzle"),
    ("magicmusic", "Magic music", MU, True, F("Music/Synth Beds/Arpeggio Synths/Arpeggio Synth 1"), "wizard enchanted sorcerer"),
    # combat moments
    ("encounter", "Encounter!", C, False, F("Combat/Battle/5[4-8] Encounter 0*", "Music/Jingles & Fanfares/Jingles and Fanfares/Battle/Encounter [123]"), "ambush ambushed"),
    ("bossappears", "Boss appears", C, False, F("Combat/Boss Encounter/Jingles/Boss Encounter [123]"), "boss leader king queen lord champion"),
    ("bossdefeated", "Boss defeated", C, False, F("Combat/Boss Encounter/Jingles/Target Slain [12]", "Combat/Boss Encounter/Battle/Boss Final Blow"), "boss"),
    ("specialmove", "Special move", C, False, F("Combat/Battle/59 Special move 01", "Combat/Battle/6[0-3] Special move 0*"), "special"),
    ("miss", "Miss!", C, False, F("Combat/Battle/3[456] Miss Evade 0*"), "dodge evade miss"),
    ("flee", "Run away!", C, False, F("Combat/Battle/5[0-3] Flee 0*"), "flee escape run"),
    ("claw", "Claw", C, False, F("Combat/Battle/0[1-4] Claw 0*"), "claw claws bear cat tiger"),
    ("bite", "Bite", C, False, F("Combat/Battle/0[5-8] Bite 0*"), "bite fangs jaws"),
    ("bowdraw", "Bow draw", C, False, F("Combat/Battle/4[123] bow draw 0*"), "bow archer archers"),
    ("whip", "Whip", C, False, F("Combat/Battle/8[456] Whip hit 0*"), "whip"),
    ("slingshot", "Slingshot", C, False, F("Combat/Weapons/Ranged Attacks/Slingshot Shot"), "sling slingshot"),
    ("drums", "Drum roll", MU, False, F("Music/Jingles & Fanfares/Jingles and Fanfares/Drums/Drums [123]"), "drum drums arena tournament contest"),
    ("levelup", "Level up!", T, False, F("Combat/Battle/7[345] Lvl up 0*", "Music/Jingles & Fanfares/Jingles and Fanfares/UI/Level Up"), "advancement"),
    ("questaccepted", "Quest accepted", T, False, F("Music/Jingles & Fanfares/Jingles and Fanfares/Quest/Quest Accepted"), "quest mission task"),
    ("questclear", "Quest complete", T, False, F("Music/Jingles & Fanfares/Jingles and Fanfares/Quest/Quest Clear"), "rescue rescued quest"),
    ("secret", "Secret found!", T, False, F("Music/Jingles & Fanfares/Jingles and Fanfares/Secrets/Secret Found", "Music/Jingles & Fanfares/Jingles and Fanfares/Secrets/Special Item Found"), "secret hidden treasure"),
    ("discovered", "New place!", T, False, F("Music/Jingles & Fanfares/Jingles and Fanfares/Area Discovered/Area Discovered"), "arrive arrival discover"),
    ("defeat", "Defeat", T, False, F("Music/Jingles & Fanfares/Jingles and Fanfares/Battle/Defeat"), "defeat lose"),
    # magic
    ("ice", "Ice spell", M, False, F("Magic/Battle Magic/1[3-6] Ice explosion 0*", "Magic/Sorcery/Spells/Ice/03 Ice Explosion"), "ice frost frozen freeze snow winter"),
    ("earthspell", "Earth spell", M, False, F("Magic/Earth/0[1-3] Earth I *", "Magic/Sorcery/Spells/Earth/01 Earth Surge"), "golem druid earthquake"),
    ("windspell", "Wind spell", M, False, F("Magic/Battle Magic/2[5-8] Wind 0*"), "gust tornado whirlwind"),
    ("waterspell", "Water spell", M, False, F("Magic/Water/01 Water ball Cast", "Magic/Water/03 Water ball Hit", "Magic/Battle Magic/2[1-4] Water 0*"), "wave splash"),
    ("poison", "Poison", M, False, F("Magic/Battle Magic/4[6-9] Poison 0*", "Magic/Battle Magic/50 Poison 05"), "poison poisoned venom toxic"),
    ("sleep", "Sleep spell", M, False, F("Magic/Healing & Buffs/4[456] Sleep 0*"), "sleep sleeping asleep lullaby"),
    ("buff", "Power up", M, False, F("Magic/Healing & Buffs/09 Buff 01", "Magic/Healing & Buffs/1[0-2] Buff 0*", "Magic/Healing & Buffs/1[3-6] Atk buff 0*"), "blessing bless strength brave"),
    ("shieldspell", "Magic shield", M, False, F("Magic/Sorcery/Spells/Holy/05 Holy Shield", "Magic/Healing & Buffs/3[345] Shell 0*"), "protect protection ward barrier"),
    ("revive", "Revive", M, False, F("Magic/Healing & Buffs/2[89] Revive 0*", "Magic/Healing & Buffs/3[01] Revive 0*"), "revive wake awaken"),
    ("curse", "Curse", M, False, F("Magic/Dark/03 Debuff", "Magic/Dark/01 Cast", "Magic/Healing & Buffs/2[1-4] Debuff 0*"), "curse cursed hex witch"),
    ("portal", "Portal opens", M, False, F("Magic/Portals & Runes/Portals/Generic/Generic Portal Open", "Magic/Portals & Runes/Portals/Dimension Rift/Dimension Rift Open"), "portal gate rift"),
    ("teleport", "Teleport", M, False, F("Magic/Portals & Runes/Portals/Generic/Generic Portal Teleport", "Movement/Player Movement/8[7-9] Teleport 0*"), "teleport vanish disappear"),
    ("rune", "Rune glows", M, False, F("Magic/Portals & Runes/Runes/Generic/Generic Rune Interact", "Magic/Portals & Runes/Runes/Fire/Fire Rune Interact", "Magic/Portals & Runes/Runes/Ice/Ice Rune Interact"), "rune runes glyph glyphs altar shrine statue"),
    ("summon", "Summon", M, False, F("Creatures/Undead/Necromancer/Necromancer Summon", "Magic/Fire/07 Fire Summon"), "summon summons necromancer"),
    # creatures
    ("dragonbreath", "Dragon breath", Z, False, F("Creatures/Demons/Dragon/Dragon Attack OneShot"), "dragon dragons wyrm breath"),
    ("minotaur", "Minotaur", Z, False, F("Creatures/Beasts & Monsters/Big Guys/Minotaur/0[156] Minotaur *"), "minotaur bull maze labyrinth"),
    ("giant", "Giant", Z, False, F("People/Grunts & Voices/Giant/Giant Idle [12]", "People/Grunts & Voices/Giant/Giant Attack [123]"), "giants ogre ogres"),
    ("yeti", "Yeti", Z, False, F("Creatures/Beasts & Monsters/Big Guys/Yeti/0[12] Yeti Attack 0*"), "yeti snow abominable"),
    ("wolfattack", "Wolf snarl", Z, False, F("Creatures/Beasts & Monsters/Beasts/Wolf/0[1-4] Wolf attack *", "People/Orc Army/Others/Warg/Warg Bite [12]"), "wolf wolves warg wargs"),
    ("orc", "Orc", Z, False, F("People/Grunts & Voices/Orc/Orc Attack [1234]"), "orc orcs hobgoblin brute"),
    ("gremlin", "Imp / gremlin", Z, False, F("People/Grunts & Voices/Gremlin/Gremlin Laugh [12]", "People/Grunts & Voices/Gremlin/Gremlin Attack [123]"), "imp imps gremlin gremlins kobold kobolds pixie mischief"),
    ("witch", "Swamp witch", Z, False, F("Creatures/Otherworldly/SwampWitch/SwampWitch CastCurse", "Creatures/Otherworldly/SwampWitch/SwampWitch Attack [12]"), "witch hag crone"),
    ("wisp", "Will-o'-wisp", Z, False, F("Creatures/Otherworldly/Will o Wisp/Will O Wisp Floating", "Creatures/Otherworldly/Will o Wisp/Will O Wisp Attack"), "wisp wisps spirit lights marsh"),
    ("elemental", "Fire elemental", Z, False, F("Creatures/Elementals/Fire Elemental/Fire Elemental Attack", "Creatures/Elementals/Fire Elemental/Fire Elemental Damage"), "elemental elementals firestarter"),
    ("bugwings", "Buzzing wings", Z, False, F("Creatures/Insects/Insectoid Creatures/Insectoid Buzz [12]", "Creatures/Insects/Insectoid Creatures/Insectoid Wings Spread [12]"), "bee bees wasp wasps fly flies beetle swarm"),
    ("bugspit", "Spit", Z, False, F("Creatures/Insects/Insectoid Creatures/Insectoid Spit [123]"), "spit acid web spider"),
    ("monsterdeath", "Monster falls", Z, False, F("People/Grunts & Voices/Troll/Troll Death [12]", "People/Grunts & Voices/Goblin/Goblin Death [12]", "People/Grunts & Voices/Beast/Beast Death [12]"), "defeated"),
    ("cow", "Cow", Z, False, F("Places & Crafts/Farm/Animals/Cow Moo [12]"), "cow cows cattle farm"),
    ("pig", "Pig", Z, False, F("Places & Crafts/Farm/Animals/Pig Oink [1234]"), "pig pigs piglet boar farm"),
    ("sheep", "Sheep & goats", Z, False, F("Places & Crafts/Farm/Animals/Sheep [123]", "Places & Crafts/Farm/Animals/Goat [123]"), "sheep goat goats lamb farm shepherd"),
    ("donkey", "Donkey", Z, False, F("Places & Crafts/Farm/Animals/Donkey Bray [12]"), "donkey mule"),
    # places & things
    ("chestclose", "Close chest", P, False, F("Creatures/Pets & Companions/Chest/Chest Close"), "chest"),
    ("bag", "Backpack", P, False, F("Interface/Inventory/Bag/Bag Open", "Interface/Inventory/Bag/Bag Close"), "backpack bag pack supplies"),
    ("pickup", "Pick up item", P, False, F("Interface/RPG UI/04[6-9] Pick item 0*", "Interface/RPG UI/050 Pick item 05", "Interface/Inventory/Managing/Item Pick"), "loot"),
    ("equip", "Equip", P, False, F("Interface/Inventory/Managing/Equip", "Interface/Book & Parchment/09 equip 1"), "equip armor weapon"),
    ("scroll", "Scroll", P, False, F("Interface/Inventory/Drops/Scroll"), "scroll letter parchment"),
    ("mining", "Pickaxe", P, False, F("Places & Crafts/Mining Cave/Mining/Mining Rock [123]", "Places & Crafts/Mining Cave/Mining/Reverb Mining Rock [123]"), "mining miner pickaxe dig ore"),
    ("anvil", "Blacksmith", P, False, F("Places & Crafts/Crafting I/Crafting Professions/Blacksmith/*"), "blacksmith forge anvil smith"),
    ("glassbreak", "Glass breaks", P, False, F("Places & Crafts/Crafting I/Crafting Professions/Alchemy/05 Alchemy Glass break"), "glass break shatter bottle window"),
    ("jump", "Jump", P, False, F("Movement/Player Movement/2[89] Jump 0*", "Movement/Player Movement/3[012] Jump 0*"), "jump leap climb"),
    ("land", "Landing", P, False, F("Movement/Player Movement/4[567] Landing 0*"), "landing"),
    ("swim", "Swim", P, False, F("Movement/Player Movement/2[234] Swim Surface 0*"), "swim swimming river lake"),
    ("fireworks", "Fireworks", P, False, F("Places & Crafts/Medieval Carnival/Ambience/Fireworks [12]"), "fireworks celebration festival"),
]

def entry(path, loop):
    """Gain (dB) that brings the file to the board's loudness, from the measured mean level."""
    _, dur, mean, peak = INDEX[path]
    target = -32.0 if loop else -20.0
    g = 0.0 if mean is None else target - mean
    g = max(-15.0, min(12.0, g))
    if peak is not None: g = min(g, -1.0 - peak)  # never clip
    return {"p": path, "g": round(g, 1)}

STAPLE_EXTRAS = {"encounter"}  # always on the board, like the built-in sword/heal/victory buttons
LOOP_SLOTS = {"rain", "storm", "wind", "river", "waves", "forest", "birds", "night", "cave", "dungeon", "haunted", "swamp", "crowd", "bubbling"}
pack = {
    "id": "leohpaz",
    "title": "LEOHPAZ Complete SFX Bundle",
    "folder": "_Sounds",
    "slots": {k: [entry(p, k in LOOP_SLOTS) for p in v] for k, v in SLOTS.items()},
    "extras": [{"id": f"leo-{i}", "name": n, "cat": c, "loop": l, "tags": t.split(), "files": [entry(p, l) for p in fs],
                **({"staple": True} if i in STAPLE_EXTRAS else {})}
               for i, n, c, l, fs, t in EXTRAS],
}
builtin = {s["id"] for s in json.load(open(os.path.join(sys.argv[2], "src", "sounds.json")))["sounds"]}
assert set(SLOTS) <= builtin, set(SLOTS) - builtin
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(pack, open(OUT, "w"), indent=1)
files = {e["p"] for v in pack["slots"].values() for e in v} | {f["p"] for x in pack["extras"] for f in x["files"]}
print(f"slots {len(SLOTS)}/{len(builtin)}  extras {len(EXTRAS)}  files {len(files)}")
print("unmapped built-ins:", sorted(builtin - set(SLOTS)))
