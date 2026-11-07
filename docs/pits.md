# Pits, Climb and crossing jumps - 0.42.0

Pits belong to **PF2e Tactical Rules - Movement**. They work for manual PCs/NPCs with Creature AI disabled. AI consumes the same geometry and action resolvers.

The two marked Stadium pits use the existing artwork: 10 feet deep, with rim elevation 0 and rocky walls at **Climb DC 20**. This DC is a chosen GM policy and can be edited. The installer verifies Arena, the Stadium scene ID and the two original annotation IDs, texts and positions; it creates only missing marked Regions. It does not change the artwork, other terrain or actor directory.

## Create another pit

Draw a native Scene Region, add **Pit / climbable drop**, and set:

- **Rim elevation:** the surface around the opening.
- **Depth:** the drop below the rim, in feet.
- **Climb DC:** the wall's Athletics DC.

The Region's horizontal shape defines the opening. Keep the Region's elevation extent over the rim and pit interior, for example bottom -10 and top 1 for a ten-foot pit at ground level. Assign the appropriate scene levels. Disabling the behavior disables this pit's rules. Foundry must reload the module's manifest before accepting its new Region behavior type; a server restart and client reload are needed when upgrading from 0.41.x.

## Entering and falling

Ground movement pauses at the opening, stops its remaining route and settles to a legal grid placement inside the pit. Grab an Edge uses the shared ordinary reaction and a native Acrobatics or Reflex check against the pit's Climb DC. An ordinary success needs a free hand; a critical success does not. A caught creature hangs near the rim and can Climb out. Otherwise the native fall resolver moves it to the pit floor, applies falling damage and Prone when damage is taken. A ten-foot fall deals five bludgeoning damage before native adjustments.

Player-client movement delegates the fall to the active GM after stopping the original movement. Queries check ownership, scene and position. The GM's AI/reaction barrier waits for the result. A long drag cannot carry a ground creature across the opening before resolving its fall. Fly, Climb and Jump retain their separate handling; a failed jump resolves its landing fall explicitly.

Pit support uses the token's horizontal center, an explicit policy for creatures overhanging an edge. Below-rim rays through earth are blocked, while a ray upward through the opening can remain clear. Flyers use the pit bottom as their local floor. Existing tokens are not damaged merely by creating the Region; an automated ground creature already standing unsupported at the rim resolves its fall when its turn prepares.

## Climb out

Select **Climb** in the native movement menu and drag toward the desired bank, or use **Pit: Climb / Jump** on the token toolbar. AI offers these actions automatically.

Climb spends one action, normally requires two free hands, and rolls Athletics automatically. An ordinary success moves five feet, increased by five feet per twenty feet of land Speed above twenty; a critical success adds five more feet. Failure gains no height; critical failure falls. A prepared Climb speed supplies its movement without the ordinary check on these configured walls. Creatures without a Climb speed are off-guard while climbing. Reaching the bank removes only the module's climbing effect.

An armed creature can spend Interact actions stowing its held weapons first. A flyer able to Fly uses flight rather than preparing a slow climb. Fleeing can still make the preparations needed to escape a pit. Manual action counting remains with the player; the AI ledger spends each action normally.

## Jump across

Select **Leap / Long Jump** in the movement menu and drag toward the far bank, or use the toolbar action. The resolver offers only in-scene, unoccupied landings with a wall-clear route over an actual pit.

A one-action horizontal Leap clears up to ten feet at Speed 15+, or fifteen feet at Speed 30+. Larger crossings use the two-action Long Jump activity: its own run-up Stride must cover at least ten feet, followed by a native DC 15 Athletics check. On success, jump distance is the result rounded down to five feet, capped by land Speed. Failure falls back to a normal Leap; critical failure also leaves the creature Prone. Falling short lands in the pit and resolves the fall. A stopped run-up spends the activity but does not grant a free jump from an invalid takeoff.

These are ordinary Leap/Long Jump and prepared Climb-speed rules. Special feats that replace their distances, run-up requirements, or action costs need additional handlers. The module does not silently grant Quick Jump or reinterpret every exceptional movement feat. Pit movement uses the existing square-grid, five-foot ground-navigation scope; it is not general arbitrary cliff, ladder or multilevel pathfinding.

Rules: [Climb](https://2e.aonprd.com/Actions.aspx?ID=2374), [Long Jump and Leap](https://2e.aonprd.com/Actions.aspx?ID=2378), [Grab an Edge](https://2e.aonprd.com/Actions.aspx?ID=2313). The editable DC and center-support policy above are table choices, distinct from those rules.
