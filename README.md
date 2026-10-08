# Hero Kids Table

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension for running **Hero Kids** adventures from your own purchased PDF library.

This repository contains **code only**. No Hero Kids text, maps or art is included or hosted here. You extract your own copy locally with `tools/hk_extract.py`, and the extension loads that folder into your browser (IndexedDB). It only uploads into **your own** Owlbear storage, when you click to do so.

## Add to Owlbear

In a room: **Extensions → Add Custom Extension**, paste the manifest URL:

```
https://natpalmer-e4o4.github.io/hero-kids-table/manifest.json
```

Then enable *Hero Kids Table* for the room. Use one room per campaign.

## Features

- **Create**: build your own heroes, monsters, pets, items and skills. You set the dice pools, health, attack, special action, bonus ability and size, and pick a picture (upload one or reuse any figure from your books). The extension draws the card and token. Custom creatures appear in the party picker and the "Add other monsters" list. Items and skills can be given to a hero, and they show on that kid's device. Back up and restore with a file.
- **Map navigation**: Owlbear extensions can't switch scenes, so keep one "Hero Kids table" scene open. Each adventure has a Maps gallery, and each encounter has a *Show on table* button. Either one swaps the map on the table (grid-aligned, for everyone), clears the last encounter's monsters and jumps the panel to that encounter.
- **Library**: load the extracted `_Owlbear Library` folder. Upload every map as a grid-aligned scene (one square = one cell) and every stand-up and card to your storage. Then *Link* them, so the extension can place tokens for you.
- **Play**: adventure → encounter view with read-aloud boxes (one click shows them full-screen on the kids' screens), features, ability tests, tactics and conclusion. The monster table is scaled to your party size, with *Place monsters* and *Put monster cards on table* buttons. The open scene is followed automatically.
- **Tokens**: right-click → *Hit!* / *Heal* / *Set health*. Labels show ♥♥♡, and a KO'd token tips over.
- **Dice**: Hero Kids attack rolls (highest attack die ≥ highest armor die = hit), ability tests vs difficulty, and initiative. Results go to everyone.
- **Campaign**: party (player → hero card), progress per adventure and notes. Saved in the room.
- **Rules**: searchable rulebook text from your library.

## Works with Owlbear's own extensions

If you enable these official extensions in the room, Hero Kids Table writes data they already understand. None of their code is included.

- **Initiative Tracker**: placed heroes and monsters show up automatically. The *Initiative* roll orders whole sides (Hero Kids style, heroes win ties) and activates the first combatant.
- **Ranges**: each Hero Kids scene is preset to a "Hero Kids" range: Melee 1, Magic 4, Ranged 6 squares (square/Chebyshev).
- **Weather**: an encounter's weather picker (snow, rain, embers, sand, fog, petals) suggests a type from the encounter text.
- **Dynamic Fog**: hero tokens carry a 6-square light, so fog lifts around them when Dynamic Fog is on.
- **Outliner**: tokens are named and layered sensibly.

## Soundboard

The Play tab has a **Sounds** board for whatever map is on the table: background loops (rain, dripping cave, campfire, haunted, crowd…) and one-shot effects (sword clash, goblin, rat squeak, bats, howl, healing, victory…). Each map's board starts from sounds suggested by its encounter text; **Edit board** adds or removes any of the 77 sounds and the change is saved for that map in this browser. **Players hear it too** mirrors the sounds to players' devices after each device taps **Turn on sounds** once.

All sounds are CC0 (public domain) community recordings from Kenney and OpenGameArt artists, rehosted in `public/sounds` — see [`public/sounds/CREDITS.md`](public/sounds/CREDITS.md). `tools/build_sounds.py` rebuilds them from the original downloads (trim, loudness-match, seamless loops, MP3 for iPad Safari).

## Development

```
npm install
npm run dev        # http://localhost:5173/manifest.json can be added to Owlbear while developing
npm run build
```
