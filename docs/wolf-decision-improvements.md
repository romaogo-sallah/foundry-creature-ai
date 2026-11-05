# Wolf decisions in version 0.7.0

This release applies the wolf-relevant [additional Dawnsbury findings](dawnsbury-ai-additional-findings.md). It preserves native PF2e action execution, reaction waits and action accounting. Existing wolf settings remain valid.

Reload every connected Foundry client with **Ctrl+F5** after installation.

## Strikes account for a useful Knockdown opening

Dawnsbury's Grab and Rend effects add utility to an attack that can enable a follow-up. The wolf now applies that pattern to its actual Foundry Knockdown ability. This is a new remaster adaptation, not an extracted DD wolf formula or a copy of Grab's fixed bonus.

Before choosing a jaws Strike, the planner:

1. Pays for that hypothetical Strike and increases its projected MAP count.
2. Checks whether a successful hit could legally open Knockdown against this target, with sufficient actions remaining.
3. Estimates Knockdown's existing control value and compares it with the best subsequent bite available from that position.
4. Adds only the positive difference, multiplied by the estimated chance that the initiating Strike hits.

The check uses the encounter benchmark for defenses, not a target's undiscovered base AC or Reflex DC. The setup hit probability uses PF2e's four-degree check estimate; the base attack score retains the recovered DD formula. No actual roll or effect occurs during this estimate.

Already-prone, untrippable or unreachable targets receive no setup value. A final Strike with no follow-up action remaining receives none. If Knockdown is already available from the last successful jaws Strike, another bite does not earn a bonus for recreating that opening. Legacy automatic Knockdown uses a bounded control estimate for setup, rather than propagating its enormous execution-priority value into attack scores.

Movement evaluates this possibility after paying its own cost. A normal Stride therefore needs enough remaining actions for both the Strike and Knockdown. A critical-Escape Stride costs zero, preserving the final action for a bite when useful.

The follow-up remains an estimate. It does not simulate all three-action sequences, predict whether damage will kill a target, or guarantee an optimal choice. The actual hit and current conditions still determine which action is legal afterward.

## Routes retain reaction exposure during the search

Previously the search retained a shortest route and assessed its reactions afterward. It could discard a longer safe route to the same destination before the planner saw it.

The search now distinguishes route states for reaction exposure, hazardous terrain and Tumble Through, following the shape of DD's pathfinding. Its queue prefers lower risk categories before distance within the movement budget. Known reactor IDs are accumulated and deduplicated; among equal categories it prefers fewer known reactors, then the existing cost, geometric-distance and bend criteria. Tracking reactor identities is a Foundry adaptation supporting the existing per-reactor damage proxy.

For the current Foundry wolf, **only ordinary movement reaction exposure is connected to these risk states**. Active Region behaviors still require manual movement, and moving through enemies with Tumble Through is not enabled. The generic risk fields do not claim support for executing those actions or resolving arbitrary hazards.

The adapter rebuilds reaction exposure on each snapshot. A spent reaction no longer forces a detour. Unknown hidden, undetected, unnoticed or invisible reactors do not influence planning; actual reaction execution remains separate and can still offer a valid reaction from an unseen enemy. Full observer-specific perception and special senses remain unsupported.

The selected route remains within the same movement action's native measured budget. Passage through willing allies, walls, occupied endpoints, terrain costs and previous diagonal movement retain their checks. Step is evaluated directly and has no movement-triggered reaction exposure. The route search remains bounded to 2,000 processed nodes.

## Inspect actual decisions

- Expand **Why this decision?** in a wolf's GM-only action report.
- Use **Alt+W → Last decision** to reopen its most recent recorded ranked decision.
- **Preview** shows the same explanation format for a newly calculated choice. Equal ties may differ from the recorded choice.

The record includes the selected option, ranking layer and value, scoring factors, supporting ally count, movement reaction exposure, available follow-up value, ties and unavailable-action reasons. It preserves the original random winner. It does not rerun selection to explain a completed action.

The report includes up to nine ordinary movement alternatives plus the chosen movement if necessary, and at most twelve displayed rejection reasons. Full rejection data and the compact ranking record are stored in that GM chat message's module flags. Missing targets and rejected Knockdown prerequisites are visible. Layers rank before values; a larger value in a lower layer need not win.

The module API also exposes `game.modules.get('foundry-creature-ai').api.explainLast()` for the selected wolf.

## Scope and verification

Spell targeting, area attacks, healing and scripted caster openings remain research findings for future supported creature profiles. This release does not add unused spell actions to a wolf or claim those systems are now automated.

Regression tests cover follow-up availability and target choice, action costs before movement lookahead, bounded legacy setup value, safe versus short routes, changing reaction availability, knowledge filtering, persisted GM explanations, tie preservation and escaped names. Existing native-grid, reaction-pause, damage, death/healing and turn-advancement tests remain applicable. Automated tests do not replace a running-world multiplayer smoke test.
