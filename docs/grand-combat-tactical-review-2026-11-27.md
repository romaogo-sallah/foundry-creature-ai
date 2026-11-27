# Tactical review: scenario-coordinated grand battlefield

This review covers the deterministic `six-ogres-vs-six-kobolds-grand-battlefield` Combat Lab run from version 0.55.0, seed 6606. It evaluates decisions as combat tactics and separates planner defects from simulator omissions. The retained generated report is ignored workspace evidence in `.scratch/combat-lab/`; the committed starting state is [`simulations/six-ogres-vs-six-kobolds.json`](../simulations/six-ogres-vs-six-kobolds.json).

The ogres won in round 7. All six ogres survived with 263 of 354 total HP; all six kobolds were defeated. The run contains 195 decisions, 185 spent actions, 331 damage and 2,880 feet of movement. Structural checks reported no illegal execution, cycling, avoidable range-penalty attack, hazard entry or no-progress round. Those checks establish mechanical consistency, not tactical quality.

## Verdict

The ogres acted well at the level represented by the lab. Their main line was coherent: charge at full speed, use a zero-penalty javelin when one action remained, transition to greatclub range, and concentrate enough attacks to remove one kobold at a time. They defeated Kobolds 4, 6, 5, 3 and 1 in successive rounds before finishing Kobold 2. They made 18 attacks, 14 of which dealt damage, for 240 damage including overkill. They did not waste attacks at range penalties.

The kobolds acted competently during deployment but poorly over the whole fight. Every scout reached protection and every scout eventually made one Hidden opening attack. Reload accounting remained valid, all 20 crossbow attacks were made at no range penalty, and five scouts executed a retreat move before defeat. Those are real improvements. They are not enough to call the tactics good: the scouts surrendered too many firing opportunities, changed focus repeatedly, retreated toward map edges, and failed to kill a single ogre after dealing 91 damage.

As a tactical grade, this is approximately **good for the ogres and weak for the kobolds**. The architecture now produces recognizable phases, but its target allocation and future-position evaluation still do not make those phases effective.

## What worked

### The opening and approach phases were recognizable

All six kobolds selected Opening Ambush. Five ended round 1 in cover or obscuring terrain; the sixth reached its protected firing position in round 2. All six later spent the Hidden attack. This demonstrates that scenario selection, assignments, terrain attraction and per-actor ambush completion work together.

All six ogres selected Charge in round 1 and spent all three actions advancing. Charge remained available to melee-primary actors, while no kobold mistook its backup shortsword for a charging doctrine. The ogres used 63 charge-plan decisions and reached offensive range without taking a penalized throw.

### Reload and attack sequencing was coherent

The kobolds used 17 Reload actions for 20 crossbow attacks. Sequences such as Strike, Reload, Strike and Reload, Strike, Reload respected the loaded state. No scout fired an unloaded crossbow. This is important because the earlier lab ignored reload entirely.

### Pressure caused a phase change

The ranged side changed from Opening Ambush and Protected Firing Line into Fighting Withdrawal. Retreat and rear-guard assignments alternated: some kobolds moved while others reloaded or fired. The ogres changed from pure Charge to Aggressive and Press Advantage when attacks became practical. Actors did not remain in their opening tactic for the entire encounter.

### Initial terrain use was meaningful

Protected terrain accounted for 20 kobold turn-end positions, mostly during rounds 1–4. The opening was no longer an open-field exchange that ignored all authored terrain. No actor entered a pit or difficult-terrain trap without a reason.

## Tactical failures

### 1. Opening fire was much too conservative

Round 2 is the clearest failure. Kobolds 1, 2, 5 and 6 ended with all three actions; Kobold 3 hid and then ended with two. The engine preferred a value-3 “retain the hiding end-state” option over crossbow shots assessed at −2. It also rejected movement because leaving the hiding position would abandon protection.

This policy treats one penalized shot as an isolated bad action. It does not compare complete timelines. A Hidden scout facing enemies that cannot attack it that round should compare:

- shoot at −2, retain the Hidden benefit for that attack, reload, and possibly reposition;
- wait, preserve Hidden, and fire next round at no penalty;
- adjust within protection to reduce the penalty while keeping an escape lane.

The current result discarded almost an entire team volley. A −2 attack can be correct when the alternative is three unused actions, especially when Hidden makes the target off-guard and the enemy is spending its whole turn advancing.

### 2. Team target assignments were unstable and geographically poor

The assignment board did not produce practical lane-local focus. In round 1, four northern kobolds were assigned Ogre 2 and two southern kobolds Ogre 4. In round 2, **every kobold was assigned Ogre 6**. In round 3, all were assigned Ogre 1; in round 4, all were assigned Ogre 5. Those switches occurred before the previous focus target was defeated.

For northern scouts, the round-2 assignment to the southern Ogre 6 was particularly poor. Their actual candidates often targeted a closer ogre, but then received a penalty for violating the team budget. The board therefore described coordination while scoring against locally sensible attacks.

The final damage shows the consequence: Ogre 1 took 7, Ogre 3 took 35, Ogre 4 took 14, Ogre 5 took 35, and Ogres 2 and 6 took none. Ninety-one damage spread over four 59-HP creatures produced no removal. A stable focus on either Ogre 3 or Ogre 5 could have changed the action economy.

Target coordination needs:

- lane and travel-time compatibility;
- continuity unless the target becomes invalid or a decisive opportunity appears;
- preference for finishing a wounded target;
- expected-damage reservations instead of a simple number-of-attackers budget;
- immediate reassignment after likely lethal damage, without penalizing reasonable local targets.

### 3. Kiting destinations delayed contact but did not create safety

The fighting-withdrawal phase generated ten retreating Strides. The movement generally increased separation for one action, but it did not ask whether the destination remained escapable after the enemy's next turn. Kobold 5 retreated to `(50,48)`, near the southern and eastern boundaries. Kobold 3 moved to `(52,7)` before trying to run west. The north group ultimately compressed against the top edge.

An ogre could usually answer one 25-foot retreat with two Strides and still attack or throw. The kobolds therefore needed routes that changed geometry: pass behind a wall, cross an obscuring zone, force a choke, rotate toward allied fire, or begin withdrawal one round sooner. Only one later withdrawal ended in cover. The plan used a distance gradient, but not a route-level survival forecast.

The destination field should repel map edges and dead ends unless they are actual exits, include enemy two-action threat reach, reward future cover and line breaks, and reserve escape lanes across multiple turns.

### 4. The opening scenario remained dominant too long

Opening Ambush accounted for 46 decisions and remained active through round 4 because completion was tracked per actor. Per-actor completion is correct, but the scenario priority became a team-wide brake: scouts that had not yet spent their Hidden shot continued to receive ambusher constraints while melee pressure was already decisive.

Ambush completion should remain an actor fact, while the team objective can transition once contact risk crosses a threshold. A late ambusher should be allowed to fire, retreat, or abandon the prepared shot according to survival value. It should not keep the whole scenario strategically dominant.

### 5. The ogres coordinated kills but still overcommitted damage

The ogres' practical focus was much better than the kobolds': pairs of attacks removed low-HP scouts in consecutive rounds. Several attacks nevertheless produced substantial overkill: Kobold 5 received 20 plus 24 damage, Kobold 1 received 20 plus 24, and other targets drew attacks after lethal damage was already likely.

This is less damaging than the kobolds' under-focus, but it exposes the same missing model. The board reserves attacker counts rather than expected damage and initiative order. A useful reservation should record expected normal and critical damage, target remaining HP, uncertainty, and whether another attacker acts before the target.

### 6. Some scenario labels were diagnostic rather than actionable

`enemy-area-opportunity` appeared for an ogre that had no area action and led to an ordinary Strike. `distant-melee-approach` remained the dominant team scenario after several ogres had reached attack range because other members still had distant engagements. These labels were not directly illegal, but they show that team scenarios need capability gates and actor-local relevance before they influence plan priority.

## Simulator limits affecting the verdict

The lab is useful for scenario and movement policy, but it is not a faithful PF2e balance test.

- Ogres can repeatedly use a javelin as a one-action prepared Strike. The Foundry profile requires drawing and tracks ammunition. The lab therefore overstates mobile ranged pressure.
- The lab does not reproduce every reaction, Large-creature occupancy interaction, maneuver, flank, special ability or Foundry visibility detail.
- Deterministic rolls in one seed strongly favored the ogres: 14 of 18 ogre attacks dealt damage, while 11 of 20 kobold attacks did. Decision quality should be judged across multiple seeds after the policy defects are fixed.
- “No automated findings” means the scripted invariants passed. It does not mean the combat was tactically optimal.

## Priority order for the next correction

1. Replace global, oscillating target IDs with sticky lane-aware assignments and expected-damage reservations.
2. Evaluate ambush fire across a turn horizon so a −2 shot can beat wasting a complete turn.
3. Add multi-turn escape-route scoring with edge/dead-end repulsion and enemy response reach.
4. Let pressure override an unfinished opening objective for actors whose survival window is closing.
5. Bring the lab's javelin draw/ammunition economy closer to the Foundry executor before using win rates as evidence.

The new hierarchy is a meaningful improvement over the old one-root/N-leaves selector: it produced doctrine, scenarios, assignments and phase changes that can be inspected. The combat also shows that a well-formed hierarchy can still choose poor tactics when its shared target board and future-state utility are wrong. Those two layers are now the limiting factor.
