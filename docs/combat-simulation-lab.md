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

Use **Decision tree** in the replay header, or open `http://127.0.0.1:4173/web/combat-lab/tree.html`, to inspect the actual planning trace for any recorded decision. Select a decision by round, actor and chosen action. The graph distinguishes facts, constraints, intent and engagement hypotheses, temporal commitments, methods, primitive actions and outcomes. Click a node for its recorded data; drag to pan; use the wheel to zoom. The toolbar can fit the graph, filter inactive or rejected branches and score terms, search nodes, and download PNG or JSON.

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

Actors declare team, HP, AC, Speed, reach, and one or more melee or ranged Strikes. The virtual adapter derives legal movement destinations, PF2e alternating-diagonal costs, line of sight, cover, range increments, MAP, threat exposure, and hazard cost. Allies can be crossed but cannot share a destination; enemies and walls block movement; defeated actors no longer occupy a square.

The saved `simulations/ogres-vs-kobolds.json` fixture starts two ogres and two kobold scouts 24 squares apart. It contains six cover features and two obscuring features, each no larger than two squares. Run its text report with `npm run simulate -- simulations/ogres-vs-kobolds.json --print`.

Each action report records the selected tactical plan, plan reason, objective, chosen primitive, score layer, score terms, five leading alternatives, representative rejections, resolution, and the production planning DAG. Automatic findings identify no-progress rounds, early end turns, avoidable penalized shots, invalid execution, hazard entry, and two-cell movement cycles.

## Scope

The lab is deterministic and intentionally smaller than the PF2e system. It models the parts needed to test planning continuity: square-grid navigation, visibility, cover, terrain, ordinary Strikes, action budgets, damage, defeat, and multiple teams. Foundry remains the integration owner for native rolls, item consumption, effects, reactions, spell templates, token sizes, elevation, and module interoperability. New virtual resolvers can be added as those behaviors receive multi-turn regression scenarios.
