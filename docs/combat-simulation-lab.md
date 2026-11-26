# Headless combat simulation lab

The combat lab runs the production decision hierarchy without Foundry, PIXI, canvas state, or a browser. It turns a compact ASCII battlefield into the same serializable state consumed by `planCreatureDecision`, executes the selected primitive, then rebuilds the state for the next action. This catches multi-action and multi-turn failures that isolated candidate tests cannot show.

Run every documented scenario:

```powershell
npm run simulate
```

Run one scenario and print its complete Markdown trace:

```powershell
npm run simulate -- ranged-closes-before-bad-shot --print
```

Run only the combat-lab tests:

```powershell
npm run test:combat
```

Open the standalone browser viewer:

```powershell
npm run view:combat
```

Then open `http://127.0.0.1:4173/`. The page does not load Foundry. It runs the planner in a dedicated Web Worker and replays the finished simulation one decision at a time.

Use **Decision tree** in the replay header, or open `http://127.0.0.1:4173/web/combat-lab/tree.html`, to inspect the actual planning trace for any recorded decision. Select a decision by round, actor and chosen action. `planning-trace@2` displays a causal funnel from situation and legality through every surviving tactic, its objective and timing, unique merged actions, competitive choice and outcome. When several tactics produce the same action, their branches converge on one action node. It creates a method layer only for a real multi-action activity. Full observations and doctrine remain inspectable on the situation node without appearing as unconnected causal branches. Click a node for its recorded data; drag to pan; use the wheel to zoom. The toolbar can fit the graph, reveal genuinely pruned or rejected branches and score terms, search nodes, and download PNG or JSON. See the [saved-tree audit](decision-graph-audit-2026-11-26.md) for the reason behind this structure.

Reports are written to `.scratch/combat-lab/`. The normal test command also runs these scenarios and prints each report path as TAP diagnostics.

## Scenario format

Scenarios live in `src/simulation/scenarios.mjs`. Their map uses one character per grid square:

- `#` is a solid wall or blocked square.
- `+` is cover.
- `?` is an obscuring square. A targeting ray through it applies a DC 5 concealment flat check.
- `~` is difficult terrain.
- `^` is hazardous terrain.
- `.` is an open square.
- Any other character is an actor marker referenced by `marker`.

Actors declare team, HP, AC, Speed, reach, and one or more melee or ranged Strikes. A reload weapon also declares `reload` (its action cost), `ammunition`, and optional `loaded` state. The virtual adapter persists that state across actions and turns: a shot spends one piece of ammunition and unloads the weapon even when concealment prevents the attack from affecting its target, and another shot is illegal until the actor chooses Reload. The planner values Reload by the ranged attack it prepares instead of treating it as a creature-specific script.

Actors can declare `role: "melee"` or `role: "ranged"` to identify their primary doctrine when they carry a backup weapon of the other type. A ranged scout carrying a shortsword consequently remains a ranged unit until the situation makes its backup necessary; a melee bruiser carrying javelins can Charge instead of treating a remote throw as its primary plan.

The virtual adapter derives legal movement destinations, PF2e alternating-diagonal costs, line of sight, cover, range increments, MAP, threat exposure, and hazard cost. Allies can be crossed but cannot share a destination; enemies and walls block movement; defeated actors no longer occupy a square.

The saved `simulations/ogres-vs-kobolds.json` fixture starts two ogres and two kobold scouts 24 squares apart. It contains six cover features and two obscuring features, each no larger than two squares. Run its text report with `npm run simulate -- simulations/ogres-vs-kobolds.json --print`.

The browser scenario list also includes `simulations/six-ogres-vs-six-kobolds.json`: a 60×60-square, 300×300-foot battlefield for six ogres and six kobold scouts. Its broken ruin walls retain multiple crossings, while twelve cover sources, six fog patches, four rubble fields and four hazardous pit clusters create distinct lanes. The compact browser rendering keeps the complete sixty-column map visible. In this headless scenario, `^` pit cells use hazardous-terrain damage; falling, Climb and Leap are outside the lab's current resolver scope.

Each action report records the selected tactical plan, plan reason, objective, chosen primitive, score layer, score terms, five leading alternatives, representative rejections, resolution, and the production planning DAG. Automatic findings identify no-progress rounds, early end turns, avoidable penalized shots, invalid execution, hazard entry, and two-cell movement cycles.

The planning DAG begins with a battlefield assessment. It records primary role, enemy range composition, distance band, nearby protection, numerical advantage, losses, close pressure, formation spread, and friendly/enemy AOE clustering before comparing tactical plans. Charge is a component-backed plan: a healthy melee-primary actor keeps near-maximal, safe Strides toward a distant foe rather than taking short Steps or extreme-range desperation shots.

## Scope

The lab is deterministic and intentionally smaller than the PF2e system. It models the parts needed to test planning continuity: square-grid navigation, visibility, cover, terrain, ordinary Strikes, reload weapons and ammunition, action budgets, damage, defeat, and multiple teams. Multi-goal reverse distance fields preserve wall, occupancy and alternating-diagonal routing while avoiding a separate full path search for every candidate destination on large maps. Foundry remains the integration owner for native rolls, item consumption beyond the declared virtual ammunition, effects, reactions, spell templates, token sizes, elevation, and module interoperability. New virtual resolvers can be added as those behaviors receive multi-turn regression scenarios.
