# Eagle hovering investigation — 2026-11-05

The latest Stadium combat (`U2O3fPySVzeYEtCH`, round 5 at inspection) ran **0.30.0** for every recorded Creature AI decision. The active GM client also reported API runtime **0.30.0**, while the installed source was **0.31.0**. The previous release's open-level flight changes were not loaded in that client.

Both eagles performed Eagle Dive in round 2 and withdrew to 5-foot elevation. In rounds 3 and 4, each chose Hover and then End Turn with two actions left. Diagnostics still recorded two known, visible, living opponents. Their hunt phase remained `gain-height`, preferred altitude was capped at 20 feet, and `highPossible` was false. The worker returned 24 accepted routes, but the old hunting gates offered no useful action beyond hover. The scene had a 0–20 ft ground level and a 20–100 ft upper level without a ceiling surface at that boundary.

A read-only native preview loaded the installed 0.31.0 source through an isolated temporary module path, avoiding the existing browser module cache. From the eagles' exact live positions, with a fresh three-action turn and no actions executed, both retained two known enemies, selected `climb before hunting`, and chose a move from **5 ft to 35 ft**. Each received **24** climbing routes accepted by native validation. The hunt's preferred safe altitude became **40 ft**, with `highPossible: true`. Planning used the real background worker (96 ms and 59 ms in this probe).

No movement, attacks, resource changes or actor resets were performed. The temporary inspection Region removed itself and the isolated source copy was removed after the report was read. Full raw logs and the native inspection report remain in the ignored workspace `.scratch/` directory.

The remedy is to reload the GM client with **Ctrl+F5**, verify **Running code 0.31.0** in Alt+W, and continue on the next eagle turn. Other connected clients should reload as well. This investigation does not justify weakening the attack-and-escape safety rules or forcing attacks against genuinely unreachable sheltered opponents.
