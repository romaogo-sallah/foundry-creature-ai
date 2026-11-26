# Research: tactical scenarios and battlefield-state reasoning

Date: 2026-11-26

Scope: research and architecture specification. No runtime behavior is changed by this document.

## Conclusion

The planner needs a **battlefield model and a scenario-recognition layer between perception and tactics**. The layer should recognize several simultaneous, confidence-rated situations, then let an encounter coordinator publish team objectives and role assignments. Individual actors should choose and execute plans that satisfy those assignments within their own capabilities and knowledge.

A battlefield situation is not a tactic. “Enemy ranged line is far away,” “our left route is a dead end,” and “our caster is exposed” are observations. Charge, coordinated withdrawal, screen, breach, and focus fire are possible responses. Keeping those concepts separate prevents the current failure mode where a tactic label becomes true from one weak fact and then directly biases unrelated actions.

The recommended pipeline is:

```text
perception and actor memory
    -> measured battlefield features
    -> confidence-rated situation hypotheses (many may coexist)
    -> team objective and role assignment
    -> actor tactic/options with entry and exit conditions
    -> contextual target/position queries
    -> bounded multi-action plan search
    -> native execution and feedback
```

This is an extension of the hierarchy in [hierarchical-decision-architecture-research-2026-11-26.md](hierarchical-decision-architecture-research-2026-11-26.md) and the temporal planner in [combat-planning-research-2026-11-26.md](combat-planning-research-2026-11-26.md). It supplies the missing vocabulary and coordination model.

## What the current planner can recognize

The current battlefield assessment records:

- primary role and enemy ranged/melee composition;
- whether the enemy is far;
- nearby cover or concealment;
- head-count advantage and heavy losses;
- close melee pressure against a ranged actor;
- opening ambush and available kiting lane;
- friendly spread;
- friendly and enemy area-effect clustering.

These facts were useful for proving that Charge and Kiting need explicit triggers, but they are too coarse for general tactics:

- head count ignores HP, action quality, conditions, resources, summons, and distance to engagement;
- “spread” does not distinguish a healthy firing line from isolated actors who cannot support one another;
- “clustered” does not record available area shapes, friendly fire, saves, or whether a caster can reach a valid origin;
- “nearby protection” does not say which threat it protects against or whether moving there preserves a shot and an escape route;
- “enemy far” does not say who controls the intervening space, whether the route is a choke, or whether waiting is advantageous;
- every actor recomputes a local interpretation; no team entity assigns a flank, screen, focus target, lane, or retreat order.

The next layer must describe relationships and geometry rather than accumulate more unrelated booleans.

## Findings from prior game-AI work

### Stable front, lanes, confidence, and delegated roles

*Days Gone* coordinates squads with a frontline derived from friendly and enemy centers of gravity. The line supplies direction, width, controlled areas, and one lane per squad member. A confidence value selects forming up, normal engagement, retreat, or pressing the attack. Retreat and advance occur in waves: some members move while others hold and provide fire. Flankers are temporarily excluded from frontline calculation so their movement does not drag the whole formation sideways. Sliding updates and “ghost” positions reduce oscillation.

The transferable ideas are:

- compute engagement direction and formation width once for the team;
- assign lanes and exceptional roles instead of letting every actor chase the same best cell;
- separate group intent from individual execution;
- use hysteresis, dwell time, and stable reference positions;
- coordinate movement and covering actions in waves;
- permit designer-authored home/defend areas as soft attractors rather than hard invisible borders.

Source: Tobias Karlsson, [*Squad Coordination in Days Gone*](https://www.gameaipro.com/GameAIProOnlineEdition2021/GameAIProOnlineEdition2021_Chapter12_Squad_Coordination_in_Days_Gone.pdf).

### Shared plans need assignments, synchronization, and failure feedback

SquadSmart uses hierarchical task decomposition over a shared squad knowledge base. It assigns tasks to suitable members, supports parallel and sequential synchronization, reserves shared resources, caps planning work per frame, and replans when sensed execution differs from the predicted state.

For this project, a team plan must therefore be more than a shared score bonus. It needs named assignments, destination/target reservations, dependency conditions, expiry, and a failure signal. “Flank target T” can assign one mobile creature to a flank while another screens or pressures; it should not make every melee creature select the same destination.

Source: Gorniak and Davis, [*SquadSmart: Hierarchical Planning and Coordinated Plan Execution for Squads of Characters*](https://cdn.aaai.org/ojs/18775/18775-52-22468-1-10-20210929.pdf).

### Tactical positions are contextual queries

Unreal Engine's Environment Query System separates generators, contexts, filters, and weighted tests. Filters run before scoring so expensive work is applied to fewer candidates. The existing tactical-position research reaches the same conclusion: “best position” only has meaning relative to a task.

We should ask queries such as “a first-increment firing position with an escape lane from this bruiser,” “a screen cell between this ally and these enemies,” or “an area origin that catches three enemies without allies.” A universal heat-map maximum cannot answer all three.

Sources: Epic Games, [Environment Query System overview](https://dev.epicgames.com/documentation/unreal-engine/environment-query-system-overview-in-unreal-engine); Matthew Jack, [*Tactical Position Selection*](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter26_Tactical_Position_Selection.pdf).

### Spatial facts should be shared, decisions should remain contextual

Modular tactical influence maps efficiently answer reusable questions such as threat reach, safe withdrawal, ally density, target clustering, and prospective movement. They provide facts, not instructions. The same fields can support a tank seeking an intercept position, a skulk seeking concealment, and a caster seeking an area origin with different recipes.

Source: Dave Mark, [*Modular Tactical Influence Maps*](https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter30_Modular_Tactical_Influence_Maps.pdf).

### Uncertainty belongs in the state

Partially observable planning represents an agent's knowledge as a belief over possible states and recognizes that some actions gather information as well as change the world. We do not need a full POMDP solver, but we need the same distinction: last-known cells, confidence, age, possible regions, and observation value must be first-class inputs. Secret Stealth outcomes may not be replaced with GM truth.

Source: Kaelbling, Littman, and Cassandra, [*Planning and Acting in Partially Observable Stochastic Domains*](https://cs.brown.edu/research/pubs/techreports/reports/CS-96-08.html).

## Vocabulary: facts, situations, scenarios, tactics, and plans

Use these terms consistently in code and diagnostics.

| Term | Meaning | Example |
| --- | --- | --- |
| Measurement | Direct or projected numeric value | nearest hostile can enter melee in 1 action |
| Situation fact | Interpreted state with confidence and evidence | backline exposure = 0.82 |
| Scenario hypothesis | A temporally stable pattern of related facts | protected ranged line under approach |
| Team objective | Desired change for the side | delay approach while preserving firing lanes |
| Assignment | A bounded responsibility given to an actor | Kobold 3 reserves the north retreat lane |
| Tactic/option | Actor-level policy with entry, success, exit, and interrupt rules | kite through reserved north lane |
| Position query | Contextual generator/filter/scorer for destinations or origins | keep first increment, line of effect, and two exits |
| Operator/activity | Executable PF2e action or indivisible activity | Step, Strike, Cast a Spell, Eagle Dive |

Scenario recognition must be **multi-label**. “Enemy is clustered,” “our caster is exposed,” and “left flank is open” can all be true. The coordinator decides which matter now and which actors should address them.

## Battlefield-state model

### Evidence record

Every derived fact should remain inspectable and should decay or expire rather than silently becoming permanent.

```js
{
  id: "backline-exposed",
  scope: { teamId, actorIds: [casterId] },
  value: 0.82,
  active: true,
  confidence: 0.9,
  observedAt: { round: 3, turn: 5 },
  expiresAt: { round: 3, turn: 8 },
  sources: ["enemy:ogre-2", "ally:caster-1", "field:one-turn-threat"],
  thresholds: { enter: 0.7, exit: 0.45 },
  explanation: "Ogre 2 can reach the caster in one action; no ally intercepts its route."
}
```

Separate enter and exit thresholds provide hysteresis. A minimum dwell time prevents a plan from changing because one token moved five feet. A material event such as death, a broken line, a newly observed enemy, or an invalid route may bypass the dwell time.

### Engagement graph

Build a directed graph for every known actor pair. An edge should record:

- can affect now, after one action, this turn, or after the next turn;
- cheapest action cost and route to affect;
- expected damage, control, support, and resource cost by delivery mode;
- expected retaliation over the same horizon;
- reach, range increment, cover, concealment, line of sight, and line of effect;
- save/defense matchup with uncertainty;
- reaction exposure and known reaction availability;
- observation state, last-known position, confidence, and age;
- allies able to support the same engagement.

This graph supports “who can engage whom?” without choosing a target prematurely.

### Shared spatial fields

Compute reusable fields once per materially changed battlefield state:

- one-action and one-turn hostile reach;
- expected incoming damage/control pressure;
- friendly support and healing reach;
- reaction-threat routes;
- directional cover, concealment, and line of effect;
- accessible exits, route diversity, dead-end depth, and map-edge pressure;
- choke width, crossing capacity, and congestion;
- objective, home-area, and escape-border distance;
- hazard, persistent-zone, pit, water, elevation, and difficult-terrain cost;
- area-effect packing for common burst, cone, line, and emanation templates;
- belief mass for hidden or undetected enemies;
- cell reservations and predicted friendly occupancy.

The Web Worker may combine serializable versions of these fields. Foundry geometry remains authoritative and should validate only the shortlist.

### Team metrics

Head count should remain a diagnostic, not the force-ratio formula. Estimate:

```text
effective force =
    remaining effective HP
  x expected useful actions over two turns
  x attack/control/support effectiveness
  x probability of entering useful range
  x condition and resource availability
```

Keep the vector as well as the scalar. A side can have health advantage but no answer to flight, or superior damage but no route through a choke.

Useful team measures include:

- **frontline**: direction, width, friendly depth, enemy depth, and controlled areas;
- **screen integrity**: fraction of dangerous routes to vulnerable allies intercepted by a durable ally;
- **mutual support**: how many allies can affect an attack on each member within one turn;
- **isolation**: low friendly support plus high hostile access;
- **formation connectivity**: connected components under one-turn support distance;
- **tempo**: useful actions available before the opponent's next high-value turn;
- **route capacity**: number of non-overlapping safe advance or retreat corridors;
- **focus opportunity**: target defeat probability minus expected overkill and travel waste;
- **area vulnerability**: expected hostile area value over plausible origins, not proximity alone;
- **resource posture**: burst resources ready, adequate, depleted, or reserved;
- **information posture**: observed, uncertain contact, searching, or contact lost.

## Tactical scenario catalogue

The catalogue is grouped by battlefield problem. These are hypotheses and objectives, not mutually exclusive actor classes.

### Contact, information, and stealth

| Scenario | Recognition evidence | Team objective | Useful assignments | Exit/interrupt |
| --- | --- | --- | --- | --- |
| Establish contact | enemies remembered but none confidently targetable | locate without exposing the whole group | seeker, overwatch/holder, rear security | target observed or memory expires |
| Search last-known area | compact belief region and recent contact | reduce uncertainty efficiently | Seek sectors, Point Out, block exits | target found, region exhausted, urgent threat |
| Counter-ambush | likely hostile positions near concealment/chokes; no clean contact | deny a cheap opening and force reveal | spread, Seek, guarded advance | threats located or attack begins |
| Opening ambush | own attackers have stealth/protection and enemies have not pressured them | synchronize first attacks, then disperse | initiator, follow-up focus, escape lane | ambush spent, detection, melee pressure |
| Re-establish stealth | skulk is exposed but can break observation safely | regain Hidden/Undetected only when future payoff exceeds lost tempo | concealment route, distraction | stealth acquired, route invalid, ally collapse |

Information actions should be valued by how many future plans they unlock. Repeated Seek against the same exhausted region needs a steep repetition penalty.

### Range, tempo, and engagement

| Scenario | Recognition evidence | Team objective | Useful assignments | Exit/interrupt |
| --- | --- | --- | --- | --- |
| Distant melee approach | melee-primary side cannot affect enemies this turn with weak backup fire | close rapidly through the safest high-capacity routes | charge lanes, screen, anti-kite cutoff | useful melee threat established |
| Protected firing line | ranged side has first-increment shots, protection, and retreat space | hold range and spend actions on attacks/reloads | lanes, focus target, reserve mover | pressure crosses threshold or line compromised |
| Ranged line under approach | hostile melee can reach line soon | trade space before contact while preserving shots | staggered retreat, cover fire, lane reservations | safe band restored or contact unavoidable |
| Close-range breakthrough | short-range unit is one setup action from a high-value attack | create and exploit a temporary cast/strike window | breacher, screen, follow-up | payoff executed or setup invalidated |
| Enemy outside effective range | penalized attacks lose to relocation over the horizon | move to first increment or deny line while waiting | firing position query, advance bound | good band reached or urgent target appears |
| Pursuit and cutoff | enemy is disengaging and routes are predictable | intercept rather than follow the same path | pursuer, cut-off flank, objective holder | enemy trapped, escaped, or bait risk rises |
| Delay stronger enemy | direct trade is unfavorable but space is available | maximize enemy movement cost and preserve exits | kite lanes, hazard funnel, rear guard | reinforcement/objective time reached or corner risk |

### Formation and coordination

| Scenario | Recognition evidence | Team objective | Useful assignments | Exit/interrupt |
| --- | --- | --- | --- | --- |
| Form up | multiple friendly components cannot support each other | restore a coherent front without stopping all attacks | anchors hold, displaced units move | connectivity and lane occupancy restored |
| Focus isolated enemy | enemy has poor support and can be defeated before relief | concentrate enough force without overkill | finishers, exit blockers, remaining screen | target defeated, reinforced, or cost rises |
| Flank/pincer | target/front has two accessible attack basins and enough allies | threaten from distinct sides while preserving main line | anchor, flanker, reserve | flank established, route closes, anchor fails |
| Screen vulnerable ally | hostile routes reach a fragile/high-value ally | intercept, body-block, control, or punish approach | screeners, protected actor, peel reserve | exposure falls or another threat dominates |
| Peel engaged attacker | backline/support is already threatened | remove, control, or reposition the threat | controller, damage assist, evacuation | threat neutralized or ally escapes |
| Swarm solitary target | several melee allies can reach distinct legal adjacent cells | create flank/control and fast defeat | cell reservations, control opener, finishers | adjacency full, target escapes, area risk |
| Avoid overcommitment | target already has enough assigned damage/control | redirect excess actors to screen, other targets, or objectives | engagement budget | budget changes or new target appears |
| Regroup after split | flank, forced movement, or pursuit separated the team | reconnect while keeping a viable rear guard | rally anchor, route, holder | mutual support restored |

“Swarming” should require reachable distinct engagement cells, support within the relevant horizon, and a benefit such as flanking or cutoff. Merely having living allies is not evidence.

### Terrain, control, and routes

| Scenario | Recognition evidence | Team objective | Useful assignments | Exit/interrupt |
| --- | --- | --- | --- | --- |
| Hold choke | narrow crossing limits enemy throughput and defenders can affect it | deny passage without blocking own attacks | blocker, reach/reaction holder, ranged support | breach, flank route, or area danger |
| Breach defended choke | objective/enemy lies beyond a narrow threatened crossing | reduce reaction/control risk and establish a foothold | bait/soak reaction, controller, breacher, follow-up | foothold established or cost unacceptable |
| Hazard funnel | enemy routes can be steered through pits, grease, fire, or difficult terrain | deny safer routes and punish forced path | zone caster, blockers, forced movement | hazard expires or alternate route opens |
| Escape dead end | current route diversity is low and threat is closing | leave before attacks make withdrawal impossible | immediate mover, screen | two safe exits available |
| High-ground control | elevation improves lines/range and access is limited | occupy, contest, or deny the platform | holder, climber/flyer, ranged support | advantage lost or objective elsewhere |
| Vertical mismatch | one side cannot effectively reach a flying/climbing enemy | seek cover, Hide, ready/support, or relocate to access | anti-air capable actor, protected holders | reach answer available or flyer commits |
| Water boundary | swim access/speed changes route and engagement geometry | exploit or avoid aquatic mobility advantage | swimmers, shore screen | leave water problem |
| Persistent-zone partition | wall/area spell divides teams or blocks routes | exploit the split or reconnect around/through it | isolate-side focus, route finder, dispel/sustain | zone ends or partition ceases to matter |

### Area effects and spacing

| Scenario | Recognition evidence | Team objective | Useful assignments | Exit/interrupt |
| --- | --- | --- | --- | --- |
| Enemy area opportunity | valid origin/template catches valuable enemies with acceptable friendly fire | cast now or spend one setup action for a materially better area | caster, setup/control, allies clear template | area used, cluster disperses |
| Friendly area vulnerability | plausible enemy area has high expected value | spread while retaining support and lanes | distinct destination reservations | risk falls or immediate focus outweighs it |
| Aura/support cohesion | allies benefit from bounded proximity | remain within effect without forming an ideal hostile area | anchor, beneficiaries | aura gone or area threat dominates |
| Line/cone alignment risk | several allies align with hostile template origins | break alignment rather than merely increase pairwise distance | lateral moves | alignment broken |

Spacing is a constrained optimization: too close invites area effects; too far destroys support. The target is a band determined by known enemy capabilities, not “spread = good.”

### Resources, conditions, and opportunity windows

| Scenario | Recognition evidence | Team objective | Useful assignments | Exit/interrupt |
| --- | --- | --- | --- | --- |
| Burst window | high-value target is debuffed, off-guard, restrained, exposed, or out of reactions | spend limited resources before the window closes | burst damage, control extension | window ends or target defeated |
| Conservation | encounter advantage is stable and cheap actions suffice | preserve slots/ammunition/recharge abilities | cantrips/basic attacks, maintain position | threat spike or decisive window |
| Depleted doctrine | primary ammunition/spells/abilities unavailable | switch delivery mode or assignment | melee backup, support, objective work | resource restored |
| Sustain versus recast | existing sustained effect competes for actions | compare marginal future value against alternatives | sustainer, replacement caster | effect ends or better use wins |
| Reaction economy | enemy reaction is known ready/spent; own reactions have defensive value | bait, avoid, reserve, or exploit the window | bait unit, protected mover | reaction state changes |
| Condition cascade | one setup enables several allies or disables a key defense | sequence setup before dependent attacks | setup actor, beneficiaries | resistance/success makes chain poor |

### Morale, objectives, and encounter phases

| Scenario | Recognition evidence | Team objective | Useful assignments | Exit/interrupt |
| --- | --- | --- | --- | --- |
| Press advantage | effective force, position, and tempo are favorable | advance in bounds, cut exits, avoid waste | movers and holders alternate | confidence returns to neutral |
| Fighting withdrawal | force trend is unfavorable but safe corridors remain | retreat in waves while preserving contact | rear guard, movers, rally point | rally reached or rout threshold |
| Rout/escape | victory is implausible and survival is an encounter goal | reach exits with minimum delay | fastest safe routes, sacrifice screen only if doctrine allows | escaped, trapped, compulsion changes |
| Last stand | no retreat route or home/objective must be defended | maximize delay/effect at defensible anchor | blocker, area control, support | encounter ends or route opens |
| Protect leader/objective | encounter loss condition is not identical to creature deaths | screen, heal, reposition, and trade space | protectors, objective operator | objective safe/lost |
| Capture/interact | spending actions on an objective is worth more than attacks | create an interaction window | operator, screen, denial | interaction complete/invalid |
| Reinforcement timing | help is expected or enemy reinforcements are likely | delay, burst, or reposition for arrival | delay line, spawn denial | reinforcements resolve |
| Boss phase transition | HP/resource/event changes available abilities and priorities | switch doctrine coherently and telegraph it | boss plan plus add assignments | phase exit event |

## Scenario arbitration

### Do not make a giant decision tree

A literal tree over all fact combinations will explode, duplicate subtrees, and hide why a branch existed. Use a **scenario board** containing simultaneous hypotheses. Each scenario supplies:

```js
{
  id: "ranged-line-under-approach",
  scope: { teamId, enemyClusterId },
  confidence: 0.86,
  urgency: 0.78,
  opportunity: 0.65,
  strategicValue: 0.7,
  entryEvidence: [...],
  contradictions: [...],
  enteredAt,
  minimumDwell: 1,
  exitThreshold: 0.4,
  objectives: ["restore-range-band", "preserve-firing-lanes"],
  candidateMethods: ["staggered-kite", "hold-choke", "screen-and-withdraw"]
}
```

Prioritize scenario work with a bounded score such as:

```text
scenario priority =
    confidence
  x strategic value
  x max(urgency, opportunity)
  x capability coverage
  x continuity
  - assignment conflict
  - opportunity cost
```

Mandatory directives and legality remain above this score. The top scenario is not required to consume the whole team. Select a compatible set of objectives, then assign only the actors needed to meet each engagement budget.

### Team blackboard

Add a serializable team board:

```js
{
  teamId,
  revision,
  beliefRevision,
  frontline: { origin, direction, width, friendlyDepth, enemyDepth, confidence },
  confidence: { value, trend, reasons },
  activeScenarios: [...],
  objectives: [...],
  assignments: [
    { id, objectiveId, role, actorId, targetId, areaId, priority, status, expiresAt }
  ],
  reservations: [
    { kind: "cell" | "lane" | "target-budget" | "reaction-bait", ownerId, value, expiresAt }
  ]
}
```

The board may contain only information the team could share. It must not reveal secret check results. Different factions may use different coordination quality: animals can share pack focus and adjacency intent; disciplined troops can use lanes and staged withdrawal; mindless creatures may have no coordinator beyond collision reservations.

### Assignment by bids

For each required role, actors submit a cheap bid:

```text
bid = capability fit + position fit + initiative timing + resource fit
    - travel cost - current commitment cost - risk - conflicting assignment
```

Greedy assignment is adequate initially because teams are small. Reserve the role and relevant space/target budget, then let the actor's hierarchy choose the exact legal sequence. Failed execution releases or revises the reservation.

### Engagement budgets prevent dog-piling

For each target, estimate useful committed effect before assigning another actor:

```text
remaining useful damage = target effective HP - already reserved expected damage
control budget = valuable control not already supplied or redundant
position budget = number of distinct legal engagement cells/lanes
```

Overkill is still allowed when certainty or target danger justifies it, but it becomes an explicit tradeoff.

## Incorporation into the decision hierarchy

Recommended layers:

1. **Mandatory directives and legality** — conditions, defeat, action restrictions, resources.
2. **Doctrine and capabilities** — contribution and delivery vectors derived from statblock/components.
3. **Belief and battlefield model** — engagement graph, spatial fields, formations, objectives, uncertainty.
4. **Scenario recognition** — multi-label contact, pressure, formation, terrain, resource, and objective hypotheses.
5. **Team objective and assignment** — compatible scenario set, roles, lanes, reservations, engagement budgets.
6. **Actor engagement hypothesis** — purpose + delivery + target/group + desired end-state + horizon.
7. **Temporal method** — exploit now, setup this turn, setup next turn, hold, switch, disengage.
8. **Contextual position/target query** — generate, hard-filter, score, validate shortlist.
9. **Bounded multi-action sequence search** — compare legal sequences across the current and next turn.
10. **Native execution and feedback** — execute one action, observe, update facts, repair/replan.

The current plan IDs become actor methods under objectives rather than top-level interpretations of combat. For example:

```text
scenario: ranged line under approach
objective: restore range while retaining damage tempo
assignments:
  Kobold 1 -> hold/fire from north lane
  Kobold 2 -> withdraw through center lane
  Kobold 3 -> withdraw through south lane
actor methods:
  Kobold 1 -> ranged / hiding
  Kobold 2 -> kiting
  Kobold 3 -> kiting
```

Charge similarly becomes one method for distant melee approach. It should not be the only fact visible in the tree.

## Attractors and repellers by scenario

Position scoring should be a named recipe attached to the assignment:

```text
staggered-kite position =
    + preferred range band
    + retained line of effect
    + route diversity
    + directional cover
    + reserved retreat lane
    + ally support band
    - one-turn enemy reach
    - map-edge/dead-end pressure
    - hostile reaction route
    - friendly destination conflict
    - hostile area packing
```

```text
screen position =
    + number/severity of hostile routes intercepted
    + own reach/reaction coverage
    + support from protected ally and other screeners
    - being bypassed in one action
    - blocking allied line of effect
    - excessive surrounding risk
```

```text
flank position =
    + distinct approach basin
    + target exposure from anchor
    + synchronized arrival
    + escape or follow-through route
    - dragging frontline reference
    - unsupported isolation
    - route duration beyond opportunity window
```

Weights belong to the recipe and role profile. Raw fields remain visible in diagnostics.

## Planning and performance

Scenario reasoning should reduce search rather than enlarge it.

1. Recompute shared fields only after material movement, visibility, condition, resource, objective, or actor changes.
2. Recognize scenarios from cached aggregate metrics.
3. Keep the top compatible objectives and a small number of actor assignments.
4. Each assignment activates only relevant candidate generators and position queries.
5. Generate semantic destinations such as lane cells, flank basins, choke anchors, rally points, and area origins.
6. Validate native geometry for the shortlist.
7. Search the top `K` actor sequences under the existing deterministic work budget.
8. Execute one action and replan only the affected scopes.

This changes the branching factor from “every actor considers every tactic, target, and grid cell” to “assigned actors consider a few relevant methods and semantic positions.”

## Decision-graph requirements

The debugger should show causal reduction:

```text
known evidence
  -> active/contradicted scenario hypotheses
  -> selected compatible team objectives
  -> role bids and assignments
  -> actor engagement hypotheses
  -> timing/method
  -> position/target query shortlist
  -> action sequences
  -> chosen action and execution result
```

It should also show:

- confidence, age, and provenance for each fact;
- scenario entry/exit thresholds and continuity bonus;
- why an actor won or lost an assignment bid;
- reservations and target engagement budgets;
- raw spatial score channels for shortlisted cells;
- branches pruned by legality separately from branches rejected by utility;
- the actor/team belief state, clearly distinguished from GM truth;
- the prior plan and the material event that caused a switch.

Do not render each grid cell as a tree node. Display candidate basins or top cells as a position-query subgraph and offer a heat-map overlay for details.

## Simulation research matrix

Every scenario needs a positive fixture, a near-miss negative fixture, and explicit invariants. Results should be checked over several deterministic seeds where choice variance is enabled.

| Fixture | Expected behavior | Forbidden behavior |
| --- | --- | --- |
| protected firing line vs distant chargers | ranged side holds, fires/reloads, then withdraws before contact | retreat on round 1 without pressure; wait after contact |
| three retreat lanes, one dead end | kiters reserve separate viable lanes | several actors enter the same corridor; choose dead end |
| defended doorway | defenders hold choke with support behind | all defenders leave anchor to chase one target |
| breach doorway with ready reaction | expendable/durable actor handles reaction risk; follow-up establishes foothold | fragile caster leads; everyone queues on one cell |
| exposed caster | suitable ally screens or peels while caster repositions/casts | entire team abandons offense; no response |
| isolated enemy near relief | only enough actors focus to win before relief | all actors overkill; nobody blocks relief |
| flank with stable anchor | one actor takes flank while anchor maintains line | whole formation rotates after flanker |
| enemy burst cluster | caster uses or sets up valid area with safe template | single-target cantrip despite clearly superior area |
| friendly cone/line alignment | actors break template alignment while retaining support | random radial scatter into isolation |
| hazard funnel | blockers preserve costly enemy route | melee allies stand in own hazard without reason |
| high platform with two accesses | ranged side holds; melee chooses fastest viable contest route | endless path oscillation or low-value ranged penalties |
| hidden enemy, compact belief region | sectors are searched once and Point Out propagates allowed knowledge | repeated Seek of exhausted sector; omniscient pursuit |
| depleted ammunition | ranged actor changes delivery/assignment | repeated impossible Reload/Strike loop |
| staggered withdrawal after losses | half move, half cover/hold, then alternate | simultaneous rout into congestion |
| objective interaction under pressure | one capable operator interacts while others screen | everyone attacks and loses objective |
| boss transition plus adds | boss changes phase; adds receive complementary assignments | all units independently choose the same new tactic |
| vertical mismatch | unreachable ground units seek protection or useful readiness; flyers remain engaged | ground suicide chase; flyers climb forever |
| water crossing | swimmers exploit depth/route; non-swimmers value shore/choke | use fly speed underwater; ignore vertical water access |

For each fixture, record scenario activations, assignments, reservations, plan switches, action use, damage/control, route choices, and end-state. The test should fail on semantic invariants even if the favored side wins.

## Implementation sequence

### Phase 1: state foundation

1. Introduce evidence records with confidence, scope, provenance, age, and hysteresis.
2. Build engagement graph and team aggregates from actor-visible data.
3. Cache shared fields by battlefield revision.
4. Extend planning traces with facts and contradictions.

### Phase 2: coordinator and reservations

1. Add team boards and coordination-quality profiles.
2. Add objectives, actor bids, assignments, cell/lane reservations, and target budgets.
3. Compute a stable frontline, direction, width, and formation components.
4. Add material-event invalidation and minimum dwell times.

### Phase 3: core scenarios

Implement in this order because the simulation already exposes them:

1. protected firing line;
2. ranged line under approach and staggered kiting;
3. distant melee approach/Charge lanes;
4. focus isolated enemy with overkill budget;
5. form up/regroup;
6. screen/peel;
7. hold/breach choke;
8. friendly area vulnerability and enemy area opportunity.

### Phase 4: uncertainty, terrain, and objectives

Add search sectors, counter-ambush, hazard funnel, high ground, persistent partitions, water/vertical mismatch, capture/protect, reinforcement timing, and phase transitions.

### Phase 5: tuning and authored doctrine

Expose scenario thresholds, coordination quality, acceptable sacrifice, conservation, retreat confidence, and home/defend areas as profiles. Do not hard-code disciplined squad behavior into wolves, mindless undead, or solitary predators.

## Acceptance criteria for the architecture

The new layer is successful when:

- a tactical scenario is supported by several related facts with visible evidence;
- multiple scenarios may coexist without every actor selecting every response;
- coordinated plans assign distinct responsibilities and reserve shared space;
- target focus stops at an explicit useful engagement budget;
- tactics persist until success, contradiction, or a material interrupt;
- position choice is tied to a named objective and query recipe;
- hidden information remains a belief with confidence and age;
- adding a new creature mostly supplies capabilities and doctrine, not a new monolithic decision tree;
- adding a new scenario supplies recognizers, objectives, methods, queries, and tests without modifying unrelated plans;
- the decision graph explains the reduction from battlefield evidence to the next native action.

## Recommended next implementation slice

Use the six-ogres-versus-six-kobolds lab as the first proving ground:

1. compute team frontline, direction, width, formation components, and route capacity;
2. recognize `protected-firing-line`, `ranged-line-under-approach`, `distant-melee-approach`, and `retreat-dead-end-risk`;
3. assign kobold firing/retreat lanes and ogre charge lanes with cell reservations;
4. stagger kobold withdrawal rather than letting all actors kite independently;
5. add target engagement budgets so ogres focus vulnerable kobolds without universal dog-piling;
6. expose scenarios, assignments, and reservations in the saved decision graph;
7. validate with positive and negative fixtures before adding more scenarios.

This slice directly addresses the current combat failure while establishing reusable machinery for casters, flyers, stealth users, bosses, and objective encounters.

## Sources

The machine-readable source ledger is [tactical-scenario-sources-2026-11-26.json](../research/tactical-scenario-sources-2026-11-26.json).

