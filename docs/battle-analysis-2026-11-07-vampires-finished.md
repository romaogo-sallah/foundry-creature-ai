# Completed vampire encounter review - 2026-11-07

The vampires defeated all six Ogres, but the final spell left an unresolved AI action. Patch **0.41.2** fixes that death-status call and makes failed Grab reports explicit. Other tactical weaknesses below remain open.

## Evidence and scope

Arena combat `qOeTcZUzcQbBU7y3` reused an older tracker: this review includes only vampire rounds **9-14**, with **141 AI action reports** and 357 messages from the encounter window. Participants were two Counts, one Guardian, one Mastermind and six Ogre Bosses. All six Ogres finished at 0 HP; all four vampires survived. Earlier Dero/Kobold tracker rounds are excluded. Chat, damage messages and saved token state were read without replaying or changing the encounter.

Foundry switched to Prey for Death during verification. The completed Arena snapshot remains the evidence source; this patch does not repair or resume the old saved action automatically.

## Confirmed error: lethal Vision of Death

The last Mastermind cast killed the final Ogre, but its ledger remained `uncertain: true`, `done: false`, with one action left. There was no matching action-completion report.

After native damage, our resolver called `increaseCondition('dead')`. PF2e's ConditionManager has no Dead condition: death is a status effect. Native damage had already marked the victim dead, so the redundant condition call failed after dealing damage. The Drained-5 kill in Drink Blood had the same error, although it did not occur in this fight.

The shared [death helper](../src/foundry/death-status.mjs) now uses native `toggleStatusEffect('dead', {active: true, overlay: true})`, returns immediately when already dead, and avoids applying fear conditions to a corpse. The reserved spell can finish and the ordinary battle-over check can stop automation. Drink Blood uses the same helper.

Verification: **1,112 tests passed**, including lethal Vision through the real TurnRunner, nonlethal fear, Drained-5 death and an explicit failed-Grab report. Local Foundry 14.369 source confirms the status API boundary. A detached native browser check was attempted but not completed; its first attempt exposed a diagnostic interception mismatch (native status creation uses ActiveEffect.create directly). Before a corrected check could run, the active world changed. No live replay was performed and no diagnostic actors were created.

## Mastermind spell coverage: 16 of 21

These are reusable taught spell components, not evidence that every spell was cast in this encounter.

| Taught | Main role |
| --- | --- |
| Dominate | Control; caster-specific immunity and recovery saves |
| Fire Shield | Protection and retaliation |
| Vision of Death | Will damage/fear; death at 0 HP |
| Wall of Fire | Lingering area denial/damage |
| Fireball | Burst damage with friendly-fire assessment |
| Haste | Group action economy |
| Lightning Bolt | Line damage with friendly-fire assessment |
| Blur | Defensive concealment |
| Dispel Magic | Supported-effect counteracting |
| Floating Flame | Sustained mobile damage |
| Invisibility | Defensive/offensive setup |
| Stupefy | Anti-caster control |
| Dizzying Colors | Short-range control |
| Enfeeble | Strength-attack suppression |
| Fleet Step | Mobility |
| Frostbite | Fortitude cantrip damage |

**Manual/untaught (5):** Detect Magic, Illusory Disguise, Message, Sigil, Telekinetic Hand. Illusory Disguise is not prepared in the supplied export. An additional prepared rank-4 slot points to a missing spell item; it is not a 22nd known spell and cannot be cast from this export.

The Mastermind attempted **four casts of three distinct spells**:

| Round | Cast | Result |
| --- | --- | --- |
| 9 | Vision of Death | Concealment flat check failed; spending the cast was legitimate. |
| 10 | Lightning Bolt | Two hostile Ogres took 26 and 13 damage. |
| 11 | Fireball | Five hostile Ogres: 0, 29, 29, 58 and 58 damage (174 total resolved damage, not necessarily 174 HP removed). No friendly targets. |
| 14 | Vision of Death | Drain Bonded Item recast; 24 damage killed the final Ogre, then the death-condition call failed. |

The two Dominate casts were made by a Count, not the Mastermind. The Mastermind's Haste and other available options were not exhausted. This battle provides no live coverage of Wall of Fire, Floating Flame or Fire Shield, and no vampire needed Mist Escape.

## Other behavior findings

1. **The prior Count deadlock was fixed.** After the 0.41.1 patch, its one-action End Turn completed and later rounds proceeded normally. That does not resolve the smaller positioning/scoring issues in the [first review](battle-analysis-2026-11-07-vampires.md).
2. **No Drink Blood was expected after these Grabs.** All three attempts failed: Count critical failure, Mastermind failure, other Count failure. No held victim was established. The critical failure's counter left the Count Prone; it subsequently stood. Patch 0.41.2 reports failure explicitly instead of merely saying Athletics resolved.
3. **Retreat objectives conflict with offensive movement.** At round 12, one Ogre had 4/130 HP and selected Avoiding throughout its turn. It used Bellow, spent its restricted movement moving closer to improve throwing range, then spent its other movement retreating. Its health did not change between those choices. Support/offensive providers need to respect the selected retreat objective; additive action bonuses currently permit contradictory movement. This remains open.
4. **Hybrid casters still need better spell/melee follow-up comparison.** The Mastermind used Step -> Claw -> Claw in round 12 and Claw -> failed Grab -> Claw in round 13 while other spells remained available. Close-range attacks can be sensible, but these choices deserve a counterfactual spell/retreat evaluation. Code inspection also found that caster forecasts reduce remaining actions but reuse Strike on-hit setup values calculated for the original budget. A future last-action Claw can therefore retain value for a Grab/Blood chain it cannot afford. Actual execution rebuilds the next snapshot and does not grant free actions. This is a planning defect candidate, not a measured explanation of every Claw choice.
5. **Good group spell targeting.** Fireball selected five hostile Ogres, excluding the controlled ally and vampires. Domination subjects attacked former allies and received the configured recovery saves. The finishing Vision used the bonded recast resource.

The next tactical work should keep retreat movement consistent and recompute affordable follow-up value inside caster forecasts. It should preserve uncertainty about secret saves rather than giving planners access to hidden results.

Machine-readable record: [completed review](../research/vampire-finished-review-2026-11-07.json). Supplied-statblock boundaries: [vampires](vampires.md).
