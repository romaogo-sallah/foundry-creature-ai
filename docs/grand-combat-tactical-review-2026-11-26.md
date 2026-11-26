# Tactical review: six ogres against six kobold scouts

This review uses the deterministic `six-ogres-vs-six-kobolds` combat-lab run from version 0.52.0, seed 6606. It judges the decisions as PF2e combat decisions, then separates actor mistakes from limitations in the simulator and planner. The original run ended in round 8 with an ogre victory and three surviving ogres.

## Verdict

The ogres won because their side started with 354 HP against 180 HP and their greatclubs dealt 12 damage against 7-damage crossbows. They did not win because they made better decisions. The kobolds dealt 301 rolled damage against the ogres' 224, landed 34 of 49 Strikes against the ogres' 17 of 34, and removed roughly 289 effective ogre HP after overkill. Their loss came after the ogres survived that damage long enough to reach melee.

The battle nevertheless did not demonstrate good kobold skirmishing. The kobolds walked toward the ogres to improve range, never occupied a cover, fog, rubble or pit cell, never Hid or Sneaked, and only began withdrawing after melee contact. The ogres' approach was worse: two ogres spent their entire first turn taking three 5-foot Steps, four opened with javelins at penalties between -8 and -10, and three ogres contributed almost nothing before dying.

| Team | Starting HP | Strikes | Hits | Hit rate | Critical hits | Rolled damage | Movement | Other actions |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Ogres | 354 | 34 | 17 | 50% | 3 | 224 | 1,305 ft | 0 |
| Kobolds | 180 | 49 | 34 | 69% | 9 | 301 | 570 ft | 32 Reloads |

The kobolds produced 2.74 damage per spent action; the ogres produced 2.31. The result is therefore an attrition victory by the higher-HP force, rather than evidence that the winning AI played well.

## What the ogres did badly

**Ogre 1 and Ogre 3 failed to approach on round 1.** Both took three Steps and covered only 15 feet. They had no reaction threat to avoid and no immediate attack. The old "swarming" hypothesis gave every positive approach the same small value, after which the generic Step preference won ties. This was the clearest bad decision in the battle.

**Ogre 2 and Ogre 6 were wasted bodies.** Each died after three turns, dealt 0 damage, and spent early turns making poor javelin attacks. Ogre 2 opened at -10 and Ogre 6 at -8. Closing another 25 feet was worth much more than a remote chance to deal 10 damage.

**The whole front treated desperation throws as normal attacks.** Ogre 4 threw at -10, -8, -6 and -4 during the battle. Ogre 1 threw at -8; Ogre 5 and Ogre 6 threw at -8. A small positive expected value was allowed to cross the positive-action priority layer, so it beat a zero-valued third Stride even when the Stride was strategically decisive.

**Ogre 4 and Ogre 5 were the useful combatants.** Ogre 4 dealt 54 damage and defeated three kobolds; Ogre 5 dealt 68 and defeated one. Ogre 1 recovered from its first-turn failure and dealt 80, defeating two. Their successful behavior was simple: keep advancing, enter greatclub reach, and use the 12-damage weapon. Ogre 5's three-Strike turn and Ogre 4's three-Strike turn still wasted their third actions at MAP -10; a Step, Demoralize, defensive setup, or target-control action would normally have greater value if available.

**Their target coordination was accidental and lane-bound.** Ogres 1-3 fought the northern kobolds while Ogres 4-6 fought the southern group. That kept travel manageable, but the planner did not form a team objective, assign a front, or decide which target should be overwhelmed. Its "swarming" label mostly described the presence of allies, not an actual surround.

## What the kobolds did badly

**They shortened the ogres' approach for them.** Every kobold moved about 40-50 feet west on round 1 and still fired at -2. That improved the immediate shot, but it also removed nearly two Strides from the distance the melee force needed to cross. A skirmisher should compare the value of that shot with the value of making the ogres spend another turn approaching. The one-action evaluator did not price the opponent's saved movement.

**They ignored the battlefield.** No actor ended movement in a cover, obscuring, rubble or pit cell in the original run. Avoiding pits is correct, but twelve cover sources and six fog patches also failed to attract anyone. The battlefield picture consequently collapsed into two open firing lanes around the central ruins. The kobolds did not establish a protected firing line, force the ogres through a choke, or retreat through concealment.

**They waited too long to kite.** Kobold 4 withdrew in round 2 after taking 20 damage, but most of the line continued the shoot-reload cycle until the ogres were already in reach. Kobolds 3 and 5 only adopted avoiding behavior in round 7. At that point a 25-foot Stride could not reliably escape an ogre that had already reached them.

**Reload and melee hand use was tactically incoherent.** Kobolds 5 and 6 sometimes made a Shortsword Strike, Reloaded the crossbow, then made another Shortsword Strike. The lab does not model hands, Draw, or changing grip, and the planner valued Reload independently of whether the prepared crossbow could be used. Even if the hand sequence were legal for a particular loadout, preparing a weapon between two melee attacks while threatened did not improve that turn.

**Their focus fire was good within each lane, but incomplete across the team.** Kobolds 1-3 concentrated on Ogres 2, 3 and 1; Kobolds 5-6 concentrated on Ogres 6 and 5. They killed Ogres 2, 3 and 6 and made the ogre victory costly. Kobold 1 dealt 63 damage, Kobold 2 dealt 56, and Kobold 6 dealt 63. The north/south split prevented the six ranged attackers from deleting one ogre at a time before contact.

**The scouts never used their defining actions.** There was no Hide, Sneak, protected reposition, or off-guard setup. This is mainly a test-harness limitation: the scenario currently invokes the generic `basic-npc` candidate model for every actor. The `skulk` and `pack` flags influence abstract plan scores, but the production `kobold-scout` action generator is not running. The result should not be cited as proof that the real Foundry kobold profile uses stealth correctly.

## What the old planner got wrong

The most damaging issue was false swarming. In the original lab state, `swarmOpportunity` was true whenever an actor had any living ally anywhere on the map. Swarming consequently appeared in 149 of 212 decisions, including distant javelin attacks and crossbow Reloads. No target needed to be isolated, threatened by an ally, flankable, or reachable. The label was semantically false and suppressed more useful tactics.

The planner also lacked a real charge method. "Charge" existed as an abstract plan name and a small movement adjustment. It did not require a full Stride, retain a melee-primary role, or preserve the commitment over the third action. A weak ranged Strike could still beat continued movement.

The terrain was present in path legality but absent from strategic positioning. Cover affected a ray that crossed a cover cell, and pits affected route risk, but no shared battlefield assessment said that protection was nearby or that a ranged formation should occupy it. Small terrain islands outside the shortest route therefore remained visually interesting and tactically inert.

The battle also exposed missing formation concepts. Neither side recognized that it was spread across two lanes, that the opponent was clustered for an area effect, that losses had changed the force ratio, or that a ranged line was under close pressure. Those facts were either unavailable or buried inside local candidate arithmetic.

## Changes made from this review

Version 0.53.0 makes Charge an executable component. It generates only substantial, near-maximal Strides toward the selected engagement, prices terrain and reaction risk, retains the tactic for a healthy melee-primary actor facing a distant foe, and stops a backup ranged weapon from redefining a ranged skulk as a charger. Explicit `role` data in the saved scenarios distinguishes primary melee and ranged doctrine.

Swarming in the lab now requires an ally already threatening or flanking a candidate enemy. Merely having a teammate no longer creates a swarm opportunity. The lab's immediate-attack test also follows the production rule: a penalized ranged shot is not "useful now" when movement can improve it.

The decision trace now contains a visible battlefield-assessment layer before legality and tactic selection. Its reusable situation entries report:

- primary melee, ranged, caster, or hybrid role;
- enemy ranged composition and nearest distance band;
- nearby cover or concealment;
- current numbers and which side is outnumbered;
- heavy losses for either side;
- close pressure against a ranged role;
- excessive friendly spread;
- friendly and enemy clustering for area effects.

These are observer-safe planning facts. They use known enemies and live combat-roster information rather than secret stealth outcomes. Each entry records its threshold and measured value so future tactics can consume the same fact without reimplementing the calculation.

## Post-change control run

With the same scenario and seed, all six ogres now spent all three first-round actions on full Strides under Charge. No kobold selected Charge merely because it carried a shortsword. The ogres won in round 5 with all six alive, dealt 220 damage, and used 41 charge actions. Their ranged penalties fell to five attacks at -2 and none beyond -2; the original ogres had ten penalized attacks reaching -10.

That stronger result confirms that Charge works, but it also makes the next weakness more obvious. The kobolds still advance to improve range and do not maintain a defensive firing line. Improving ranged overwatch, cover occupation, group kiting, and hand-aware weapon transitions is more valuable now than making Charge even more aggressive.

Version 0.54.0 addresses the first part of that weakness. In the same saved battle, every kobold now selects Hiding as its opening plan, reaches a legal protected position, and makes its first attack from Hidden. Five of the six later execute generated kiting moves; the sixth is defeated before it gets a retreat turn. Those moves increase separation while retaining a usable firing lane. This validates the requested phase change without pretending that the kobolds' crossbow, reload, and short battlefield can overcome the ogres' HP advantage.

## Recommended next simulations

1. Add group-level retreat reservations so several kiters do not choose the same corridor or trap one another against a map edge.
2. Add a hold/overwatch policy for a firing line that already has protection and advantageous range.
3. Extend the lab's stealth resolver from opening Hide attacks to full Sneak checks and observer-specific results.
4. Add hand state and Draw/Stow/Reload legality before evaluating mixed sword-crossbow turns.
5. Add a 15-foot burst caster to both sides and verify that the formation signals change target and spacing decisions.
