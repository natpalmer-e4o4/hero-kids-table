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

- **Library**: load the extracted `_Owlbear Library` folder. Upload every map as a grid-aligned scene (one square = one cell) and every stand-up and card to your storage. Then *Link* them, so the extension can place tokens for you.
- **Play**: adventure → encounter view with read-aloud boxes (one click shows them full-screen on the kids' screens), features, ability tests, tactics and conclusion. The monster table is scaled to your party size, with *Place monsters* and *Put monster cards on table* buttons. The open scene is followed automatically.
- **Tokens**: right-click → *Hit!* / *Heal* / *Set health*. Labels show ♥♥♡, and a KO'd token tips over.
- **Dice**: Hero Kids attack rolls (highest attack die ≥ highest armor die = hit), ability tests vs difficulty, and initiative. Results go to everyone.
- **Campaign**: party (player → hero card), progress per adventure and notes. Saved in the room.
- **Rules**: searchable rulebook text from your library.

## Development

```
npm install
npm run dev        # http://localhost:5173/manifest.json can be added to Owlbear while developing
npm run build
```
