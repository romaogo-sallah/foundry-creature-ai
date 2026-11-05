# Additional findings from Dawnsbury Days AI

Inspected 2026-11-03 in the installed 4.44.0.0 assembly identified in the [main extraction report](dawnsbury-ai-behavior.md). These are observations from decompiled method bodies, not new Foundry features. No module code or installation changed during this investigation.

Subsequently, module **0.7.0** applied the wolf-relevant subset. See [implementation details and boundaries](wolf-decision-improvements.md). Statements below that describe proposed features refer to the investigation before that implementation.

Raw decompilation remains private in `.scratch/dawnsbury-decompiled`. This note describes behavior without distributing the C# implementation. Findings below were traced statically; the existing arithmetic parity checks do not validate these additional methods.

## 1. Abilities can value their own follow-up sequences

`QEffect.MonsterGrab(bool)` supplies an `AdditionalGoodness` hook that adds 8 to the utility of a Grab-trait action when the defender is not already Grappled, the attacker is not holding a Grapplee item, and at least two actions remain. This influences the initiating Strike, rather than merely the Grab action after a hit.

`ZombieShambler.CreateZombieShambler` attaches this effect. Its `Jaws` action has an additional target condition requiring a Grappled effect whose source is that zombie. It does not merely check whether anyone has grabbed the target.

`QEffect.Rend(string)` likewise adds 5 to qualifying Strike utility under action-budget/history conditions. The effect separately tracks successful consecutive attacks against a particular creature to enable the follow-up. The bonus is a heuristic, not an exhaustive simulation of the sequence.

**Foundry implication:** retain generic action selection, but let supported abilities contribute prerequisite checks, history tracking and follow-up value. These examples concern Grab and Rend; they are not extracted wolf Knockdown formulas. In this installation, Monster Grab uses an automatic grapple after the qualifying hit, which also prevents blindly copying its execution into a different PF2e rules version.

## 2. Pathfinding preserves different kinds of risk

`TileVertex` identifies a route state using its tile plus three accumulated flags: provoking an attack of opportunity, requiring Tumble Through, and triggering hazardous terrain. `GraphStateExtensions.FromBooleans` encodes these as bits 1, 4 and 2 respectively.

`Pathfinding.AStar` queues vertices using `graphState * 500000 + distanceCost` in its ordinary movement mode. Thus it explores lower state categories before higher ones within normal movement budgets. Floodfill records the first acceptable route to a tile; there can be multiple route states for that same tile. The separate `ShortestPath` mode uses a different policy and bypasses this classification.

Threat marking checks whether a known enemy can currently take the relevant reaction and can attack. It skips enemies undetected to the mover. The search also accounts for large creature footprints, and annotates destinations for Step, Crawl and movement abilities.

**Foundry implication:** route risk should survive as structured information, and reactions must be recalculated after use. This is not evidence that the game predicts exact reaction damage or that our current Foundry route scoring reproduces these states.

## 3. Scripted priorities can temporarily replace the shared chooser

`CommonAIStrategies.CreateAndApplyBuffingStrategy` scans a supplied ordered list of spell IDs and returns the first spell present in the current options. When none is available, it can return End Turn. If End Turn is present and at least two actions remain, it instead expires the strategy effect and returns null, allowing normal selection through `AI.Decide`'s fallback. Expiry clears the override.

This is an ordered availability scan on each decision, not a stored program counter or a complete encounter planner. This investigation verified the helper itself, not all callers or a particular boss opening.

**Foundry implication:** a creature can have a short opening policy that yields back to shared tactics. Most of its actions need not be individually scripted.

## 4. Targeting utilities handle more than single attacks

`AI.TakeActionAgainstTarget` handles self, creature, tile, area and multiple-creature targets, including available action-cost variants. For multiple targets without extra per-target restrictions, it estimates value as the best target's value times the number of target slots. When targets must simply be distinct, it sums the best distinct values. More complex restrictions use recursive assignment checks.

`AI.DetermineAreaValue` counts each affected creature once, even if it occupies several tiles, applies the area's inclusion filter, and sums its per-creature values. Harm to allies can contribute negative value through `CombatAction.WithGoodnessAgainstEnemy`; there is no universal fixed friendly-fire penalty in this area summation.

`AI.ZeroifyIfUndetected` excludes an undetected creature of another faction from that calculation. This is a specific knowledge filter, not proof that every AI subsystem is free of information leakage.

**Foundry implication:** caster profiles need target-set and area evaluation as shared services, with the NPC's knowledge applied before scoring.

## 5. Several policies are deliberately simple or creature-specific

- `AI.Heal` values at most the target's missing HP. For friendly targets more than two levels below the healer it caps value at 3. Demon healers reject non-demon targets in this helper.
- `AI.DealDamage` rejects unconscious targets. This is an AI preference, not a general claim that attacking an unconscious creature is illegal.
- `AI.Fear` assigns zero value to targets already Frightened or Fleeing, and targets with Bravery. `KnockProne`, `Slow` and several other helpers similarly suppress redundant applications. These are individual heuristics; not every condition helper implements the same incremental model.
- `AI.DealDamageWithBasicSave` blends full and half damage using an estimated success probability. It does not enumerate all four degrees of success. The attack helper also uses simplified damage valuation, as documented in the main report.
- `AI.EscapeFrom` returns 2 before the first attack of the turn, and 0.05 afterward. That is a small fixed preference, not a detailed Escape probability or immobilization-cost model.

**Foundry implication:** copy useful architecture and verified behavior selectively. Preserve native Foundry rules resolution and explicitly identify improvements or remaster adaptations; the decompiled scoring helpers alone do not provide complete PF2e rules knowledge.

## 6. The game records ranked decision alternatives

`AI.Decide` calls `AIExplanationPhase.AddDecision` after choosing an option. This stores the actor, chosen result, and options sorted with the actual usefulness comparator. The presentation omits forbidden-sentinel entries and limits displayed movement alternatives. It also separates the leading tied group visually from lower-ranked options.

**Foundry implication:** add a GM-facing explanation showing the selected action/target, its ranking fields, leading alternatives and known rejection reasons. That is a proposed diagnostic feature, not something added by this investigation. The original log is evidence for ranked-option visibility; it does not itself supply a complete natural-language explanation of every legality check.
