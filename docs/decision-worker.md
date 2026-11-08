# Background decisions - 0.43.0

**Decision planning engine: Background Web Worker** is enabled by default. Reload every Foundry client with **Ctrl+F5**. No external program, server process, GPU setup or extra browser permission is needed. The worker starts on the active GM's first preview or automated decision and is reused.

All supported creature profiles use the shared worker decision engine: action and target ranking, spell and resource comparisons, remaining-turn caster forecasts, tactical plan/component selection, restricted quickened actions, pit choices, Confused/Fleeing policies and dragon activity setup scoring. Scout tactical-field scoring also runs in the worker. Flight route/Dive proposals retain their existing separate worker client, so a long spell forecast does not queue a flight request behind it.

Foundry Documents, actors, secret rolls, dice and mutations stay on the browser thread. The adapter builds a plain-data snapshot from its existing knowledge and beliefs; the worker cannot inspect an Undetected token or discover whether a secret Hide succeeded. Unexpected live objects and executable values are rejected instead of being serialized. Supported special abilities use the same pure action providers in the worker and compatibility engine.

## Native preparation and responsiveness

Foundry's collision, terrain cost, visibility and Region APIs require the main thread. These are preparation and final validation, not worker authority to move a token. Ground navigation, approach-distance floods, spell-area coverage, teleport candidates, flight proposal validation and scout graph construction release the interface between batches, targeting eight milliseconds of work per batch. A single native API call can exceed that target; this is not a guarantee of a fixed frame rate.

Spell geometry is cached within a snapshot across equivalent slot and Soul Cage bindings. Separate binding IDs, cast ranks, pools and availability remain intact. Native spell-area checks reuse one Region per shape and one line-of-effect result per target/origin rather than rebuilding them for each target in every shape. Prepared actor parts are cached only during a snapshot. All caches are discarded or invalidated before another live decision.

The worker selects one action. The main thread checks its current legality through a fresh worker-backed candidate pass and native geometry before reserving actions, MAP or resources. It validates again after a presentation delay. Movement, actor/item changes, reactions, conditions, walls, Regions, scene changes and combat changes invalidate pending decisions. A stale result causes replanning before a reservation. Stop cancels the pending request and terminates its CPU job; the next valid request can start a fresh worker. Scene teardown closes both clients.

Worker failure, unavailability or timeout pauses automation. It does not silently put a potentially expensive forecast back onto the interface thread. **Main thread (compatibility mode)** is an explicit setting for troubleshooting and custom integrations; it can cause interface stalls. Existing action-reservation and uncertain-action handling still apply to errors after execution has started.

## Inspect the backend

```js
game.modules.get('foundry-creature-ai').api.planning.status()
```

The existing top-level counters describe flight requests. `decisions` contains the decision worker's `active`, `pending`, `completed`, `supported` and `failed` values. Increasing `decisions.completed` confirms actual worker requests. Decision diagnostics record `decisionPlanning.backend`, elapsed time and preparation yield/batch timings.

Custom JavaScript behavior functions registered only in the main window are not automatically copied into a worker. Register their pure implementation in a worker-compatible module, or deliberately select compatibility mode. The worker rejects unknown configured components/plans rather than silently dropping them. The suite's bundled components are already registered.

## Verification

Real worker-thread tests cover the Lich, Wolf, both Ogres, Scout, Pyro, Dero, Eagle, both Manticores, the three Vampires and both Cinder Dragons. They exercise a complete Lich turn, worker candidate revalidation, scout field scoring, condition directives, Stop, stale movement/Region results, explicit worker failure, plain-data boundaries and continued interface timer activity.

The installed browser build was also checked in Arena without executing a turn, adding actors or changing token HP, items, positions or ledgers. The saved encounter had no remaining eligible enemies, so it is not a full-combat performance measurement. A separate controlled Lich snapshot with 59 movement options and 28 casting bindings exercised the browser worker while a UI heartbeat continued. Timing and limitations are recorded in the [verification record](../research/decision-worker-verification-2026-11-08.json).
