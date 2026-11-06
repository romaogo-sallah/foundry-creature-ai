# Condition and spell automation audit — 6 November 2026

The implementation separates pure AI action rules from Foundry adapters for manual use. Numeric modifiers, IWR, native condition relationships and native effect expiration remain in PF2e. Module ownership is checked through actual enabled settings rather than assuming that an installed module has a feature turned on.

The later [0.38.0 condition gap review](condition-rules-gaps-2026-11-06.md) checks Nethys against the current implementation, including flat-check grouping, precise senses, overlapping condition sources and linked spell recovery. It distinguishes confirmed gaps from module-owned behavior that still needs verification and explicit GM adjudication.

## Rules and discussions

Primary rules checked: [Grabbed](https://2e.aonprd.com/Conditions.aspx?ID=77), [Deafened](https://2e.aonprd.com/Conditions.aspx?ID=66), [Fascinated](https://2e.aonprd.com/Conditions.aspx?ID=72), [Prone](https://2e.aonprd.com/Conditions.aspx?ID=88), [Sickened](https://2e.aonprd.com/Conditions.aspx?ID=91), [Stunned](https://2e.aonprd.com/Conditions.aspx?ID=93), and [Paizo FAQ/errata](https://paizo.com/pathfinder/faq). Paizo's Spring 2026 errata changes valued Stunned gained during a turn: complete the current activity, then lose remaining actions to reduce the value. Slowed/Quickened acquired during a turn do not immediately change that turn's regained budget. The same errata assigns precedence among overlapping Confused, Fleeing and Controlled conditions to GM adjudication.

Read the [Stunned errata discussion](https://www.reddit.com/r/Pathfinder2e/comments/1rioixr/quick_notes_on_the_stunned_on_your_turnerrata/) and [Fascinated discussion](https://www.reddit.com/r/Pathfinder2e/comments/1g0o29t/fascinated_is_a_fascinatingly_awkward_condition/) for edge cases. Forums help identify ambiguity; the implementation follows the primary rules and current errata rather than older forum interpretations. Fascinated is not a blanket action prohibition: its restriction concerns concentrate actions unrelated to the subject, and ordinary hostility breaks it. Grabbed's manipulate check occurs after spending the action, before effects. Retch uses the source DC and the creature's current Fortitude modifiers.

## Installed ownership

The live arena audit found PF2e **8.6.1**, PF2e Automations **1.4.10**, Workbench **7.7.5**, Toolbelt **3.59.2**, and Foundry **14.369**. The [native verification record](../research/condition-automation-verification-2026-11-06.json) contains the exact settings and prepared-condition checks.

| Feature | Owner / action |
| --- | --- |
| Numeric conditions, condition implications, visual/auditory immunities, native saves and IWR | PF2e; verified with detached native actors, no second modifiers |
| Frightened decay | Both external modules were enabled; compatibility selects PF2e Automations and backs up/disables the duplicate Workbench client setting |
| Stunned at turn start | Workbench was enabled; reuse its combat/round reduction flag and wait for asynchronous processing |
| Persistent damage/healing and recovery | Workbench was enabled; preserve its application and recovery rolls |
| Manual condition flat checks | PF2e Automations' `flatCheck` was `no`; use the new fallback. If enabled later, delegate supported manual cards to it |
| Managed NPC condition flat checks | Creature AI, awaited inside the activity; prevent Automations' synchronous pre-create flat hook from rolling again on the managed presentation card |
| Existing manual spell/save outcomes | Enabled PF2e Automations / Toolbelt rules remain active; Creature AI only owns its explicit spell resolver set |
| No Actions / No Reactions | Existing native/Automations prepared flags consumed by both adapters |
| Ordinary movement / Sneak / Step | Native menu descriptors registered at init, before Foundry freezes movement configuration; the existing validated movement/reaction/stealth pipeline executes the selected mode |

The installed bundles were inspected locally, including Workbench's `stunReduction` record and the Automations pre-create flat-check handler. That pre-create handler does not honor the later rule handler's `skip-handling-message` option; managed spell cards retain their native origin/casting data but use an OTHER context classification when external flat checks are enabled. No external module files are edited.

Native tests covered Restrained, Immobilized, Prone, Fascinated, Sickened, Stunned, Slowed, Frightened, Enfeebled, Clumsy, Fatigued, Deafened and Paralyzed. World actors remained at 159; diagnostic actors were detached constructors, and the Region self-deleted. No encounter creature was rolled for, moved or damaged. Follow the [diagnostic safety procedure](foundry-diagnostics.md).

An isolated native browser also loaded version 0.35.0 successfully. Step and Sneak appeared in TokenHUD's native movement choices with normalized cost functions and walking difficulty inheritance. The condition dialog rendered and was dismissed through its normal close button. The browser reported no Creature AI exceptions, zero new actors and 18 unchanged scene Regions. Its ownership report confirmed one Frightened reducer, Workbench Stunned/persistent damage and the manual flat-check fallback.

Remaining explicit limits are in [AI rules](condition-ai.md) and [manual controls](condition-manual.md). This is a shared condition infrastructure expansion, not a universal parser for every spell or monster ability. Locked/granted sources, effect-specific retching/fascination exceptions, unknown Quickened restrictions, action-dictating conditions and generic counteracting require source-aware resolvers or GM handling.
