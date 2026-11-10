# Teleport destinations — 0.43.5

Both Liches in the latest Stadium fight used Translocate to reach spaces in the arena's outer structure. The recorded destinations were `(2100, 2590, 0)` and `(3710, 2730, 0)`, from `(2100, 2170, 0)` and `(2520, 2240, 0)` respectively. These are scene pixels and token-bottom elevation in feet. Both decisions were logged by a client still running 0.43.3.

The arena boundary walls block movement but use Limited sight. [Foundry's terrain-wall rules](https://foundryvtt.com/article/walls/) deliberately permit sight across the first such edge so players can see the obstacle itself. That sight result does not establish that the visible area is an empty space where a creature can stand. The old planner accepted it, checked only same-base-elevation token overlap, and then correctly ignored intervening movement walls for teleportation. The combination allowed the invalid landings.

**Conservative AI placement policy:** a movement-blocking terrain wall also blocks the AI's choice of a teleport destination beyond it. Foundry does not provide a solid volume for the artwork enclosed by those wall edges, so the AI treats this ambiguous area as unsafe. This is a placement policy, not a change to ordinary vision, attack targeting or a universal prohibition against teleporting across barriers. Transparent barriers and open doorways still permit a visible, clear landing on their other side.

The destination must also fit the whole token footprint and body:

- Stay within scene bounds and outside the existing pit exclusion.
- Avoid movement-wall segments through the footprint, respecting open doors and level assignments. Contact with the footprint boundary is allowed.
- Avoid the intact solid volume of a Wall of Ice, including partial footprint overlap.
- Avoid horizontal surfaces passing through the body at the center or corners. Standing on a floor or platform is allowed.
- Avoid living token bodies whose occupied volumes overlap, even if their token-bottom elevations differ. Corpses remain passable.

The planner removes unsafe choices before ranking and now samples short 5–20-foot jumps as well as the previous 30–120-foot choices, so a caster near an arena wall can still find a clear nearby landing. Execution checks again before consuming the native spell resource; a newly blocked destination is skipped with the resource unspent. A destination that becomes blocked during casting reactions cancels displacement while keeping the already committed actions and spell resource spent. A valid teleport still uses native displacement and bypasses intervening movement collisions.

This patch applies to the taught AI Translocate resolver. It does not intercept manual teleports, change scene walls, infer arbitrary solid volumes from map artwork, teach long-range remembered destinations, or automatically relocate the two tokens already misplaced. Move those tokens back to the arena manually, or reset their scene positions before another test. No live actors, spell resources or scene positions were changed during verification.

Reload all clients with **Ctrl+F5**. The [verification record](../research/teleport-verification-2026-11-10.json) includes both historical destinations and clear arena controls.
