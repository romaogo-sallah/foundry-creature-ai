# Research: multi-turn tactical combat planning

Date: 2026-11-26

Scope: architecture research only; no runtime behavior was changed.

## Conclusion

The current AI should evolve into a **hierarchical, utility-guided, receding-horizon sequence planner**. It should plan complete action sequences across the creature's current turn, an abstract opponent response, and the creature's next turn. The search should operate on a small set of tactical action bundles and high-value positions, while the existing utility system supplies state evaluation, personality and explanations.

This is a better fit than a raw six-ply tree, pure GOAP, pure behavior trees, or unrestricted Monte Carlo Tree Search:

- Pathfinder 2e turns contain several atomic actions and many legal targets, positions, spell variants and activity costs. A raw tree becomes enormous before it reaches the second turn.
- The domain is already rich in authored rules and expected-value models. Throwing those away for random rollouts would make the AI slower, harder to explain and less reliable.
- The game is dynamic and uncertain. A long plan cannot be executed blindly; the AI must execute one action, observe the native result and reactions, then repair or replace the remainder.
- Position is a state to optimize, not merely a route to the next target. Desired range, cover, line of fire, escape space, flank geometry and spell geometry need explicit state value.

The recommended planner is therefore:

1. select a tactical intent;
2. build role-specific spatial attractor and repeller fields;
3. generate a bounded set of useful endpoints and action bundles;
4. search complete legal sequences with beam search or weighted best-first search;
5. cross the turn boundary with a cheap opponent-response model;
6. evaluate the resulting state after at most six own actions;
7. execute only the first native action;
8. re-plan after every resolved action, reaction, movement interruption or changed battlefield fact.

## Why the current architecture feels bad

The present architecture has useful foundations, but its decision horizon is still mostly one action.

| Current mechanism | What it does well | Structural limitation |
| --- | --- | --- |
| [`BehaviorSystem`](../src/framework/behavior-system.mjs) | Chooses a tactic, gates components and explains score adjustments | A tactic changes the current candidate list; it does not search successor states |
| [`chooseOption`](../src/dawnsbury/chooser.mjs) | Preserves Dawnsbury priority layers and ranks legal actions | It compares immediate candidates, so setup actions regularly lose to actions with immediate value |
| [`activityPlan`](../src/framework/activity-plan.mjs) | Protects a known complete activity from being broken inside the current turn | It is an activity-specific gate, not a general sequence planner, and it cannot value a setup for the next turn |
| caster scenarios | Compares a move plus a spell | It is a special forecast rather than a reusable state transition model |
| [`buildTacticalField`](../src/framework/tactical-field.mjs) | Measures enemy arrival, local mobility and trap risk efficiently | It is scout-oriented, mostly defensive, and does not represent attack bands, directional cover, flank geometry or spell positions |
| decision Web Worker | Keeps numeric ranking off the interface thread | It currently chooses one action from a prepared snapshot; it does not own a forward model |

The result is a collection of local forecasts. Each forecast can be individually sensible while the overall turn remains incoherent. The preferred/backup/desperate tactic hierarchy improves fallback behavior, but it cannot fix a one-step objective function. A creature may choose a good first action with no understanding of whether the remaining actions form a good turn or whether the ending square is useful next round.

## Findings from game AI research

### Multi-action turns need sequence-level search

Baier and Cowling study exactly the difficult shape present here: turn-based adversarial games where one turn contains several atomic actions. They report that the branching factor grows exponentially with actions per turn and that action-by-action search overvalues early actions. Their Flexible-Horizon EMCTS searches complete action sequences and crosses the turn boundary using fast behavior models. In their Hero Academy experiments it outperformed greedy, vanilla MCTS, online evolutionary planning and turn-limited EMCTS baselines. They also found a practical tradeoff: deeper horizons help when the action space is sufficiently controlled, while a very large current-turn space can make extra depth harmful under a fixed budget. [Baier & Cowling, *Evolutionary MCTS with Flexible Search Horizon*](https://cdn.aaai.org/ojs/13023/13023-52-16540-1-2-20201228.pdf)

The direct lesson is not “copy EMCTS.” It is:

- search complete turn sequences rather than optimizing action one in isolation;
- use a fast authored policy to construct and repair sequences;
- prune candidate actions before searching;
- include an opponent behavior model when crossing the turn boundary;
- keep the horizon flexible when the current position has too many branches.

PF2e has only three ordinary actions per turn, which makes a deterministic bounded search more attractive than it would be in Hero Academy. The large cost comes from movement endpoints, spell areas and targets. Those should be abstracted before sequence search.

### Utility and search are complementary

The developers of *Tactical Troops: Anthracite Shift* describe a commercial squad tactics AI that combines strategic Utility AI with tactical MCTS and evaluates both playing strength and believability. This supports a layered design: utility selects or scores the kind of situation the actor wants, while search determines how to achieve it. [Świechowski, Lewiński & Tyl, *Combining Utility AI and MCTS*](https://doi.org/10.1109/SSCI50451.2021.9660170)

Utility response curves remain useful for position value. Game AI Pro recommends normalized inputs and mostly monotonic curves, with deliberate non-monotonic curves for preferred distance bands. Its explicit example is keeping an enemy at arm's length with a peak at the desired distance. It also warns that similar utility scores can oscillate and recommends continuity or additional considerations. [Lewis, *Choosing Effective Utility-Based Considerations*](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf)

For this project, utility should become the leaf-state heuristic and the tactical field recipe. It should stop pretending that the current action's score is the whole plan's value.

### Tactical position selection should be a query pipeline

Game AI Pro's tactical position selection architecture separates:

1. context selection;
2. candidate point generation;
3. cheap hard filters;
4. normalized weighted criteria;
5. expensive checks such as raycasts on the remaining shortlist;
6. asynchronous scheduling and diagnostics.

It also treats a failed position query as feedback to the high-level behavior system, allowing a fallback context rather than forcing an unsuitable move. [Jack, *Tactical Position Selection*](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter26_Tactical_Position_Selection.pdf)

This maps directly to Foundry:

- generate reachable grid endpoints within the action budget;
- reject collisions, illegal elevations, activity-incompatible endpoints and obviously lethal routes cheaply;
- score distance bands, cover direction, exposure, mobility and team spacing in the worker;
- perform native wall, corner visibility, line-of-effect and Region checks only for the top candidates;
- return several alternatives so actors do not contend for a single square.

The same source recommends normalizing continuous criteria, clamping distance inputs, delaying raycasts until cheap filters have reduced the candidate set, and maintaining upper score bounds so expensive criteria can be skipped when they cannot change the winner. Those are particularly relevant because Foundry geometry calls are the main-thread part of planning.

### Influence maps provide reusable attractors and repellers

Dave Mark's modular tactical influence-map architecture was built for individual and small-group RPG combat. Reported uses include placing tanks between enemies and casters, locating safe withdrawal positions, finding enemy clusters for area spells, placing blocking spells, maintaining ally spacing and preventing excessive focus on one target. It emphasizes that influence maps describe battlefield facts; the decision system still chooses what to do with them. Shared maps also avoid recalculating the same spatial facts for every actor. [Mark, *Modular Tactical Influence Maps*](https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter30_Modular_Tactical_Influence_Maps.pdf)

The architecture combines normalized map layers with weighted recipes over a small working area. That is the right model for our attractors and repellers. It is more expressive than one scalar “position value,” while remaining inspectable:

```text
ranged-position =
    + preferred-range-band
    + firing-line
    + directional-cover-from-ranged-threats
    + escape-connectivity
    - melee-intercept-time
    - flank-exposure
    - dead-end-risk
    - repeated-cell-cost
```

The individual layers must remain available in diagnostics. Flattening them early into one heat value would reproduce the current debugging problem.

### Hierarchical plans improve authoring, but execution must stay reactive

F.E.A.R.'s GOAP architecture used A* to plan actions as well as paths, allowing agents to adapt when the environment invalidated a route and freeing designers to express higher-level squad behavior. [Orkin, *Three States and a Plan: The AI of F.E.A.R.*](https://gdcvault.com/play/1013459/Three-States-and-a-Plan)

SquadSmart used HTN methods to decompose high-level tasks into executable operators, with preconditions and explicit state effects. Its game implementation compiled static domain information, time-sliced planning, reserved shared targets and re-planned on events such as a squad member dying. The authors stress that execution needs failure handling because sensed effects may differ from predicted effects. [Gorniak & Davis, *SquadSmart*](https://cdn.aaai.org/ojs/18775/18775-52-22468-1-10-20210929.pdf)

This project should adopt the useful parts without building a general symbolic theorem prover:

- authored tactic decompositions provide action bundles and ordering constraints;
- operators declare preconditions, costs and approximate effects;
- shared reservations coordinate target and destination choices;
- native execution remains authoritative;
- every action boundary is a re-planning point.

### A bounded planner needs action abstraction and a hard work budget

Research on adversarial real-time games shows that restricting search to promising scripted actions can substantially improve results under a limited budget. [Moraes & Lelis, *Asymmetric Action Abstractions for Multi-Unit Control*](https://doi.org/10.1609/aaai.v32i1.11432) Script-guided MCTS research likewise starts from the observation that unrestricted MCTS gets lost in a massive action space. [Yang & Ontañón, *Guiding Monte Carlo Tree Search by Scripts*](https://doi.org/10.1609/aiide.v15i1.5231)

Real-time planning research commonly expands a bounded local lookahead space, evaluates frontier states and commits only to the next action. It also shows that uncertain heuristic estimates should affect which branches receive more search effort. [Mitchell et al., *Real-Time Planning as Decision-Making under Uncertainty*](https://cdn.aaai.org/ojs/4073/4073-13-7130-1-10-20190704.pdf)

For Foundry, a deterministic node-expansion budget is preferable to a time-only budget for repeatability. A time limit remains as a safety cap. Search must always retain the best complete legal prefix found so far.

## Architecture alternatives

| Approach | Strength | Problem here | Decision |
| --- | --- | --- | --- |
| Greedy utility ranking | Fast, explainable, already implemented | Myopic; setup and end position are undervalued | Retain as heuristic and emergency fallback |
| Behavior tree | Excellent reactive execution and hard rule ordering | Does not choose among combinatorial six-action sequences by itself | Use only for directives, recovery and execution guards |
| GOAP / A* | Explainable action planning with preconditions and effects | Generic state propositions and movement grounding would explode; stochastic PF2e effects are awkward | Borrow operator schemas and goal decomposition |
| HTN | Designer control, natural multi-action activities and group roles | Can become brittle if every tactical variation is authored as a branch | Use tactics to generate plan skeletons, then score/search their groundings |
| Vanilla minimax | Models adversarial replies directly | Opponent branching makes six own actions infeasible | Replace opponent turn with a small response model |
| Vanilla MCTS | Anytime and uncertainty-friendly | Expensive rollouts, weak explanations and huge movement/action branching | Defer; useful later as an experimental backend |
| Evolutionary sequence search | Handles complete multi-action turns | Repairing PF2e legality is complex; less deterministic diagnostics | Useful reference, not first implementation |
| Utility-guided beam / weighted best-first search | Deterministic, explainable, reuses existing scoring, easy hard budgets | Needs a careful transition model and pruning | Recommended first implementation |

## Recommended planning model

### Horizon

“Six actions ahead” cannot mean six uninterrupted actions. Between two turns of the same creature, opponents and allies act. The planner should use three phases:

1. **current own turn:** `actionsRemaining` actions;
2. **intervening battlefield response:** one abstract transition derived from known opponents and allies;
3. **next own turn:** three ordinary actions, plus only predictable restricted actions.

This yields up to six own actions when planning at the start of a turn. Planning later in the turn naturally yields fewer. The response transition should update danger, expected damage, likely engagement, cover compromise and target displacement without fabricating exact rolls or secret information.

### Complete activities

Every operator declares an integer action cost and a `mustFitTurn` constraint. Two-action and three-action activities are one search edge, even if their native executor contains multiple internal rolls or Strikes. The planner may place such an activity only when the current phase has enough remaining actions. It may reserve setup for the next turn, but may never put half of the activity on either side of the boundary.

Examples:

- `Stride` is a one-action operator with many possible endpoints;
- `Cast Spell` is a one-, two- or three-action operator according to the chosen variant;
- `Draconic Frenzy` is a two-action operator with an internal native sequence;
- `Eagle Dive` is a complete multi-action operator or an authored compound with an indivisible Dive activity plus a separate escape Fly;
- `Reload + Strike` is a two-step plan, because the actions themselves are separately executable;
- `Hide + Sneak` is a two-step plan with belief-state effects rather than knowledge of secret results.

### Search

Use a beam of complete and partial sequences:

1. generate tactical intents and top position queries;
2. seed the beam with legal action bundles from those intents;
3. expand one operator at a time inside the action budget;
4. merge equivalent abstract states with a transposition key;
5. prune dominated states that spend at least as many actions/resources for no better utility vector;
6. at a turn boundary, apply a small number of opponent response models;
7. retain the best `K` states per depth and tactic family;
8. stop on the node budget or safety deadline;
9. choose the best complete plan, execute its first action and re-plan.

Beam diversity must be structural. Keep at least one candidate per useful tactic family, target and spatial basin before filling the remaining slots by score. This prevents twenty nearly identical Strikes from eliminating the only cover, flank or setup plan.

### State evaluation

Evaluate successor states with a vector before converting it to a scalar:

```text
combat value
 positional value
 plan progress
 team value
 information value
 ability showcase value
- expected incoming harm
- action and resource opportunity cost
- reaction, hazard and control risk
- instability and repetition
```

Hard rules remain gates. A lethal pit, impossible line of effect, unaffordable activity or forbidden condition action does not become legal through a large positive score.

Use discounting between phases, but keep it mild for the next own turn. A reasonable initial policy is `1.0` for this turn, `0.75` after the opponent response and `0.65` for the next turn. These are tuning hypotheses, not PF2e rules.

## Attractors and repellers

An attractor or repeller is a named, normalized feature layer. It is directional and role-aware where necessary. Cover from a northern archer is different from cover from a southern archer; “in cover” is not a global Boolean.

### Shared layers

- reachability and action distance;
- expected enemy arrival time;
- threatened-by-melee count and severity;
- reaction exposure along the route and at the endpoint;
- directional cover and concealment from each known ranged threat;
- own line of effect and line of sight to candidate targets;
- ally occupancy, future reservation and crowding;
- flank offered, flank received and easy-flank exposure;
- escape connectivity, safe exits and dead-end risk;
- hazardous terrain, persistent zones and control zones;
- elevation, surface legality and vertical movement cost;
- repeated-cell and reversal cost;
- target concentration for areas and friendly-fire exclusion.

### Role recipes

| Role | Main attractors | Main repellers |
| --- | --- | --- |
| Melee bruiser | melee reach, flank with ally, route that preserves follow-up actions, control of escape lanes | ending outside reach, ranged-only cover that blocks own approach, severe reaction/hazard route |
| Tank | intercept line between threat and vulnerable ally, chokepoint control, multiple enemies in reach without being surrounded | leaving protected ally exposed, overextension beyond support, low escape connectivity |
| Ranged attacker | first range increment, clear shot, directional cover, lateral escape space | enemy one-action melee intercept, firing through cover, dead-end kiting, unnecessary range penalty |
| Skulk | cover/concealment adjacent to a firing or melee lane, route that retains stealth, escape connectivity, isolated target | open endpoint, redundant Hide, entering a square with no follow-up attack or retreat |
| Controller/caster | spell range, multi-target area, line of effect, safe casting from reactions, maintainable sustained effects | melee engagement, friendly fire, line-of-effect loss, spending all actions to reach a mediocre cast |
| Support | range/line to beneficiaries, central but protected position, ability to reach multiple allies next turn | isolation, being the easiest melee target, redundant buffs or heals |
| Flyer | attack pass geometry, altitude outside hostile reach, affordable recovery route | ending low after attacking, forced hover with no next-turn opening, unbounded climb with no engagement progress |

Distance bands should use trapezoid or bell-shaped response curves. A ranged actor's peak covers the first increment with a safety margin; value drops sharply inside enemy one-action melee reach and more gently beyond the first increment. A melee actor peaks at reachable attack distance, but only when the plan retains enough actions to exploit that position.

## Opponent and uncertainty model

The planner must not read hidden outcomes or exact statistics the actor does not know. It should operate on the same belief snapshot as the current AI.

For the intervening turn, use two or three cheap response scripts rather than branching every legal opponent action:

- **pressure:** approach the planner and use the strongest known attack/control envelope;
- **hold/fire:** remain in a useful ranged or casting position and attack;
- **disengage/reposition:** break line, seek protection or leave the planner's threat envelope.

Weight scripts from observed role, speed, reach and recent behavior. Evaluate the expectation plus a bounded downside term. Bosses may be more risk-aware; mindless creatures may use only pressure. Unknown enemy damage and defenses use level benchmarks, as current spell and Strike evaluation already do.

Random d20 outcomes should not create twenty branches. Use expected damage and condition probability for ordinary search. Branch only on tactical discontinuities whose outcomes change legal plans, such as “target likely restrained,” “caster likely disrupted,” or “movement may stop at this hazard,” and cap those branches.

## Performance practices

- Cache static grid topology, surfaces and walls separately from dynamic threat layers.
- Build shared scene layers once per battlefield revision and derive small actor-centered working maps.
- Generate top `N` endpoints per position query, not every reachable square as an action.
- Run cheap worker filters before native raycasts and Region checks.
- Cache attackability, cover and line-of-effect by `(origin cell, target footprint, geometry revision)`.
- Use typed arrays or compact numeric records in the worker rather than cloned nested candidate objects.
- Use transposition tables and dominance pruning across equivalent action orders.
- Use upper bounds to stop evaluating a candidate whose best possible score cannot enter the beam.
- Give the search a node-expansion budget for deterministic behavior and a wall-clock safety cap for responsiveness.
- Preserve the best fully legal prefix at every depth so cancellation can return a usable plan.
- Reuse the previous plan as the first search seed after an action, then repair it before exploring alternatives.

The worker remains the correct execution platform. Native Foundry geometry should prepare and validate a shortlist; the six-action forward model and field combinations belong in the worker.

## Debugging and authoring requirements

The decision graph should expose:

- the selected tactical intent;
- the top position basins and their attractor/repeller contributions;
- a timeline separated into current turn, opponent response and next turn;
- action cost on every edge and remaining action budget at every state;
- complete multi-action activities as indivisible nodes;
- leaf-state utility vectors and final scalar score;
- pruned branches with reasons such as dominated, unaffordable, illegal at boundary or outside beam;
- the chosen opponent model;
- the predicted plan and the actual re-planning divergence after execution.

The spatial debugger should let the GM select a field recipe and inspect every cell's terms. This is necessary to tune desired range and cover without guessing from the final action.

## Evaluation plan

Do not judge the planner only by whether it wins. Track:

- illegal or interrupted plans;
- unused actions with useful options available;
- turns that end in the role's preferred position band;
- damage dealt and expected damage exposed to;
- resource efficiency and repeated redundant setup;
- flank creation and flank exposure;
- cover and line-of-effect quality;
- route reversals, repeated cells and corner traps;
- plan stability versus necessary re-plans;
- decision latency, native geometry calls, worker nodes and memory;
- creature ability showcase frequency;
- deterministic replay agreement under a fixed seed.

Build a corpus of small tactical vignettes before full encounter tests: ranged actor versus approaching melee, skulk around one cover object, caster choosing between area damage and safety, melee actor needing a two-action approach, flanking opportunity, pit detour, two-turn reload/setup, three-action activity at a turn boundary, and an opponent invalidating the expected plan. Compare the new planner to version 0.47.0 on identical snapshots.

## Recommended implementation order

1. Define pure abstract state transitions and indivisible activity operators.
2. Generalize tactical fields into named normalized layers and role recipes.
3. Add top-`N` tactical position queries with native shortlist validation.
4. Add current-turn beam search and prove it replaces existing special-case forecasts.
5. Add the opponent response transition and next-turn horizon.
6. Add plan repair, reservations and group coordination.
7. Extend the decision graph and heat-map debugger.
8. Tune on tactical vignettes, then replay complete encounters.

The next document turns this recommendation into a concrete module design: [Six-action tactical planner design](six-action-tactical-planner-design.md).
