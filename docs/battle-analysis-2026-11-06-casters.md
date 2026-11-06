# Caster battle review: 0.40.0

The shared caster framework made a visible improvement, but this fight exposed a serious healing integration bug and several scoring problems. This is an analysis of the completed encounter; no combat state or implementation was changed.

The Arena encounter `qOeTcZUzcQbBU7y3` ran from **16:40:23 to 16:55:44 UTC on 6 November 2026**. All **168 decision reports** identify runtime **0.40.0**. Two level-5 Dero Magisters and four level-2 Kobold Scouts defeated three level-2 Ogres and one level-7 Ogre Boss in round 8. All six members of the caster/scout side survived. The final automatic victory stop was appropriate.

The review reads a separate copy of Arena's saved databases while another world is active. Chat rolls, applied-damage undo records, decision scores and final token overrides were compared. The sanitized counts are in [the verification record](../research/caster-battle-analysis-2026-11-06.json). Full world data stays private in `.scratch/`.

## Demonstrated progress

Both Deros cast in every one of their eight turns. They made **17 casts using six distinct spells**, spending 36 actions on spells, nine on movement, one on a weapon Strike and one on Sustain. The last remaining action was preserved when the battle ended. There was no empty caster turn or unresolved-action stop in the retained decision reports.

| Spell | Casts | Actions | Recorded result |
| --- | ---: | ---: | --- |
| Force Barrage | 5 | 12 | 42 damage rolled; 36 enemy HP actually removed after overkill |
| Blindness | 4 | 8 | Three successful saves and one critical success; no lasting blindness; one repeat was during temporary immunity |
| Vampiric Feast | 2 | 4 | 36 enemy damage; temporary HP pools of 14 and 4 |
| Soothe | 2 | 4 | Incorrectly removed 6 and 8 friendly HP |
| Laughing Fit | 2 | 4 | Both saves failed; duplicate control on the same boss |
| Void Warp | 2 | 4 | 18 enemy damage; second cast finished the boss |

The spells removed **90 of the opponents' 235 starting HP**, roughly 38%. This counts actual HP changes rather than rolled overkill. Vampiric Feast's 18 temporary HP were subsequently consumed by enemy attacks. The two Deros finished at 25 and 36 HP out of 65 each.

The action planning is observable in play: Dero A moved and used a two-action Force Barrage in round 1, safely Stepped into Vampiric Feast in round 3, used a three-action Force Barrage in round 4, and combined Laughing Fit with a one-action Barrage in round 7. In round 8 it cast Void Warp and Sustained. Dero B selected an injured ally for healing rather than only considering itself; the execution was broken.

Native slot accounting also matches the cast sequence. A finished with rank-1/2/3 slots **0/3/0**, B with **1/3/0**, from prototype pools of **4/4/3**. Both spent their three rank-3 slots on two Blindness casts and one Vampiric Feast. Slot scarcity is being respected, although the allocation needs better scoring.

## Confirmed defects

**1. Soothe damages its recipient.** In round 4, B's Soothe removed six actual HP from A; in round 5, A's self-cast removed another eight. These are native `appliedDamage` records with `isHealing: false` and positive HP reductions, not just misleading chat labels. Soothe should restore the rolled HP and provide its mental-defense bonus. [Soothe rules](https://2e.aonprd.com/Spells.aspx?ID=1678).

The cause is `spell-outcomes.mjs` passing a positive DamageRoll with `multiplier: -1` to `ActorPF2e.applyDamage`. Installed PF2e 8.6.1's native method does not accept that multiplier argument; its healing branch requires negative damage. The modular-caster fixture explicitly implements the unsupported argument, so its healing test passed while the real workflow damaged the target. Earlier native verification checked resource consumption, effect preparation and previews, but did not execute this healing application. The fix needs an API-faithful test and a detached native execution check. Historical HP must not be silently rewritten.

**2. An ally's previous Blindness does not prevent another wasted casting.** B cast Blindness on the boss in round 5; the critical success still granted temporary immunity. A spent its last rank-3 slot on the same spell in round 6. The final boss still has B's immunity marker, and the resolver refuses to add A's effect, but the resource and actions have already been spent and another save was rolled. The generic success note conceals that the second cast achieved nothing. Blindness grants temporary immunity for one minute regardless of the save outcome. [Blindness rules](https://2e.aonprd.com/Spells.aspx?ID=1453).

This can be avoided without reading secret saves: an observed allied Blindness casting implies the immunity window regardless of its result. Track witnessed casts and their timing across casters; suppress known-immune choices before commitment and explain any later immunity-based failure accurately.

**3. Incapacitation is executed natively but absent from valuation.** The boss is level 7; rank-3 Blindness has an Incapacitation threshold of level 6. Its round-6 total of 22 against DC 24 was therefore upgraded from failure to success by native PF2e. The ranking still valued Blindness at **12.835**, ahead of Laughing Fit at **11.305**, using ordinary unadjusted benchmark-save probabilities. [Incapacitation rules](https://2e.aonprd.com/Traits.aspx?ID=631).

The planner should estimate that adjustment using permitted knowledge of relative threat, with uncertainty when strength is unknown. It must not read actual hidden saves or unknown creature levels. The two normal Ogre casts were not automatically mistakes merely because their rolls succeeded: brief blindness still offered allied attacks an opening. However, a success lasting only until the target's next start should be valued by initiative timing, rather than receiving the same broad control horizon as a lasting failure.

**4. The two casters duplicate control.** A applied Laughing Fit in round 7 before the boss's turn, reducing that turn to two actions. B applied it again later in the same round. Both failures granted Slowed 1 and reaction denial; the boss's round-8 ledger still records only one action lost. B's second cast supplied a backup source, not another immediate action denied. Current suppression examines each caster's own attempts and Sustains, without estimating allied control already in place. Value witnessed allied attempts probabilistically and observable effects when known; do not reveal secret results to the planner.

**5. Tactical bonuses are applied twice.** The recorded score terms repeatedly contain two copies of the same adjustment. For example, B's opening Barrage receives `Press the attack +0.7` and `Exploit a damage opening +0.75` twice. `attachBehaviorSystem` adjusts `adapter.candidates`, then `chooseTacticalAction` runs `BehaviorSystem.decide`, which applies the adjustments again. This doubles the tactic preference and can distort close choices. Apply the policy adjustment once; this fight alone does not prove which selections would change afterward.

## Additional opportunities and limits

Force Barrage showed its variable action costs working, but A's three-action cast in round 4 rolled ten damage into an Ogre with four HP remaining. That is an opportunity for finishing/overkill heuristics and split-target Barrage, using visible injury estimates rather than exact enemy HP. It is not grounds to assume that the caster knew the exact four-HP value.

Phantom Pain, Grim Tendrils, Daze and Forbidding Ward appeared among logged alternatives but never won. Telekinetic Maneuver and Paranoia were absent from the retained ranked options. The report contains a shortlist, not every generated candidate, so absence there does not prove a legality or generation bug. Seven of the thirteen taught spells therefore received no execution coverage in this fight. Do not force variety by choosing an inferior spell solely to exercise it.

The Daze catalog also reports rank 1 while Void Warp reports rank 3 on these level-5 casters. Its innate cantrip binding/heightening deserves a separate native audit before judging Daze's competitiveness. The saved catalog establishes the discrepancy, but this review did not execute Daze or establish its underlying cause.

The practical next order is **healing execution and its native test**, **shared immunity/control knowledge**, **Incapacitation and initiative-aware control value**, then **single-application tactical scoring**. After those fixes, another encounter can assess spell diversity and resource allocation. Winning this battle is useful evidence of improved engagement and action planning, but it does not validate every spell component or establish an optimal strategy across different encounters.
