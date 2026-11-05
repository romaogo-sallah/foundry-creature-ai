# Known-square memory — version 0.18.1

The shared framework distinguishes observing an enemy from knowing a square. A Hidden enemy has a current known square. An Undetected enemy does not; a previously known location can still be investigated without locating its new square. [Automatic NPC Seek](npc-perception.md) now resolves searches during taught creatures' turns.

Patch **0.18.1** projects sight at the proposed endpoint. Regaining a clear physical path to a known Hidden square can support attack lookahead, followed by normal detection and targeting checks after arrival. An Undetected square or unlocated Invisible enemy remains a search; moving does not grant knowledge of the live position. Movement logs show before/after sight references and the penalty for losing every view.

## Memory and pursuit

- Positions are recorded separately for each managed NPC, scoped to the combat and scene. Blinded or unconscious observers do not acquire fresh observed positions.
- Losing sight preserves the last known square. Pursuit geometry, range estimates and movement goals use that position. Undetected movement never supplies its live destination to the planner.
- Hidden retains a current known square. Ordinary movement can update it; successful Sneak makes the creature Undetected and preserves only the old location for that observer.
- Moving to see a remembered square has value even when it requires moving sideways or farther away. Native movement, walls, surfaces, occupancy, terrain, reactions and action budgets still apply. A command's restricted movement action can fund Step/Stride.
- A clear view reacquires an enemy normally when no stealth state prevents observation. A visible but empty remembered square never becomes a phantom attack against the enemy's actual position.

Memory is stored in the token's `foundry-creature-ai.targetMemory` flag. Recreating an adapter or reloading preserves it; a new combat or scene discards old entries. Preview projects knowledge without writing it or changing a subject's position. Global Hidden conditions are not created or removed by remembering a creature.

## Seek and targeting checks

Taught NPCs can spend a real action to Seek near a remembered enemy position. The handler chooses a bounded area from memory, makes one native blind Perception roll, checks creatures actually in that area and updates only the searching observer. It does not aim searches using an undetected enemy's real coordinates or secret Stealth DC. More distant remembered positions remain movement goals so the NPC can approach before searching.

A success can locate an Undetected creature as Hidden, or make a Hidden creature Observed. Critical success can observe either, subject to effects such as invisibility. Failure leaves detection unchanged and still spends the action. The runner rebuilds state and continues; failed searches can exhaust the action budget and trigger the normal automatic-advance option.

Hidden targets whose current square is known can be attacked with an automatic DC 11 targeting check. Concealed targets remain observed and use DC 5; Seek does not remove concealment. Guessing an Undetected square remains manual. Seek through solid obstacles, special senses, darkness exceptions, secret doors, traps, Point Out and player Seek remain GM adjudication. See [search policy and limits](npc-perception.md).

## Initial encounter knowledge

The GM-selected/alliance roster establishes initial encounter squares for ordinary or explicitly Hidden combatants, including one-time initialization behind an obstacle. GM-hidden, Undetected, Unnoticed and Invisible newcomers are not seeded from their live positions. A previously unknown creature can still be found if it actually lies inside an area chosen to search for another known enemy. Unknown creatures never supply search centres.

An explicit Invisible condition without a recorded detection result does not grant its new square to an observer. Successful Seek can locate it, but ordinary vision cannot make it Observed. Detection remains observer-specific, preserving global/manual/granted conditions for other observers.

Complete movement endpoints are observed; long unsplit drags do not reconstruct every intermediate visible moment. For manual undetected movement, establish its relative detection state before moving. Teleports and undo do not broadcast new known squares.

## Checking the running code

Reload every connected client with **Ctrl+F5**. Controls and chat reports should show **0.18.1**. The running JavaScript version is also available through:

```javascript
game.modules.get('foundry-creature-ai').api.version
```

This is independent of the server's potentially cached package metadata. Historical chat reports are not rewritten by an update.

Tests cover remembered versus live positions, Hidden tracking, Undetected isolation, observer-specific Seek, action/MAP costs, interrupted or stale rolls, concealed attacks, movement before seeking and automatic turn advancement. Native multi-client encounter behavior should still be verified in play.
