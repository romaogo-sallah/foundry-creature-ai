# Compulsion and fascination policy — 0.39.0

The table's GM policy is **Fleeing > Confused > Controlled**. It selects the behavior driving the turn; it does not remove any condition. For example, a Fleeing and Confused creature escapes while still suffering Confused's reaction denial and off-guard condition. When Fleeing ends, Confused resumes using the same action ledger. When Confused ends too, Controlled remains for the controller to direct manually.

This ordering is a chosen table policy. [Nethys' Conditions Appendix](https://2e.aonprd.com/Rules.aspx?ID=2455) assigns overlapping action-dictating conditions to GM adjudication. It is not a universal PF2e condition hierarchy.

## Fleeing NPC turns

Every taught NPC uses the shared Fleeing driver before ordinary tactics, flight hunting or the Confused attack strategy. It spends available actions on supported ground movement or flight away from the source. Stand and configured Escape can enable movement. It does not attack, cast, Hide, Sustain, use special abilities or permanently mark itself as a morale escapee. An unavailable route finishes the current turn without declaring the creature dead or defeating its alliance.

The source is the optional GM selection under **Condition actions / sources → Fleeing source**, otherwise the condition's native effect origin. Without a located source, the default is already-known opposing combatants. Unseen positions are taken from existing target memory; GM-hidden or Undetected coordinates are not supplied to the escape calculation. Visible allies can be an explicitly configured fear source.

The bounded movement search maximizes distance from the nearest known source, then prefers lower hazard/reaction risk among equal-distance endpoints. Flight uses native upward/downward costs and collision checks. Ground terrain, reaction prompts, action restrictions and the spent action ledger retain their normal owners. Fleeing by itself does not ban reactions.

Currently supported escape preparation is Stand and the existing Escape-source workflow. Opening doors, removing arbitrary barriers, Climb/Swim routes and ground routes changing elevation are not synthesized. If no supported move improves distance, the NPC ends its turn; GM movement can resolve an unusual route. Without enough source information it holds rather than reading hidden positions.

Queued actions are checked against the live directive before execution. Switching conditions discards an unused choice and recalculates without resetting actions, MAP or resources.

## Manual play

The shared manual legality gate rejects ordinary offensive actions and unrelated Concentrate actions while Fleeing, and permits movement, Stand, Escape, Force Open and Interact/opening actions. Players still choose routes and count their actions; this release does not take over a PC's movement or validate that every manual Interact serves escape. Reactions remain possible unless a separate condition, including underlying Confused, denies them.

Compulsions direct behavior before Fascinated's attention restriction. Native numerical penalties remain native; this policy does not delete Fascinated just because a compulsion temporarily takes priority.

## Newest fascination wins

A newly applied Fascinated source replaces older fascination, regardless of their remaining durations. Its subject is recorded from explicit `flags.foundry-creature-ai.fascinationSubjectId`, otherwise the effect's origin token/actor. If neither identifies a subject, the old subject is cleared and the GM can set the new one in **Condition actions / sources**.

Ordinary older Fascinated condition items are removed. For source effects granting Fascinated, only the Fascinated GrantItem rule is disabled; the parent item and its other rules survive. Persisted child conditions are detached from their native grant links before removal so cascade/restrict rules cannot delete unrelated effects. Disabled grants do not reactivate when the newer fascination expires. The source item records `flags.foundry-creature-ai.supersededFascination` for inspection.

Native create/update events run this replacement through the shared reaction barrier and a per-actor queue. Simultaneous applications use the newest event. Repeated updates to the same winning source preserve a GM-configured subject. Updating a condition without a distinct source does not invent a new caster or subject.

The normal hostile-action ending rules still apply. Arbitrary custom rule elements that create Fascinated without an identifiable native condition/grant relationship are not rewritten. This policy intentionally differs from the general longer-duration redundancy rule, following the GM's explicit choice for fascination.

Validation covers precedence, condition transitions, ground/flight escape, same-alliance sources, hidden-position safety, retained reaction denial, source replacement, concurrent application and preservation of unrelated granting effects.
