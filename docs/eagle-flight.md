# Eagle and shared flight — 0.32.0

The supplied Monster Core Eagle has Beak, agile Talon, fly Speed 60 feet, land Speed 10 feet and two-action Eagle Dive. The adapter binds prepared native attacks and recognizes the compendium provenance. It does not execute text from imported descriptions.

The initial inspected Eagle battle ran the basic NPC fallback under **0.26.3**. Its 21 retained Eagle decisions were 16 Steps and five Strides, with no attacks. Version 0.28.0 replaced that fallback with the Eagle profile. Reload every client and confirm the actual runtime in Alt+W.

## Shared flight

Actors with a prepared fly Speed receive the reusable flight system and default Flight behavior component. Ground movement options are removed while Fly is available. Grounded flyers normally take off; a deliberate aerial disengagement can instead land in protection and use shared Hide. Routes include altitude in their state and visitation keys and use native walls, floor surfaces, movement measurement and budget constraints. Since 0.31.0, flight crosses open scene levels and updates the token’s level along the path. Level boundaries alone are neither ceilings nor floors; the bounded planning window expands with altitude.

The native flight cost wrapper applies to Fly movement, including manual native Fly rulers. Moving upward adds the difficult-terrain increment of five feet per square; this preserves alternating diagonal costs and does not stack difficulty twice. Moving straight down costs half. Diagonal descent has its ordinary cost. Previously discounted descent is not discounted again. Environmental terrain still comes through the native cost callback.

The Eagle reserves its last action for Fly when needed to remain aloft, including a zero-distance hover. A committed but constrained Fly still counts as using Fly; the action stays spent and the runner reassesses. Explicit cancellation, unresolved reactions and manual damage retain their pause behavior. Own Fly usage is recorded per combat and round and cleared by prototype reset.

Targets on different elevations and scene levels can be observed and attacked by flyers when native 3D distance, reach, sight and line of effect permit. Reaction geometry uses the same vertical reach; level metadata alone does not suppress a reachable reaction involving a flyer. Hidden enemies use their known or remembered squares rather than live unseen coordinates.

## Eagle Dive

The Eagle's preferred complete activity is **Dive (actions one and two), then Fly back to hunting altitude (action three)**. Earlier turns gain height and a viable attack position. When this positive-value complete plan is ready and affordable, shared activity-goal selection keeps its first step ahead of atomic Fly/Beak substitutions, without relying on a one-time showcase bonus. Recovery, emergencies, legality, resource checks and affordable escape still take precedence. Without a ready pass the Eagle continues staging; another supported attack can remain a fallback when no Dive setup is available. The decision explanation displays the planned steps and their total action cost.

Dive requires two available actions, a straight flight of no more than twice current fly Speed, at least 10 feet of descent, a clear native route, a legal unoccupied airborne endpoint and a target in Talon reach there. It moves first, then calls the native Talon variant with the current MAP. A stopped activity keeps both actions spent. If its Strike never starts, its known-unused MAP reservation is released. Reactions along a Dive are checked on subdivisions of the same straight line with one shared reaction set.

Approach scoring considers attacks or a Dive using the remaining actions. After attacking, ascending can prepare another pass. The one-time ability showcase preference can make the first Dive more attractive. The AI does not learn target defenses or secret roll outcomes from this evaluation.

## Finish outside melee reach

The following overhead hunting policy applies to ground prey. [Airborne opponents](aerial-combat.md) use separate engagement and disengagement plans, so two mobile threats do not continually raise each other's cruise height. A faster Eagle can make a bounded altitude preparation, but a ready complete Dive opens an attack immediately. Current native melee exposure still matters after an aerial attack; withdrawal may climb or separate laterally without requiring a return above every flying opponent.

The shared **Aerial hunt** plan has gain-height, stalk, strike and recover phases. Opening movement builds a safe altitude before closing. A later attack pass needs enough actions for either Dive → Fly, or Fly → Strike → Fly, and a verified escape after the planned inbound path. Escape costs retain native terrain, diagonal history and the doubled cost of ascent. Forecasts for the next turn use a fresh movement history. The planner checks native walls, surfaces, level bounds, known occupied volumes and ordinary melee exposure before offering the pass. Known reaction exposure reduces its value; actual reactions still resolve normally and can interrupt it.

With no affordable complete pass, the flyer keeps a safe vantage, improves its approach at altitude, or uses Fly to hover and waits. Safe holding can finish the turn with unused actions. A planned Fly approach carries its intent into the following snapshot so the actor attacks before recovering, rather than flying down and immediately back up. Every action still reassesses the live position and opponents. An interrupted approach loses that intent and replans.

Shared flight evaluates ordinary melee exposure separately from reaction triggers, even for enemies without Reactive Strike or with spent reactions. The preferred overhead altitude is enemy elevation + body height + maximum prepared melee reach, rounded up to the grid, plus five feet of clearance. A ten-foot-tall enemy at elevation zero with ten-foot reach therefore suggests 25 feet. This clearance is a conservative positioning preference; native attack and reaction legality still use native 3D distance.

After attacking, and especially on the final action, escaping melee exposure competes with another Strike in the same ranking layer. A legal climb above reach is preferred; a blocked climb or low level ceiling can lead to a safe lateral retreat. Existing Fly usage does not disable this retreat. A known safe position can be revisited after an attack rather than rejected as circular movement. Safe flyers penalize approaches or two-action Dives that exhaust their actions in enemy reach. They still approach and attack when an action remains to pull away, and still use Fly to avoid falling.

Safety uses the current observer's target roster and remembered positions, native melee reaches, wall/surface line of effect and bounded native movement. It does not reveal unseen movement or secret check results. An actual movement-blocking ceiling surface can prevent the preferred altitude; a scene level’s top elevation alone does not. Ranged attacks and an enemy's future movement can still threaten a flyer outside current melee reach.

The arena Stadium's sole level previously ended at 20 feet. Its upper limit was raised to 60 feet for this flight test; floor elevation and platform surfaces remain as configured. The original level document is backed up in the workspace at `.scratch/stadium-flight-height-before.json`; restoring its `elevation.top` to 20 reverses the headroom change.

## Reach investigation, 5 November 2026

The retained 0.28.1 battle shows valid Strikes offered at ten-foot elevation, but after two approach moves the final action was spent escaping. Some fifteen-foot positions had platform-blocked sight or attack paths. A separate Dive endpoint bug sampled only offsets around the target's top-left cell; 0.28.2 enumerates the full Large footprint and its overhead cells.

A read-only native scene inspection compared AI and PF2e distance for twenty corner/altitude pairs. All agreed. At each outside corner of a ten-foot-tall, ground-level Large ogre, ten-foot elevation measures five feet; fifteen-foot elevation measures ten feet, outside the Eagle's five-foot melee reach. This includes the native three-axis diagonal cost. One of the ten-foot corner rays was blocked by a platform in the current scene. Distance, line of effect and the decision to reserve an escape are separate checks; the investigation did not justify changing native reach rules.

## Falling and limits

Ground creatures now evaluate whether closing horizontally could bring any known opponent into melee reach. If all known opponents remain above that reach and no supported ranged response is available, the shared **Lay low** plan replaces futile pursuit. It seeks protection, uses legal Hide, then values a Sneak that improves its estimated chance of becoming Undetected. Once that advantage is retained it holds; two quiet turns do not force another charge at an unreachable flyer. Landing, a reachable opponent or an available ranged response changes the assessment. This does not grant cover or concealment: open-ground actors hold without inventing a Hide opportunity. Actual observer-specific secret outcomes remain in the native stealth resolver, separate from planning beliefs.

Death, unconsciousness, paralysis, Prone or losing fly Speed can cause an enabled flying NPC to fall. A conscious eligible flyer with an available shared reaction can attempt native Acrobatics for Arrest a Fall, using DC 15 for ordinary conditions. A successful check prevents falling damage; it does not cancel the landing or remove an existing Prone condition. Landing uses the highest supporting surface beneath the token. Damage is native bludgeoning damage, with native resistance and immunity handling, and damage-taking landings apply Prone once.

Falling into an occupied space pauses for manual falling-on-a-creature resolution and final placement. Special winds, unusual flight maneuvers, unusually long falls and full volumetric spell areas need further teaching. Cross-level flight uses the shared physical geometry introduced in 0.31.0. The current automatic player movement/reaction prompt remains a ground-walking workflow; selecting native Fly receives the cost rules but does not add an automated PC flight action ledger. Flight and Dive reuse the ordinary native Strike, targeting flat-check, damage and Shield Block pipeline.
