# Shared conditions and ongoing spells — 0.33.0

The world setting **Enforce action and reaction restrictions** defaults on. It connects prepared PF2e conditions and PF2e Automations 1.4.10 flags to the existing manual and AI workflows. The installed external markers use `flags.pf2e.noUseReactions` and `flags.pf2e.noActions`; effect names and imported prose are not parsed as rules.

## Restrictions

No Reactions prevents Creature AI reaction offers and reservations, including Reactive Strike, Shield Block, Goblin Scuttle, Sweeping Hook and Arrest a Fall. It also gates explicit manual reaction checks and actual-use reaction cards. When manual native damage requests an unavailable Shield Block, damage is applied without that block. Denial neither spends a reaction nor refreshes one already spent. Removing the restriction restores eligibility only if the ordinary reaction is otherwise available.

No Actions additionally prevents supported manual action-labelled checks, spellcasting through native spellcasting entries before slot consumption, and voluntary token movement. Saving throws, flat checks, initiative, unlabelled non-action checks and rerolls remain available. Forced displacement, falls, undo and teleport placement are not treated as voluntary actions. As GM, a custom movement operation can explicitly supply `foundry-creature-ai:ignore-action-restrictions` when resolving a forced placement.

An affected NPC completes its current turn and can auto-advance, while retaining its existing action budget if the restriction is removed before advancement. Temporary inability to act is separate from encounter defeat; a No Actions effect cannot falsely declare the battle won. Expired granted-marker parents do not leave the reaction restriction active in this resolver.

Blinded attackers use a DC 11 targeting flat check; Dazzled attackers use DC 5. Existing Hidden and scene concealment checks take the stronger applicable DC. Special precise senses and exceptions still need GM adjudication or the existing ignore-concealment option. PF2e handles numeric condition penalties. The installed PF2e Automations already checks Stupefied on manual spell cards; Creature AI's managed casting retains its own awaited check instead of adding another manual check.

## Supported manual spell saves

Native saving throws against **Laughing Fit, Stupefy and Blindness** use the same ongoing-effect resolver as the new NPC kit, regardless of whether the caster or defender is a PC. Roll normally from the spell/save workflow with a valid spell origin. The module marks only these saves to skip external duplicate outcome automation, awaits the native roll and asks the active GM to apply its source-tracked effects. It does not roll another save or apply manual spell damage. Other spells keep their existing automation.

The GM verifies the message author, target ownership, saving-throw type, spell UUID and active scene. Repeat requests for the same roll are idempotent. AI-managed saves use their own awaited execution path and are not handled twice. Rerolled saves currently require GM correction of the original effect; the handler does not silently replace an already resolved result.

## Sustain and duration

Select the caster and use the **Ongoing spells / Sustain** wand toolbar button. Choose the spell and Sustain, or end it. Player action counts remain manual: each Sustain costs one action. Only an owning player or the GM can request it, and the active GM resolves effects on other actors. Sustain is available during the caster's active combat turn and once per spell per turn.

Laughing Fit continues through the end of the caster's next turn. Each Sustain extends it through the following turn, to a maximum of ten minutes. Skipping Sustain ends its owned target effects. Its critical failure first denies actions/reactions and applies ordinary Prone; at the caster's next start it changes to Slowed 1 plus reaction denial. Ending the spell does not stand the target up.

Stupefy and Void Warp use caster-start expiry for their brief outcomes. Brief Blindness uses the target's next start instead. Minute-long outcomes use world time; permanent Blindness has no automatic expiry. Temporary Blindness immunity has its own one-minute marker and survives the brief Blinded outcome. The resolver checks the actual ended round at a round boundary, handles skipped turn-end events, and serializes lifecycle updates through the same barrier as reactions. Outside combat, unsupported continued upkeep expires as world time advances; the Sustain UI is currently a combat workflow.

All granted conditions belong to their spell effect. Ending or expiring that effect preserves unrelated sources. Prototype reset clears caster plans and removes their ongoing spells from other selected or affected tokens. Confused behavior, blind NPC tactics, arbitrary lingering spells, Phantom Pain's linked Sickened/persistent damage, generic Dispel Magic/counteracting and automatic control of player turns remain outside this first release.

Rules were checked against the supplied native spell items and [Laughing Fit on Archives of Nethys](https://2e.aonprd.com/Spells.aspx?ID=1583). Validation used isolated tests and native Dero diagnostics. The initial actor-creation calls persisted world documents despite the intended temporary usage; [the diagnostic workflow has been corrected](foundry-diagnostics.md), and the verified leftovers were removed or cleaned. Live encounter participants were not rolled for, damaged or moved during those inspections.
