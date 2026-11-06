# AI condition rules — 0.35.0

AI planning uses `framework/condition-rules.mjs`, a pure action-policy module. Foundry supplies the actor's prepared condition facts and item traits; these facts pass through the common behavior selection gate for every supported profile. Final action revalidation checks the live conditions again before reserving actions. This is separate from the manual character adapters described in [manual automation](condition-manual.md).

| Rule | AI behavior |
| --- | --- |
| Restrained | Reject attack/manipulate actions except Escape or Force Open. Untaught Force Open actions are not invented. |
| Immobilized, Grabbed, Restrained | Reject move-trait actions, including Stand, Fly and composite movement abilities. |
| Prone | Only Crawl and Stand can use the move trait. Native penalties remain native. |
| Fascinated | Reject concentrate actions unrelated to the GM-recorded subject. Seek uses a bounded remembered position when a related target is known. Stationary Strikes are not categorically banned. |
| Sickened | Do not consume ingestible items. Consider one-action Retch when the active unlocked condition has a known source DC and native Fortitude check. |
| Grabbed, Deafened, Stupefied, Synesthesia | Rank affected actions by the probability of passing their flat checks; actual execution awaits the checks after reservation. No secret roll result enters the utility calculation. |
| Valued Stunned | Lose actions once and reduce the native condition; use Workbench's current combat/round payment when it owns the start-turn reduction. Stunned and Slowed overlap rather than stack. Restricted supported extra movement actions are lost first. |
| Stunned during the current turn | Finish the current action/activity, then spend remaining actions to reduce Stunned, following Spring 2026 errata. Stunned still prevents reactions while the current activity finishes. |
| Frightened, Clumsy, Enfeebled, Drained, Fatigued, etc. | Read native prepared attack modifiers, saves, skill checks, Speed and defenses. Do not apply another copy of the numerical modifiers. |

Preview does not decrease conditions. Stunned payments in an actual run first reserve an uncertain ledger, then decrease native condition documents, then clear the uncertainty. An interrupted payment requires inspection rather than retrying and losing actions twice. Workbench's asynchronous start-turn payment is awaited through its native update flag; an unresolved owner pauses for retry.

Retch uses a genuine native Fortitude save against the recorded original source DC, reducing Sickened by one on success or two on critical success. Unknown, locked, granted or explicitly non-retchable sources require GM handling. Source exceptions are not guessed from prose. Retch does not affect MAP.

Hostile targeted AI actions end ordinary unlocked Fascinated on the target and its allies. Locked/granted conditions and sources marked `flags.foundry-creature-ai.ignoreHostileAction` remain with their owning resolver. Native manual Strikes use a separate chat-event adapter for the same ordinary-condition removal.

From **0.37.0**, [Confused uses a simple random-target attack override](confused-ai.md): all creature combatants are potential foes, with Strikes, taught offensive cantrips and basic attack preparation/movement. Ordinary tactics, stealth, special abilities, complex aerial plans and slot spells are excluded. Controlled, Fleeing and overlapping action-dictating conditions still require GM precedence adjudication. Timed/locked Stunned sources, unknown Quickened restrictions and untaught actions also remain manual. The supported Ogre command retains its Step/Stride-only extra action; generic Quickened is not an unrestricted extra action. New lingering spell families still need an explicit effect resolver or an enabled existing module rule.
