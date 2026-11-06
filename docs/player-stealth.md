# Manual Hide and Sneak — 0.36.2

The **PF2e Tactical Rules — Movement** module supports both PC and manually controlled NPC creature tokens. **Sneak** was previously filtered out for NPCs; 0.36.2 removes that restriction. Reload every client with **Ctrl+F5**. The world setting **Manual Hide and Sneak (PCs and NPCs)** defaults on. An active GM resolves secret checks and saves observer results. No AI profile is needed.

## Play

1. Select a creature token you own, or any creature as GM. Use the sheet's **Hide** action, or the **Hide / Sneak (PCs and NPCs)** token tool. A native Hide roll is reused rather than rolled twice.
2. Choose **Sneak** from the token's native movement menu, then drag a ground path. **Step** and **Walk** are in the same menu; no movement-choice popup is needed.
3. Choosing Sneak adds a removable **Sneak** effect. Each move uses a separate secret check and the current Sneak movement budget. Oversized paths are rejected without moving or rolling. The mode itself grants no Hidden or Undetected state.
4. Choose **Walk**, remove the effect, or use **Stop Sneak** to return to normal movement. Removing the mode does not instantly reveal the creature; revealing actions still do. Each Sneak move costs one action; manual users track their own actions.

NPC manual checks use the same observer records, native Stealth statistic, Speed and terrain rules as PCs. Existing AI-managed moves/rolls bypass manual handling, and AI-owned stealth records keep their existing refresh lifecycle. Movement automation applies during the creature's active turn in combat, and also supports eligible movement outside combat.

## Detection and rules

One secret check is compared separately against each eligible enemy's prepared Perception DC. In combat, observers are living opposing combatants in the scene; outside combat they are living non-allied scene creatures. This follows the framework's existing neutral-observer policy. There is no global Hidden condition: one ogre may observe you while another treats you as hidden or undetected.

Hide requires standard/greater cover, concealment, or blocked sight against that observer. Success normally makes you hidden; hiding again does not lower an existing hidden/undetected state. Lesser cover alone is insufficient.

Sneak uses **half prepared ground Speed**, or full Speed with **Swift Sneak**. Native movement costs, including alternating diagonals and supported difficult terrain, count against that budget. Against each observer, you must start hidden or undetected and end with cover/concealment. **Legendary Sneak** permits the explicit actions without that protection and uses full Speed. Current Speed and feats are checked again on each movement; the effect neither changes the character's general Speed nor grants an automatic Hidden/Undetected state. Success is undetected, failure hidden, and critical failure observed; invisibility retains at least hidden. Continuous declared protected-area cover can supply its Stealth bonus; mere endpoint cover does not grant a bonus across an uncovered gap.

The GM resolves Sneak secretly before replaying its squares so reactions use the result that applies during movement. The same roll is reused on arrival, checking the **actual** stopping square after interruption. Removing the Sneak effect during a secret roll cancels movement; removing it during movement stops further squares after any native movement already in progress. The shared reaction engine waits for all prompts, rolls, damage and effects before movement continues. A successful Sneak retains the old known square for observers who lost track.

Character detection and enemy perception flags refresh on movement and terrain/condition changes, rather than every animation frame. Entering clear sight without protection persists a revelation. Normal Strike rolls preserve their hidden-attacker off-guard benefit for that Strike and its native damage, then reveal; other action-labelled checks reveal before rolling. A failed concealment gate still ends ordinary hiding for the spent attack.

## Scope and corrections

Automated movement currently requires a **5-foot square grid**, snapped ground paths within one scene level (including supported ramps), and supported terrain behaviors. Off-turn movement, flying, swimming, teleportation, special senses, noise adjudication, initiative/Avoid Notice, player Seek, automatic Point Out, passive Legendary Sneak, and feat-specific exceptions beyond the two listed feats remain manual. Since **0.18.0**, taught NPCs [Seek automatically](npc-perception.md), updating their own detection of a hiding player without revealing that player's secret Stealth result to their planner. Hide uses explicit cover regions and blocked sight; Toolbelt wall/creature cover still controls its own attack modifiers and does not supply this module with a public hiding query.

Use **Reveal / stop Sneak** after unchecked actions such as Interact or casting a save-only spell. GM **Detection controls** (eye tool) can correct individual observers after Seek or special adjudication. Independently applied global Hidden/Undetected/Invisible conditions remain separate and require their usual manual removal. No enemy DCs or success list are sent in the player query acknowledgement.

## Storage and API

The character token keeps the canonical `flags.foundry-creature-ai.stealth` observer entries. Each observer token also keeps `flags.foundry-creature-ai.perception.entries`, with `subjectId`, `state`, and `knownPosition`. Both records are scene/combat scoped. Mirrored writes preserve results for other characters. An undetected subject's remembered square is not replaced with its actual new square.

The actor's native effect is tagged `flags.foundry-creature-ai.sneakMode.source = "player-sneak"`; it has no global speed or detection rule elements. Linked tokens share the effect. The old `sneakNextMove` flag migrates once to the visible effect and is cleared, so deleting the effect cannot silently reactivate the old selection. Unrelated effects, including effects merely named Sneak, are preserved.

```js
const stealth = game.modules.get('pf2e-tactical-movement').api.stealth;
await stealth.hide();    // Selected owned creature, secret GM check
await stealth.sneak();     // Enable persistent Sneak; no premature roll
await stealth.stopSneak(); // Remove the mode without changing detection
await stealth.reveal();    // End ordinary hiding and stop Sneak
```

Rules references: [Hide](https://2e.aonprd.com/Actions.aspx?ID=2404), [Sneak](https://2e.aonprd.com/Actions.aspx?ID=2405), [Swift Sneak](https://2e.aonprd.com/Feats.aspx?ID=5222), [Legendary Sneak](https://2e.aonprd.com/Feats.aspx?ID=5173).
