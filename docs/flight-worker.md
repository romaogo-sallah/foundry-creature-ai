# Background flight planning — 0.29.0

The active GM uses one persistent module Web Worker for numeric 3D route proposals and per-target Dive-setup shortlists. Scene Documents, functions, live actors, secret checks, dice and mutations never cross the boundary. Input contains grid bounds, the flyer's footprint and budget, walls, horizontal surfaces, observed occupied volumes and tactical goals using known/remembered enemy positions.

The worker searches a bounded numeric graph and returns up to 24 diverse route proposals. The main thread checks each with Foundry's native collision/surface constraints, complete movement-history costs, occupied volumes, reach, visibility and reaction geometry. Dive setup ranking returns up to four endpoint alternatives per target and origin; native code validates each complete pass, with a wider per-position fallback if the shortlist is obstructed. A ready current-position Eagle Dive still evaluates all native endpoints.

The numeric geometry is deliberately approximate: wall hulls and convex surface hulls can be conservative around directional walls, concave regions and holes. Native validation remains authoritative. If no proposals survive, or workers are unavailable, blocked, timed out or fail to start, the existing native route search remains available. In either backend, native action reservation, damage, reactions, stealth beliefs, Eagle Dive and escape-climb execution remain on the GM thread.

Before accepting a result, the main thread compares battlefield stamps. Movement, relevant actor/weapon state, doors and region changes invalidate route results and rebuild the snapshot, with a bounded retry. Dive ranking also rejects changed state before any action is spent. Stop propagates an AbortSignal through planning and both pre-action validations; cancelled replies cannot reserve an action. Scene teardown terminates the worker and releases pending requests. Expensive full revalidations still exist; this release reduces their workload rather than replacing them with a new cache.

The inherited ground route search is skipped while the actor can Fly. The worker backend is the default **Flight planning engine** module setting; **Native planner** provides an explicit compatibility option. Diagnostics record the selected backend, accepted/proposed route counts and planning time. After an Eagle preview or turn, inspect:

```js
game.modules.get('foundry-creature-ai').api.planning.status()
```

An active worker with increasing `completed` counts confirms actual background requests. A failed or unsupported worker exposes its fallback through decision diagnostics. A full client reload is required after installing the release.

## Validation and measurement

`node tools/benchmark-flight-worker.mjs` compares the current native compatibility path and an actual worker-thread bridge using the same three-opponent fixture. It exercises the production worker module, not a fake message response. The benchmark uses lightweight Foundry substitutes and is not a measurement of a live scene.

The pre-change investigation measured approximately 3.66 s, 30,825 path measurements and 21,606 collision-path checks per airborne three-opponent snapshot. A worker implementation run measured approximately 0.29 s, 1,165 path measurements and 836 collision-path checks. The optimized native fallback measured approximately 1.34 s. Timing varies with machine load; call-count reduction is the stronger evidence. Browser startup, installed modules and complex scene geometry require separate live verification.

Tests cover a real persistent worker, worker/native response agreement, walls and decks, ally traversal, complete Dive → climb turns, native rejection, remembered-position privacy, changed-state rejection, timeout/error fallback and Stop before reservation.

A separate read-only preview in the actual Foundry browser successfully started the module Web Worker and returned 24 routes; all 24 passed native route and movement-cost checks. That route-only batch took approximately 100 ms, including worker startup. It used a hypothetical healthy Eagle at the opening position and did not move, heal, roll for or spend actions on live combatants. This validates browser worker startup and scene geometry compatibility, not the elapsed time of a complete live combat turn.
