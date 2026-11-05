# Player Hide and Sneak — 0.15.3

Patch **0.15.3** fixes ordinary snapped dragging across scene regions. Foundry-generated intermediate boundary points are rebuilt from the requested path instead of being mistaken for unsnapped user waypoints. Native token snapping also handles footprint offsets and coordinate rounding. Partial API waypoints inherit unchanged coordinates/elevation/level. Actual unsupported level/elevation/size changes and explicit unsnapped destinations retain manual handling.

Patch **0.15.2** fixes duplicate registration of the native check wrapper during startup. Terrain checks and player stealth share one registration; no libWrapper setting changes or module disabling are needed. Reload every client after installing the fix.

Reload **every client with Ctrl+F5**. The world setting **Foundry Creature AI → Player Hide and Sneak** defaults on. An active GM is required to resolve secret checks and save observer results. The feature works for character tokens without selecting an AI profile, including outside combat.

## Play

1. Select your character. Use the sheet's **Hide** action, or roll **Stealth** and choose **Hide** when asked. A sheet roll is reused; the GM does not roll a second check. The **Player Hide / Sneak** token tool (masked figure) also offers Hide.
2. Drag a ground movement path. With opposing observers present, the movement prompt offers **Stride**, a legal **Sneak**, and a legal **Step**. Stride ends ordinary hiding; Step preserves it while protection remains. Cancelling leaves the token in place.
3. Choosing **Sneak** on the sheet, **Start Sneak** on the masked-figure tool, or **Sneak** in the movement prompt adds a native **Sneak** effect with a token icon. While it remains active, ground moves automatically Sneak without the movement-choice popup. Every move gets its own secret check; clicking Sneak does not roll before a path exists. An excessive path is rejected without rolling or moving, leaving the mode active so you can shorten the path.
4. Remove **Sneak** from your own Effects panel/sheet, or choose **Stop Sneak** in the masked-figure tool, to stop automatic Sneak. It remains active across moves and turns until removed. Removing it does not spend an action, roll a check, or instantly reveal you. Attacks and other revealing actions change detection without removing the movement choice. **Reveal / stop Sneak** intentionally does both.

Hide and each Sneak movement cost one action. Toggling the mode itself does not spend or refund an action. **Players still track their own actions**; these controls do not change another module's action counter. Each drag represents at most one movement action. In combat, movement automation applies during that character's turn. Walking, keyboard movement and normal API walking use the same engine.

## Detection and rules

One secret check is compared separately against each eligible enemy's prepared Perception DC. In combat, observers are living opposing combatants in the scene; outside combat they are living non-allied scene creatures. This follows the framework's existing neutral-observer policy. There is no global Hidden condition: one ogre may observe you while another treats you as hidden or undetected.

Hide requires standard/greater cover, concealment, or blocked sight against that observer. Success normally makes you hidden; hiding again does not lower an existing hidden/undetected state. Lesser cover alone is insufficient.

Sneak uses **half prepared ground Speed**, or full Speed with **Swift Sneak**. Native movement costs, including alternating diagonals and supported difficult terrain, count against that budget. Against each observer, you must start hidden or undetected and end with cover/concealment. **Legendary Sneak** permits the explicit actions without that protection and uses full Speed. Current Speed and feats are checked again on each movement; the effect neither changes the character's general Speed nor grants an automatic Hidden/Undetected state. Success is undetected, failure hidden, and critical failure observed; invisibility retains at least hidden. Continuous declared protected-area cover can supply its Stealth bonus; mere endpoint cover does not grant a bonus across an uncovered gap.

The GM resolves Sneak secretly before replaying its squares so reactions use the result that applies during movement. The same roll is reused on arrival, checking the **actual** stopping square after interruption. Removing the Sneak effect during a secret roll cancels movement; removing it during movement stops further squares after any native movement already in progress. The shared reaction engine waits for all prompts, rolls, damage and effects before movement continues. A successful Sneak retains the old known square for observers who lost track.

Character detection and enemy perception flags refresh on movement and terrain/condition changes, rather than every animation frame. Entering clear sight without protection persists a revelation. Normal Strike rolls preserve their hidden-attacker off-guard benefit for that Strike and its native damage, then reveal; other action-labelled checks reveal before rolling. A failed concealment gate still ends ordinary hiding for the spent attack.

## Scope and corrections

Automated movement currently requires a **5-foot square grid**, snapped ground paths on one elevation/level, and supported terrain behaviors. Off-turn movement, flying, swimming, teleportation, special senses, noise adjudication, initiative/Avoid Notice, player Seek, automatic Point Out, passive Legendary Sneak, and feat-specific exceptions beyond the two listed feats remain manual. Since **0.18.0**, taught NPCs [Seek automatically](npc-perception.md), updating their own detection of a hiding player without revealing that player's secret Stealth result to their planner. Hide uses explicit cover regions and blocked sight; Toolbelt wall/creature cover still controls its own attack modifiers and does not supply this module with a public hiding query.

Use **Reveal / stop Sneak** after unchecked actions such as Interact or casting a save-only spell. GM **Detection controls** (eye tool) can correct individual observers after Seek or special adjudication. Independently applied global Hidden/Undetected/Invisible conditions remain separate and require their usual manual removal. No enemy DCs or success list are sent in the player query acknowledgement.

## Storage and API

The character token keeps the canonical `flags.foundry-creature-ai.stealth` observer entries. Each observer token also keeps `flags.foundry-creature-ai.perception.entries`, with `subjectId`, `state`, and `knownPosition`. Both records are scene/combat scoped. Mirrored writes preserve results for other characters. An undetected subject's remembered square is not replaced with its actual new square.

The actor's native effect is tagged `flags.foundry-creature-ai.sneakMode.source = "player-sneak"`; it has no global speed or detection rule elements. Linked tokens share the effect. The old `sneakNextMove` flag migrates once to the visible effect and is cleared, so deleting the effect cannot silently reactivate the old selection. Unrelated effects, including effects merely named Sneak, are preserved.

```js
const stealth = game.modules.get('foundry-creature-ai').api.stealth;
await stealth.hide();    // Selected owned character, secret GM check
await stealth.sneak();     // Enable persistent Sneak; no premature roll
await stealth.stopSneak(); // Remove the mode without changing detection
await stealth.reveal();    // End ordinary hiding and stop Sneak
```

Rules references: [Hide](https://2e.aonprd.com/Actions.aspx?ID=2404), [Sneak](https://2e.aonprd.com/Actions.aspx?ID=2405), [Swift Sneak](https://2e.aonprd.com/Feats.aspx?ID=5222), [Legendary Sneak](https://2e.aonprd.com/Feats.aspx?ID=5173).
