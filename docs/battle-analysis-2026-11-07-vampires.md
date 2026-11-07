# Vampire encounter review — 7 November 2026

The Count stalled because the dormant flight component discarded the ordinary caster’s turn-completion policy. This is fixed in **0.41.1**. Its preceding movement choices also reveal a separate planning weakness; the patch fixes passing the turn without claiming to solve that broader scoring problem.

## Evidence and scope

The latest Arena encounter has one Guardian, one Mastermind, two Counts and six Ogre Bosses. It reused an existing combat tracker: the vampire fight is **rounds 9–10**, with 54 AI reports, not the older Dero/Kobold reports in rounds 1–8. The last active combatant is the stalled Count, round 10, turn index 5. Its first End Turn report was at 02:02 Kyiv time; retrying at 09:08 produced the same choice and position.

For clarity, **Count A** is token `zsFfklz7Ikd6Tn5e` (stalled); **Count B** is `VBFIb1ChziA56NDR` (cast Dominate). The review reads saved chat/decision records and current native state; it does not replay or change the fight. The browser inspection left the actor count at 159 and reported no module errors.

## 1. Confirmed completion bug: grounded Count cannot pass

Count A was healthy, 85/85 HP, with no active incapacitating conditions, one ordinary action left, no pending action reservation and automatic passing enabled. Its diagnostics reported 74 reachable destinations and no movement blockage. The final candidate list contained only End Turn, but the saved ledger remained `done: false`, `completionReason: null`.

Every true vampire receives the [flight component](../src/foundry/flight-runtime.mjs) so it can later use bat or mist form. While in vampire body, a Count has no flight state. The component nevertheless replaced `decide`, reranked candidates and supplied completion only for its flight/mist cases. It omitted the [caster driver’s](../src/foundry/spellcaster-adapter.mjs) ordinary `turnComplete` decision. The runner consequently preserved the remaining action and refused to auto-advance.

An isolated reproduction offered the same grounded Count only End Turn: the original driver returned `turnComplete: true`; adding the flight component changed it to false. This was not a reaction prompt, worker hang, failed movement or uncertain-action lock.

**Applied fix:** delegate to the ordinary driver whenever neither a flight state nor mist state exists. Existing aerial and mist decisions retain their own completion rules. Three regressions cover automatic passing, passing disabled, and preserving a pause for unresolved immobilization. The saved fight remains at the same turn; after reloading, Run turn can finish the Count’s preserved action budget without granting new actions.

## 2. Confirmed planning weakness: tiny Steps dominate meaningful preparation

Count A spent its first turn on Step → Hide → Step, then its next turn on Step → Step → End Turn. It spent five actions without attacking, casting, grabbing or drinking blood.

The first Step regained sight and had a defensible purpose. Later choices were much weaker: one scored **0.24**, entirely for protection; the next scored **0**, but ranked above End Turn because its movement layer was higher. That final Step had no follow-up activity, sight gain, defensive gain or escape benefit in its explanation. After it, the one visible Ogre was still 55 feet away from a 30-foot Dominate.

The [caster planner](../src/framework/caster-planning.mjs) allows a zero-value approach when it reduces nearest-enemy distance, while rejecting negative-value routes even when they could stage a later turn. Losing an estimated hiding advantage can make a full Stride look worse than a small Step. This needs a progress objective that compares distance to a *usable future activity*, protection and action costs. The 74 destinations do not prove that any particular Stride could immediately cast through the obstacles; that counterfactual needs a geometry-aware replay.

**Related classification defect:** [battle context](../src/foundry/behavior-runtime.mjs) treats any available spell as ranged/caster capability, and sets melee false whenever spells exist. Count A therefore received `ranged: true`, `melee: false`, `caster: true` solely from innate Dominate, despite having a held rapier and valid Claw. Hybrid creatures should retain their martial role and distinguish innate control from a sustained ranged damage plan. Count B’s successful Dominate casts show why the spell should remain an option, rather than be disabled to force melee.

These planning changes are recommendations, not part of the narrow 0.41.1 completion fix.

## 3. Vision of Death was a valid concealment failure

The Mastermind’s round-9 spell report says “0 target(s) resolved.” The preceding flat-check message records **3 against concealment DC 5**, so the targeted spell failed before its Will save. Actions and the preparation remained spent; this is not evidence of an empty-target casting bug.

The report is misleading, however: it should distinguish “targeting flat check failed” from immunity, target loss and an empty area. Keeping explicit outcome reasons would make this kind of investigation much quicker.

In round 10, the Mastermind moved into a Lightning Bolt lane, affected two hostile Ogres, rolled 26 damage once, and applied **26 and 13** for their respective failed/successful saves. No allied victim appears in that resolution. This was useful area targeting, although the log cannot establish that the position was globally optimal.

## 4. Threat estimates can mistake MAP for creature weakness

Saved observations estimated one Ogre’s level as **0 ±2**, while the native review identifies these Ogres as level 7. The [public attack observer](../src/foundry/spell-observations.mjs) currently takes the final roll’s `totalModifier`, then estimates level as `bonus - 10`. It does not normalize MAP, range or visible condition penalties before using that number as strength evidence.

This battle includes public hook attacks with a displayed base modifier of +19 but final roll modifiers +14, +9 and +7 after MAP/Prone. Treating a penalized attack as the creature’s best attack can distort Incapacitation and targeting estimates. The correction should use public modifier breakdowns and uncertainty, not read opponents’ actual sheets. This issue did not cause the Count’s completion failure, and this log does not establish a changed Dominate outcome from it.

## 5. Prone recovery deserves a longer forecast

The first dominated Ogre began round 10 Prone, then used Trip → Sweeping Hook → Strike → Strike without Standing. Stand was offered: it initially scored **6.6** against Trip **19.72**, then fell to **1.65** against a Strike **4.825**. Its attack cards correctly included the Prone penalty.

This is legal behavior, and genuine Reactive Strike risk can justify remaining Prone. The scoring nevertheless compares immediate attacks against a Stand estimate dominated by reaction cost and limited same-turn accuracy benefit. It should also compare the remaining sequence, defensive off-guard exposure and next-turn mobility. Automatically forcing Stand would be too crude. Sweeping Hook’s immediate reaction after Trip is not an extra ordinary action or a MAP bug.

## What worked and what remains untested

- Count B dominated one Ogre in round 9 and a second in round 10. The controlled Ogres attacked their former allies; the other Ogres attacking them was a valid alliance response. The second subject subsequently succeeded at its end-turn recovery save and returned to its original alliance.
- The Guardian readied its bow and made four shots across two turns. Its round-10 critical hit and two ordinary hits rolled **47 +17 +17 =81 damage**. Calling its bow-only behavior a failure would not fit this encounter’s positions or results.
- Haste and Wall of Fire appeared among logged alternatives. Haste’s early values were roughly 12–13 versus the selected offensive plan; absence of a buff over two turns is not proof that buffing never works. Longer-horizon group benefit remains a tuning opportunity, not a confirmed execution failure.
- All vampires are still at full HP, no vampire entered melee, and none reached 0 HP. This fight therefore provides no live coverage of Grab, Drink Blood, Mist Escape, Fire Shield, or lingering-fire execution. Their earlier unit/native checks should not be confused with battle coverage.
- Both Counts and all six Ogres share display names. Reports have internal token IDs, but visible chat obscures which Count stalled and which Ogre changed sides. Stable per-token labels would improve player comprehension and debugging.

Priority after the completion fix: hybrid role/progress planning, then public threat normalization and recovery forecasts; improve report reasons and labels alongside those changes. Verification and message references are in [the review record](../research/vampire-battle-review-2026-11-07.json).
