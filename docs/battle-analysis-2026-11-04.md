# Ogre and kobold battle review — 4 November 2026

## Follow-up: caster policy 0.24.0

Applied the [caster investigation](dawnsbury-caster-ai-findings.md) to the reviewed Pyro issues: action-budget forecasts compare casting with retreat, persistent Grease costs include prone allies, and movement control distinguishes apparent melee/ranged roles. Regression scenarios verify Stand → cone and cone → retreat with native-shaped documents, as well as MAP, role memory and action/slot budgets. These are implementation checks, not a rerun of either battle or evidence of a changed win rate. See [current behavior and limits](goblin-pyro-foundry.md).

## Latest two fights: first Goblin Pyro review, runtime 0.23.2

Read-only review of combats `vKXy1tCuSnSd8656` and `tYJe0aKNQcuA3j3z`. Both used running code **0.23.2**. Native messages and structured decision records were retrieved through the dedicated assistant GM account, which was logged out afterward. This review changes neither the algorithm nor actors, equipment, resources, scenes or combat state.

Private evidence: `.scratch/pyro-review-evidence-2026-11-04.json`; parsed decisions, native attacks/defenses, applied HP deltas and summary counts: `.scratch/pyro-last-two-fights-analysis.json`. The reproducible parser is `.scratch/analyze-pyro-battles.cjs`. Token suffixes below identify copies with identical display names.

### Results and important comparison limits

| Recorded measure | Pyros vs scouts | Pyros vs wolves |
| --- | --- | --- |
| Combat | `vKXy1tCuSnSd8656` | `tYJe0aKNQcuA3j3z` |
| Forces | Four level-1 pyros vs four **Elite level-2** scouts | Four level-1 pyros vs four level-1 wolves |
| AI decision reports | 35 | 61 |
| Fight ended | Round 3; scouts won | Round 4; wolves won |
| Pyro turns that reached the chooser | 4 | 9 |
| Those turns without a spell | 0 | 2 |
| Grease casts | 2 | 2 |
| Breathe Fire casts | 0 | 1 |
| Ignition casts | 2 | 3 |
| Tangle Vine casts | 0 | 1 |
| Rank-1 slots spent | 2 | 3 |
| Applied opposing HP lost | 7 | 36 |

These are different matchups, not a controlled comparison of spell policies. Native scout attack contexts confirm **level 2, 26 HP, crossbow +11**, and the actor has the Elite adjustment. Its Reflex +11 also appears in the actual Grease saves. All four wolves acted before the first pyro in their opening round, so the casters had to recover from immediate melee pressure. First-fight reports also include an initial scout End Turn with no opposing-alliance targets; that startup targeting configuration was corrected before its later actions. No console-error history is retained in these chat records.

Applied damage totals come from `flags.pf2e.appliedDamage.updates`, not simply the damage-roll total, which can include overkill. Those update values are HP deltas for undo, not the actor's earlier HP. The second fight's final scene corroborates the 36 damage: surviving wolves have **6, 17, 20 and 17 HP**, from a 24-HP baseline each. All four pyros are at 0 HP. Their remaining rank-1 slots are **2, 2, 3 and 2**: **nine unused slots**, including one caster that never spent a slot.

### Good spell decisions and working mechanics

**The three-target Breathe Fire was the best cast.** Pyro `9LPi`, round 1, selected a cone containing wolves `PjM5`, `JbZS` and `prGY`, with no planned ally in the area. The native shared damage roll was 9. A critical failure, critical success and success produced **18, 0 and 4 applied damage**, respectively: **22 HP total**. The pyro then used its remaining action to retreat. Messages: decision `nGxQF37vdaFUh05t`, damage roll `ylf09VjVooexPJWz`, application messages `YiC3GXXH9GDWFH6J` and `DUAGESNRVQONiEaY`.

**Ignition worked as a ranged fallback.** Against scouts it made two attempts, missing once and dealing 7 damage once; both targeted the same scout. Against wolves it made three attempts: one critical hit for 6 immediate damage plus persistent fire, one miss, and one hit for 7. The persistent condition later dealt 1 damage. This accounts for the remaining **14 HP** beyond Breathe Fire in the wolf fight. The logs show the native persistent condition rather than an extra manually invented damage total.

**Tangle Vine had a real control effect.** Pyro `OBge` hit wolf `JbZS` in round 2. That wolf spent an ordinary action on Escape in round 3, using the recorded **DC 16** without a source/DC dialog. Its critical success also granted the legal free 5-foot Escape movement. This was a reasonable control attempt, although the critical Escape reduced its positional benefit. Decision `dBn8BLFDJkWMH8ve`; Escape roll `vzvzZAO15yS0jMzf`; Escape/free-move reports `5EbBeAW4nLKoJl1o` and `0ndW5iSdKTGQaPdw`.

**Goblin Scuttle was used.** All four final pyro actor deltas contain a confirmed, spent `goblin-scuttle` reaction from this combat's first round. The logs do not record every Scuttle destination as a separate AI decision, so this proves use of the reaction, not that each Step was the best possible Step.

### Problem 1: a confirmed Grease friendly-fire scoring hole

Pyro `KtAU` placed its first Grease over **three wolves and allied pyro `rbl6`** in round 1. Its recorded area includes `rbl6` as a bystander, yet **Friendly fire and bystander risk = 0**. That ally was already prone. The source explains the zero: `spellAreaValue()` returns zero for a prone creature, including when evaluating an ally. This correctly avoids valuing a second initial knockdown, but incorrectly ignores the continuing cost of trapping that ally in slippery ground.

The consequence is visible: `rbl6` stood, attempted to retreat, **failed Balance and lost that movement action**, then used its remaining action to move. It cast no spell that turn. Grease did not cause the original prone condition, and the log cannot prove that removing Grease alone would have changed the later retreat preference. It does prove an avoidable allied movement failure that the caster had scored as cost-free.

Evidence: Grease `F9rs2hjJvwef8TkJ`; Stand `JiSquEeT83FCkDrA`; Balance failure `fwlUrdHDmDnJRQ7h`; failed Stride `Ip1WeUMxjnoFi0aO`; final movement `CO6vFxa2W3OqHcHs`.

**Next correction:** separate the one-time fall benefit from persistent terrain/off-guard effects. An already-prone ally must still carry a mobility and escape-route penalty. The same calculation should distinguish a harmless patch away from allies from one that cuts off their retreat.

### Problem 2: retreat can discard an available two-action spell

Pyro `KtAU`, round 2, used **Stand → Stride → End Turn**, leaving one unused action. Immediately after Stand, a two-target Breathe Fire remained available at **8.6**, while retreat scored **13**. Spending that next action moving made every two-action spell unavailable. This was not a failed check or a shortage of spell slots.

Pyro `OBge`, round 2, had a two-target Breathe Fire available at **8.6**. It instead chose a retreat worth **16**, then cast Tangle Vine from the new position. Tangle Vine was useful, but the comparison shows that the planner strongly favored distance over the available burst opportunity.

The source uses a fixed 25-foot pressure target and **0.65 value per foot** of improvement. Escaping from 5 feet to 25 feet alone can therefore contribute **13**, more than a two-target cone. It neither forecasts the opponent's next turn nor compares complete orders such as **Stand → Cast** versus **Stand → move → no cast**. Casting and movement use different immediate horizons, and the movement forecast suppresses showcase bonuses that the subsequent real cast can receive.

Evidence: `VZdu4SW00lq8niTa`, `3TyJ5EmwtoHjb689`, `zAyK0pvqcXpPlriP`; alternative retreat `C8VCoetNKwrzRjvS`.

**Next correction:** compare complete remaining-turn sequences, including action loss, cast-before-retreat versus retreat-before-cast, and the cost of leaving a two-action cast unaffordable. Defensive positioning should consider known reach, pursuit, firing lanes, terrain and escape space rather than only distance. This should use the shared planning foundations already developed for scouts.

### Problem 3: Grease is valued too similarly against archers and melee pursuers

Against the Elite scouts, the first Grease covered three enemies and the second covered two. **All five initial checks succeeded** (four successes and one critical success). The retained enemy movement checks also all succeeded. With Reflex +11 against DC 16, avoiding an initial fall is an 80% chance; five successful initial defenses are therefore not evidence of a resolution bug. The AI did not have permission to use those hidden numerical modifiers for its decisions.

The spell was not entirely without effect: the zones still supplied off-guard and movement costs, and the subsequent Ignition attacks targeted an AC reduced to 16. However, Grease does not stop a stationary scout from firing or reloading. Its persistent movement control is generally less valuable against a creature already operating at range than against a pursuer trying to cross a choke point.

In the wolf fight, the five initial Grease checks produced **one failure**, three successes and one critical success. The five retained wolf Balance checks all succeeded or critically succeeded. The spell did make one wolf prone and affected movement, but it also caused the allied failed Balance described above. This is a mixed result, not proof that every Grease choice was wrong.

**Next correction:** value what the zone prevents or enables: blocking an approach, breaking a firing position, protecting an ally, exposing a useful target, or cutting a retreat. Target role should come from known equipment/actions, observed behavior or Recall Knowledge. Do not fix the estimator by reading actual hidden saves or secret roll results.

### Problem 4: resource conservation is insensitive to a short remaining lifetime

The wolf fight ended with nine of the twelve rank-1 slots unused. Preserving slots is sensible in a long fight; it is less useful when a 15-HP caster is likely to be removed within a round or two. The current flat slot cost does not change with incoming pressure, remaining HP or an opportunity to catch multiple opponents before they spread out.

This does not mean every unused slot represents an additional legal Breathe Fire opportunity. Some casters had no useful cone in their actual position, and several died before another turn. The stronger evidence is the recorded multi-target cone options that were available but lost to movement. The showcase preference also contributed +2 to the chosen Tangle Vine, which is consistent with the requested entertainment setting rather than a separate rule error.

**Next correction:** keep the entertainment preference, but add urgency to useful limited spells and compare their resource cost against probable remaining opportunities. Do not simply make every caster spend all slots immediately or force a showcased spell into a bad situation.

### Prioritized follow-up

1. Fix the persistent allied-cost hole in Grease.
2. Give casters a common remaining-turn forecast so retreat cannot silently crowd out their spell.
3. Make area control respond to known ranged/melee roles and terrain function.
4. Make resource conservation depend on useful opportunities and survival pressure.
5. Improve replay diagnostics with explicit Scuttle destinations and selected spell-area outcome summaries.

The individual casts demonstrate working mechanics. The main weakness is tactical sequencing and control valuation. Losing to stronger Elite scouts, or losing initiative to four wolves, is not by itself proof of an AI defect; the decisions and scoring records above identify the specific defects independently of those outcomes.

## Latest battle reviewed for 0.22.0: circling, resources and escape space

Combat `orHakeZsPzCC9fk2` ran **0.21.0**, with 156 AI reports. The retained native messages and scene were read through Foundry's API; snapshots are private in `.scratch/last-battle-world.json`, `.scratch/stadium-live-scene.json`, and parsed `.scratch/heatmap-battle-decisions.json`. The earlier snapshot was archived as `.scratch/battle-before-heatmap-review.json`. The user confirmed that only HP had been reset between battles, so ammunition and equipment were deliberately carried over.

The fight reached round 7, with only the Ogre Boss remaining undefeated. Scouts recorded 33 turns, 37 Stride choices, two Scampers, one Step, 21 Reloads, 11 Hides and 27 Strike reports. Nine turns had no Strike report. One Strike was explicitly skipped without spending its action; these are report counts, not a claim of 27 native attack rolls or an action-budget violation.

### Confirmed causes

| Observed problem | Recorded/source cause | Applied correction |
| --- | --- | --- |
| A sword-equipped scout spent its first turn moving from `(42,28)` to `(42,25)`, then `(37,24)`, then `(41,25)`, with no attack. Another depleted scout used three Strides on its following turn. | Sight changes could earn +2 even without a usable weapon action. Movement memory only covered the current turn, and useful-looking local distance changes could reverse the previous leg. | Reduce unproductive sight rewards, remove them from the no-bolt policy, remember recent actual destinations across turns and score the surrounding escape topology. |
| Several scouts kept moving after their bolts ran out. | Resource totals persist; HP recovery does not restore bolts. The planner would draw at adjacency or for a swarm, but did not have a general no-ammunition melee commitment or preparation value. | Empty or deleted ammo independently enables Draw Sword and route progress toward actual sword reach. It keeps costs and inventory unchanged and suppresses empty-crossbow kiting. |
| Kiting pushed scouts into restricted areas despite increasing distance. | Kiting used distance/reach/Speed and line of sight without checking whether obstacles left any escape space, or whether a pursuer could intercept a narrow exit. | Add a bounded tactical field of obstacle-aware pursuer arrival and reachable escape space, accounting for Large footprints, terrain and known threat positions. |
| A movement report immediately before a scout's death showed value 0 despite negative exposure and reaction terms. | Approaching an enemy clamped negative utility to zero, which can rank ahead of End turn under the recovered comparer. | Do not clamp risky/hazardous routes or recently revisited/less flexible routes into a favorable zero-score fallback. The native reaction/death engine remains authoritative. |

These errors were in the Foundry adaptations and local scout heuristics. The comparison does not establish a problem in the original Dawnsbury implementation or predict the outcome of another battle. Carrying empty resources into this fight was user intent; replenishing them would obscure the required fallback rather than repair it.

### Scope and evidence of the correction

The resource fallback is verified by a complete native Draw/approach/shortsword Strike with an empty bolt stack, and by drawing with a deleted stack. It requires neither a swarm nor an ammunition reset. Route progress now uses the sword's weapon-specific reach.

Grid regressions distinguish open space from a distant dead end with a controlled entrance, route around walls, delay pursuers through difficult terrain, and prevent Large enemies from walking down one-square passages. Map caching invalidates on wall changes. Different live coordinates for an Undetected enemy do not change the remembered-position field. Movement history records resolved positions and expires with the encounter.

The GM can inspect the last computed map using the selected scout and `game.modules.get('foundry-creature-ai').api.tacticalMap()`. It is a snapshot of nearby evaluated cells, not a live overlay or a full simulation of future enemy decisions. Native movement and reaction rules still resolve actual actions. No creature was moved, healed, re-equipped or supplied with ammunition during this review, and this battle was not rerun.

## Earlier battle: why the kobolds lost faster

Reviewed combat `CygJLrR6r8NGwTBn`: eight level 1 Kobold Scouts against three level 2 Ogres and one level 7 Ogre Boss. The saved chat has 180 AI reports: 13 from 0.19.0, 50 from 0.19.1 and 117 from 0.19.2. This was one encounter resumed through code reloads, not a fresh comparison of two fixed releases. The native records are saved privately in `.scratch/last-battle-world.json`, with parsed decisions in `.scratch/latest-battle-decisions.json`. The earlier fight's retained native messages and decisions remain in `.scratch/last-battle-analysis-input.json`.

The final kobold fell in **round 5**. All four ogres survived, at 125, 1, 21 and 27 HP respectively. The one-HP survivor was close to death; the result does not establish that the scouts can no longer kill an ogre. Starting positions, loaded weapons, ammunition, interrupted actions and dice were not reset or held constant for this comparison.

| Recorded measure | Earlier fight, 0.16.2 | Latest fight, mixed 0.19.0–0.19.2 |
| --- | ---: | ---: |
| Kobold native attack rolls | 32 | 14 |
| Kobold hits, including critical hits | 14 | 9 |
| Kobold damage rolled, before overkill or mitigation | 147 | 60 |
| Kobold damaging hits containing precision dice | 7 | 1 |
| Ogre native attack rolls, including reactions | 16 | 26 |

These totals cover different-length encounters. Failed concealment checks spend an attack without producing a native attack roll; the latest log explicitly records two such scout attacks. The table therefore measures retained rolls, not all attack attempts.

### 1. The ogres now engage instead of granting free time

The earlier boss spent its opening turns stepping around and first made an offensive action in round 7. Here it used **Bellow → Stride → Stride** in rounds 1 and 2. An ordinary ogre reached axe range and made two melee attacks in round 1; Bellow supplied the additional movement action. The boss killed a scout with a 46-damage Reactive Strike during Reload in round 2. By round 3 it was using Trip and Sweeping Hook.

The latest fight contains 22 ogre melee attack rolls, versus 13 in the earlier fight. Removing the ogres' navigation/setup failures made the encounter considerably more dangerous. Their improved engagement is supported by the log; the exact share of the outcome attributable to that fix cannot be isolated from this single resumed encounter.

### 2. Cover shopping still crowds out scout attacks

Across 24 recorded scout turns, **eight contained no Strike choice**. Scouts chose 19 Hides, 18 Reloads and 18 movement actions against 16 Strike attempts. One Reload was reported on both sides of the 0.19.0/0.19.1 reload in the same turn; these are decision-report counts, not proof that an extra legal action was granted.

Four of the eight opening scout turns were **Reload → move → Hide**, despite an available shot before the move. In round 2, scout `dvL1` used **Stride → Stride → Hide**, still without firing. Its second move scored 5.35 against an available shot at 2.70. In round 4, scout `k5sA` assigned **+7.5 for cover** to a move, producing a 9.85 movement score against an immediate shot at 2.70.

The source explains this: `protect()` sums cover/concealment over observers; movement multiplies the improvement by 1.5 and adds a following shot's value, charging only 0.35 for setup. It does not estimate whether each observer can actually attack before the scout acts again. Several small defensive improvements can therefore outweigh a real attack, and changing enemy geometry can make another destination attractive immediately afterward. This survives 0.19.2; it is a distinct issue from the Undetected bonus removed in 0.19.0.

### 3. Escaping adjacency is weaker than escaping enemy reach

The scout's retreat test requires a known enemy within 5 feet, and only requires the destination to be farther than 5 feet from everyone. It does not distinguish a 5-foot attacker from a reach weapon or account for how easily an enemy can close on its next turn. Reaction exposure is scored separately, but does not fix the weak positional goal.

In round 2, scout `Lx9j` chose a Stride for +1.5 cover, then immediately needed Scamper from the resulting adjacent position, then Hid. It made no attack that turn. A stronger escape goal should evaluate the actual known reach and pursuit distance, and should avoid moving into adjacency merely to gain a cover bonus. This should use known or observed capabilities, not secret defenses or hidden roll results.

### 4. Stealth rarely survived until a damaging attack

Only **four of 14 native scout attacks** carried the explicit hidden/off-guard option. Only one of the nine damaging attacks included Sneak Attack dice; seven of the earlier fight's 14 damaging attacks included them.

The log supports several causes: attacks after ordinary Stride correctly reveal the scout; some Hide/Sneak attempts failed; some protected positions no longer supplied hiding against the moving ogres; some offensive turns reloaded before firing, which reveals existing hiding. Defensive Hide on a last action is legitimate, but it does not guarantee offensive precision next turn. The planner must continue relying on estimated chances, rather than using the GM's secret success/failure to choose its next action.

### 5. Attack dice were not the main disadvantage

The scouts' native attack d20 average was **11.29**; the ogres' was **9.46**. Scouts hit on 9/14 native attacks, versus 14/32 previously. Their lower output came primarily from fewer opportunities and much less precision damage, rather than a worse attack hit rate. Damage rolls did matter: one scout rolled only 8 total on each of two plain crossbow critical hits. The boss also rolled a devastating 46-damage critical reaction. Neither fact establishes what the encounter would have done with average dice.

### 6. Confirmed victory-loop bug, fixed in 0.19.3

After the final kill in round 5, automation continued through round 13: **34 terminal/no-enemy reports and eight additional Bellowing Commands**. An exhausted target roster completed an individual turn and triggered automatic advancement; the boss could still rank its buff ahead of ending its turn. No encounter-wide stop prevented the next round.

Version **0.19.3** checks the complete combat roster before preparation, after actions/reactions, and before turn advancement. With no surviving hostile pair, it stops all automatic Creature AI starts, announces the result once for the combat, and leaves the tracker and remaining action counts in place. Untaught, hidden, invisible and inaccessible living opponents prevent false victory. Explicit neutral hostility is included; an individual exhausted manual target list cannot end other creatures' ongoing combat. It does not delete/end combat or disable saved creature configurations.

### Scout corrections identified in the review

1. Score defensive movement by estimated incoming danger and known enemy reach; avoid summing unweighted cover against every observer.
2. Compare a short action sequence, so taking an available shot is not indefinitely displaced by another small cover improvement or setup action.
3. Prefer useful stealth/weapon ordering and avoid stepping into melee just to collect cover. Preserve uncertainty about secret checks.
4. Consider focus-fire value when targets otherwise have comparable attack utility. The 1-HP survivor shows that concentrating damage could matter, but the current log does not prove a particular alternative would have killed it.

The victory fix includes regressions for full-roster victory versus hidden survivors, neutral hostility, missing documents, continuing fights after one ally dies, final reaction kills, victory during pending advancement, and resuming the preserved budget after recovery. No battle was rerun and no HP, ammunition, actions or positions were changed during this review.

### Applied in 0.20.0

The scout now compares the best legal remaining-turn sequence after a candidate: attacks, Reload, Hide, drawing/stowing the sword and restoring the bow grip. Forecasts respect the actual ordinary action budget, MAP, finite bolts and revealing actions. Moves compete with the full alternative sequence, rather than receiving a free following-shot advantage over a single immediate Strike. A small readiness credit permits preparing a weapon for the next turn.

Summed cover rewards are replaced with bounded incoming-pressure estimates from known enemy reach, Speed and ranged capability. Cover and concealment are evaluated in the incoming direction. Small bonuses from distant observers cannot add up indefinitely. Reach-aware movement avoids entering a new threat for a minor cover gain, distinguishes escaping reach from escaping adjacency, and values endpoints beyond a pursuer's single Stride. Last-action defensive moves can compete with last-action attacks in the scout's full-turn comparison; the other profiles' ranking layers are unchanged.

A recently witnessed allied scout hit adds a small, expiring target preference. It does not consult current HP, share unseen hit outcomes, or compensate for a substantially worse attack. Observed enemy reach/Speed are remembered within the scene/combat; hidden loadout changes do not refresh them. The existing probability model remains the source of stealth estimates and is tested against different actual secret rolls/DCs.

Regressions model the recorded failure patterns and verify useful attack/Reload/Hide ordering, long-reach escape, pursuit, last-action survival, ammunition/hand costs and focus-fire witnesses. They are not an exact replay of the logged fight and do not establish which side will win the next battle. The GM explanation now shows the estimated sequence, recalculated after each real action.

### Coordinated alternatives added in 0.21.0

Scouts can now kite with other ranged scouts, or draw shortswords and surround an isolated target when enough nearby allies can help before it acts. The first position is valued as coordination, without granting a fictional flank or extra precision dice. Actual opposite-side allies supply native melee flanking and Sneak Attack. The projected crossbow score no longer incorrectly inherits that melee-only benefit.

The turn forecast adds at most one future native Step/Stride, drawn from up to eight shortlisted legal routes. This enables shoot-before-retreat and draw-before-approach sequences. Ranged support requires a firing lane; isolation accounts for known reinforcements and unknown enemy locations. Group positioning saturates rather than rewarding endless retreat. Weapon, action, ammunition, reaction and terrain costs remain intact. Tests model these opportunities and execute a complete native Draw/move/sword Strike; the historical encounter was not rerun.

The same release removes dead, zero-HP and defeated creature tokens from shared movement occupancy. All taught profiles can route across corpses and end on their squares without a terrain surcharge from the body itself. Live creature occupancy, actual walls and terrain remain. Regressions cover a Large creature crossing a corpse-filled corridor, native movement execution and a revived opponent blocking the corridor again.

## Follow-up: Ogre stopped with 1 ordinary and 1 movement-only action (0.19.1)

The later report `bdTFDNqrpuxq9uhJ`, combat `CygJLrR6r8NGwTBn`, was inspected separately from the older battle below. Its Ogre was 15 feet from the nearest enemy with ten-foot melee reach, had one remaining javelin which was not held, and had 30 reachable movement destinations. Every move was discarded because the old approach field did not regard it as closer; it ignored occupied-space constraints which the actual Large token had to obey. Seek was also suppressed because other kobolds were Observed. The empty Refuse supply was only one rejection, not a complete explanation of the stop.

Version **0.19.2** measures routes to usable stopping positions with the actual footprint/occupancy constraints, retains Seek when attack and useful approach are blocked, and adds bounded movement to another investigation viewpoint near remembered enemies. Restricted movement can fund the move, with the ordinary action reserved for Seek or a DC 11 attack against a located Hidden target. The Ogre can also legally draw its remaining javelin for next turn with its last ordinary action. No actions were spent and no creatures were moved during the diagnostic inspection.

## Original battle reviewed for 0.19.0

The retained Foundry chat history contains 210 AI decision reports across 67 creature turns for combat `6RLDXHV9rP4s4vAL`, from 11:56:05 to 12:11:02 UTC. Every report identifies running code **0.16.2**. These are recorded decisions, not 210 spent actions: terminal reports and reaction follow-ups are included. Counts include 37 Hide, 19 Sneak and 30 Reload choices. The native source snapshot and parsed decision history are saved privately in `.scratch/last-battle-world.json` and `.scratch/last-battle-analysis-input.json`.

This battle does not demonstrate the behavior of the installed 0.18.1 changes, because that code had not been loaded by the client. Nevertheless, several identified scoring causes remained in 0.18.1 and are corrected in **0.19.0**. The review compares recorded scores with source and adds targeted regressions; it does not claim to have replayed the entire encounter or predict identical dice outcomes.

## Confirmed problems

| Observation | Recorded cause | Correction |
| --- | --- | --- |
| The boss spent its first two post-command actions on Steps, including moving farther from the nearest kobold. It first made an offensive action in round 7. | In round 1 it already had sight of four opponents at 90–110 feet. Every small move revealing another remembered square earned +2 for regaining sight. That positive utility ranked above a zero-score approach Stride; equal-score comparison favored shorter moves. | Additional sight has no setup bonus when opponents are already in view. Actual attacks from a better position retain their own utility. The boss can close toward known foes rather than tour extra sight lines. |
| Five turns used Hide, then Sneak, then Strike. Some other turns used Sneak, Strike, then Hide. | Sneak received both its following attack's hidden precision value and a separate reward for preserving existing stealth/becoming Undetected. | Existing stealth is not counted twice. Hidden and Undetected have equal offensive value. New Undetected protection is valued for defensive positioning rather than as another offensive setup. |
| Several Sneaks provided no better shot. | For example, message `6c0mKLR1XALAVwEm` valued the shot after moving at 5.60, exactly the best immediate Strike, but added 3.50 for stealth. Message `0MLSQqeExSkGTZ95` likewise retained a 4.80 shot and added stealth plus redundant sight bonuses. | A useful change in angle, cover, distance, reaction risk or defensive situation is required. Becoming Undetected alone is insufficient when the scout can already take the same shot. |
| Two turns used two Sneaks followed by Reload; another scout moved away and back before firing. | The extra stealth score could outweigh Reload despite providing no attack from the destination; the eventual Reload then revealed the scout. The initial square was absent from the turn's visited-destination list. | Remove the baseline preservation reward, retain weapon-preparation sequencing, and penalize returning to the turn starting square without forbidding a genuinely useful return. |
| The current probability model could offer Hide again after preserving stealth across turns. | The roll outcome was correctly unknown, but the estimate treated a fresh Hide as another independent chance to improve confidence. | Preserve the prior belief. Another Hide provides no new estimated advantage against the same observers until revelation or lost protection; new observers can still justify a Hide. This change never consults the secret result. |
| Hide could receive defensive value even when its planned next action was a shot that immediately revealed it. | Defense was summed across eligible observers and combined with precision setup and showcase rewards. | A planned immediate shot receives the new offensive benefit only. End-of-turn hiding retains defense. Showcase does not rescue a setup that adds no benefit, such as recreating off-guard against an already prone target solely for the same attack. |
| Sneak movement risk used the same discount regardless of estimated success. | Current code multiplied reaction exposure by 0.4 for every Sneak. | Reaction protection now uses the estimated Undetected chance for each relevant known reactor. Failed secret checks are still resolved by GM execution, not exposed to planning. |

Some Hide–Sneak–Strike sequences genuinely improved the firing lane. For example, the first such sequence increased the available attack score from 2.25 to 4.48. These moves are not categorically forbidden; the repair removes the unjustified stealth and redundant sight bonuses rather than banning useful movement.

## Things that were not established as errors

The boss had **zero javelins throughout the recorded battle**. It could not legitimately solve its opening by throwing one; ammunition is persistent inventory and is not replenished between combats by the AI. Its six Bellowing Commands granted movement to eligible allies; a command is not inherently wasted merely because the boss itself failed to advance. No ammunition was added and no completed combat state was rewritten during this review.

## Search policy requested by the GM

Version 0.19.0 adds the simplified default **NPC Seek search scope: all opposing creatures not blocked by LOS**. It makes one secret native Perception roll against individual Stealth DCs across the visible field, preserving walls, surfaces, elevation/level and invisibility limits. This is an explicit relaxation of the normal area restriction. The previous bounded search remains selectable in world settings.

The planner chooses the field without knowing hidden coordinates or secret DCs. An alert combat can justify searching even without a known square. An already Observed opponent normally gives the AI an engagement option, so it does not search for additional enemies instead of approaching the fight.

## Validation and use

Regression tests reproduce the opening sight-bonus trap, identical-shot Sneak, retained Hide belief after either actual secret outcome, already off-guard setup, useful defensive Sneak, return-to-start cost, and field searches across distant targets with wall exclusions. Prior action, reaction, ammunition, secret-information and movement tests remain included.

Reload every Foundry client with **Ctrl+F5** and confirm **0.19.0** in Alt+W. Installed files and historical chat version labels do not change the JavaScript already running in a browser. A new encounter is still needed to evaluate the revised policies in play; the completed battle has not been rerun or edited.
