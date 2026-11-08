# Lich versus vampires - combat review, 8 November 2026

The fight exposed rule and planning defects beyond the performance problem. The most serious are repeated Frightful Presence saves, an invalid Dispel Magic retry loop, and a Count's indefinite defensive waiting. Mist Escape also failed to produce any escape movement.

## Evidence and limits

Arena combat `w2gVjB2d2sXRz7mL` reached round 12, turn 3. Participants were one Lich, two Counts, one Guardian and one Mastermind. The review covers **109 AI reports** and **377 messages**, from 11:49:36 to 12:02:10 UTC, plus saved actor/token/combat state. Every AI report identifies **0.42.0**. This is not a combat test of the 0.43.0 worker backend.

Foundry was shut down. The review read copies of its Arena LevelDB collections and the prior native world snapshot; it did not open the original databases for writing, restart Foundry, advance combat, reset tokens or create diagnostic actors. Raw databases, world data and chat remain in ignored `.scratch/` storage. Only the selected findings and evidence references are published.

The encounter did **not** record a completed victory. The Lich was stalled with three actions, 34 saved HP and surviving opposing vampires remaining. The 0.43.0 responsiveness preview's zero eligible targets was an observer/target-eligibility result, not evidence that this battle had been won. The relevant rules and scoring defects below still exist in 0.43.0; moving their calculation into a worker does not repair their logic.

## 1. Frightful Presence immunity is not being retrieved

**Confirmed rule/storage bug; highest priority.** Chat contains **56 Frightful Presence saves**: Mastermind 27, Guardian 21, surviving Count 8. Several saves for the same target occurred less than a second apart.

The [rule grants one minute of immunity after any save result](https://2e.aonprd.com/MonsterAbilities.aspx?ID=64). The code in [monster-abilities.mjs](../src/foundry/monster-abilities.mjs) indexes `frightfulImmunities` with the source token's dotted UUID. Foundry expands that key while persisting the update. The captured flag is nested as `Scene -> scene ID -> Token -> token ID -> expiry`; the subsequent lookup uses the entire UUID as one flat key and misses it. Movement and turn callbacks then request more saves and can repeatedly refresh Frightened.

Example: Mastermind messages `a08NbMJHXNLQVRyx`, `HN0Z0CAWS2FRJUcj`, `MRbHzjQjfCUUswho` and `k4pnODMZAzEkvQxC` span only 694 ms. This is a rules failure that also adds rolls, condition work and delay. It can distort the entire match, so conclusions about relative creature strength are unreliable.

Fix direction: use a dot-free stable source key or a deliberately nested lookup; migrate existing saved keys; serialize simultaneous checks for a source/target pair. Test through Foundry-style update expansion, rather than a Map-based mock alone.

## 2. Dispel Magic repeatedly selects a target execution rejects

**Confirmed deadlock and planner/executor mismatch.** In round 12 the Lich selected Dispel Magic on the Guardian's Haste effect **16 times in 73.666 seconds**. Every report says the target or attack path changed and preserves all three actions. The saved ledger remains `done: false`, `uncertain: false`, with three actions. The action loop has a per-run iteration limit; retrying can choose the same invalid candidate again.

The Guardian had already entered Mist Escape and had 0 saved HP. [visibleDispelTargets](../src/foundry/counteract-spells.mjs) offers visible supported effects without reconciling the subject's current target eligibility. [Spell execution](../src/foundry/spellcasting.mjs) resolves that enemy through `liveSpellTarget`/`liveTarget`, whose ordinary targeting rejects a 0-HP creature. The Haste candidate therefore stays attractive while execution always skips it. The skip branch restores the reservation and does not suppress that unchanged candidate.

Evidence: reports `ZGKqgMCW0969ybJg` through `YMjR3BS25mlFvwsu`, effect `3qSn5Spg0Ykdmr0j` on Guardian `m7a0nArXQAMqT8zN`.

Fix direction: give spell-effect targeting its own consistent legality contract; avoid spending effort removing a damage-immune escaping mist's obsolete Haste; reject or temporarily suppress unchanged skipped candidates so another legal action can be chosen. Do not spend a slot just to break the loop.

## 3. Several spells were selected against ineligible or immune undead

**Confirmed ineffective casts and incomplete eligibility/knowledge handling.**

| Caster | Round | Cast | Recorded result |
| --- | --- | --- | --- |
| Mastermind | 1 | Vision of Death | Zero targets resolved against the Lich |
| Mastermind | 2 | Vision of Death, bonded recast | Zero targets resolved against the same Lich |
| Lich | 3 | Toxic Cloud | No Toxic Cloud saves/damage rolls in the encounter |
| Lich | 5 | Vampiric Exsanguination | Zero targets resolved against vampires |
| Lich | 7 | Vampiric Feast | Explicitly reported that it cannot affect the Guardian |

[Vision of Death](https://2e.aonprd.com/Spells.aspx?ID=1742), [Vampiric Feast](https://2e.aonprd.com/Spells.aspx?ID=1736) and [Vampiric Exsanguination](https://2e.aonprd.com/Spells.aspx?ID=1735) require or damage living creatures. The supplied opponents are undead. The Lich and vampires also have death-effect immunity. Toxic Cloud's damage component cannot help against the nonliving vampires, although its concealment can still have defensive value; the whole cast is not necessarily devoid of utility.

Execution applies eligibility/immunity checks that the ranking does not adequately represent. `knownSpellImmunity` currently concerns witnessed temporary spell immunity; it does not supply general creature eligibility or appropriately learned damage/effect immunity. Execution can skip an immune subject before recording an observation, so the same ineffective spell remains attractive on the next turn. The Lich's void Hand Strike in round 10 likewise produced a public no-damage result on the Mastermind.

Fix direction: separate legal target categories from uncertain defenses; carry permitted knowledge of living/nonliving status, and learn only from actually observable outcomes. An unknown secret save succeeding is not proof of immunity. Do not solve this by exposing every enemy's hidden immunities or actual save modifiers to the planner.

## 4. One Count never attacked and passed eight entire turns

**Confirmed tactical failure with a supported code cause.** Count `VBFIb1ChziA56NDR` made no Strike or spell cast in its twelve rounds. It ended rounds **3, 4, 6, 7, 8, 9, 10 and 11** with all three actions. Those reports show a visible Lich 60-75 feet away, 34-78 reachable destinations, no movement block and no broken morale. Including the two unused actions in round 1, it held **26 actions** across the fight.

Its single innate Dominate is enough to attach the caster planner and Defensive posture. [waitingCaster](../src/framework/caster-defense.mjs) suppresses ordinary closing movement against an apparently melee opponent outside engagement range. It expects a two-turn patience counter. The generic [spellcaster adapter](../src/foundry/spellcaster-adapter.mjs) does not populate or persist that counter; the Pyro has a separate implementation that does. The generic counter therefore remains zero. [Apparent combat roles](../src/foundry/caster-target-knowledge.mjs) also classify the Lich from its Hand weapon; the existing observation hook learns public Strike strength, not a ranged-caster role from witnessed spellcasting.

The Count thus keeps waiting for a dangerous ranged caster to approach as if it were a melee pursuer. This is stronger evidence than merely disliking a conservative move: it had a visible opponent and legal movement over repeated whole turns.

Fix direction: shared bounded waiting memory; actual melee/mobility progression for hybrids with one innate spell; update apparent role from witnessed casting; after a quiet setup interval, choose a useful approach or explicit encounter objective.

## 5. Mist Escape transformed vampires but did not move them out

**Confirmed behavior failure; precise runtime cause remains unproven.** The first Count entered Mist Escape after the second Chain Lightning, and the Guardian did so after round 8 damage. Both have owned mist effects and `escape: true`, `escaped: false`. Neither produced a `mistFly` or `escapeScene` AI report. Their ledgers remain at their last body turns, rounds 2 and 7, although combatant start-turn records advanced into later rounds. Neither reached the scene border.

The [ability explicitly permits movement at 0 HP](https://2e.aonprd.com/Monsters.aspx?ID=3226). The module's incapacitation helper already exempts moving mist, so it would be inaccurate to claim that a simple missing 0-HP exception is the proven cause. The native PF2e start-turn method still emits its hook after effect processing. A reproduction must inspect automatic start, pending reactions, native mist preparation, path construction and errors before the first action report. The missing client-console trace prevents identifying the exact failed call from chat alone.

Fix direction: reproduce from captured native mist state and make an escaping creature's pending movement/turn completion observable. Validate an actual 0-HP native turn, not only a manually constructed mist-state unit test.

## 6. The Guardian's Long Jump aborted after its run-up reached takeoff

**Confirmed interrupted activity; animation timing is the leading hypothesis.** Round 2 report `mgVAXFuwtGvzxxKc` spends two actions and says its run-up stopped. The next report starts the Guardian at `(1890, 1330)`, exactly the intended takeoff square; no Long Jump check or jump followed.

[executePitAction](../src/foundry/pit-actions.mjs) awaits `document.move` and immediately compares document coordinates. It does not await the movement animation/final position before that comparison, unlike the ordinary movement resolver. This can classify an animated intermediate position as a failed run-up. A movement constraint or temporary condition is not fully excluded by the retained messages, so the exact cause needs a native animation-aware reproduction.

Fix direction: await settled movement, measure the actual run-up and recheck conditions/route before deciding whether the jump can proceed. Preserve real costs and genuine interruption; do not grant a jump after a stopped approach.

## Mechanics that did show progress

The Lich used Chain Lightning twice, including its separate Soul Cage resource, and Howling Blizzard twice on groups. The Mastermind cast Wall of Fire, Lightning Bolt, Fireball and Haste; the Guardian used Haste's restricted action. The Lich successfully Counterspelled Blur. A later successful Counterspell check against Dominate was followed by the Mastermind's Steady Spellcasting protection, so it is not by itself evidence of a counteract failure.

Priority: repair Frightful Presence immunity and invalid-candidate retry loops first, then living-target/observable-immunity handling, hybrid waiting and mist escape. Verify the jump's movement lifecycle alongside those fixes. The repeated fear saves and ineffective spells make this fight unsuitable as a balance benchmark.

This commit records findings only. No gameplay code or saved encounter state is changed. Machine-readable evidence: [review record](../research/lich-vampire-review-2026-11-08.json).
