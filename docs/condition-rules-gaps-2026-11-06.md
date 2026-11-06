# Condition rules: gaps and adjudication — 6 November 2026

This is a rules and source-code audit of version **0.38.0**, commit `b0cfb86`. It informs the shared spell-component work; it does not change runtime behavior. Archives of Nethys pages were checked on 6 November 2026. No live encounter was advanced, rolled for, moved or modified during this audit.

“Confirmed gap” means the local implementation omits or contradicts a rule. “Partial” means some paths work but the general case remains unsupported. “Verify owner” means native PF2e or another module may resolve the event: source inspection alone does not establish end-to-end behavior. “Adjudication” means the rules actually leave a decision to the GM.

## Priority findings

### 1. Flat checks need a shared consequence, not a list of independent rolls

When several flat checks would cause or prevent the same outcome, use one roll against the highest DC. This is different from a saving throw, and does not mean that every unrelated flat check in an activity should be combined. [Nethys: Player Core Checks, Flat Checks subsection](https://2e.aonprd.com/Rules.aspx?ID=2278&NoRedirect=1).

**Confirmed gap:** `conditionFlatChecks()` returns separate Grabbed, Deafened, Stupefied and Synesthesia checks. `resolveConditionChecks()` rolls each; `filterConditionActions()` multiplies their success probabilities. There is no consequence key to combine checks that prevent the same casting. The same inconsistency can affect execution and AI valuation.

The targeted visibility gate already chooses Hidden's DC 11 instead of also rolling concealment DC 5. Extend that principle with explicit consequence groups. Review casting disruption versus failure to affect one target separately; do not silently merge all casting and targeting checks.

A read-only call to the current pure evaluator with Grabbed, Stupefied 2 and Synesthesia returned checks `[5, 7, 5]` and reduced utility 10 to **4.48**. A single highest-DC casting gate would produce **7**. This demonstrates the current implementation; the final grouping policy still needs explicit consequence classification.

Evidence: [condition rules](../src/framework/condition-rules.mjs), [condition checks](../src/foundry/condition-actions.mjs), [targeting gate](../src/foundry/environment-rolls.mjs). The existing `condition action risks compose independently` test in [condition-rules.test.mjs](../test/condition-rules.test.mjs) explicitly asserts multiplication; passing it is not evidence of correct grouping.

### 2. Dazzled has a precise-sense exception

Dazzled makes everything concealed only when vision is the observer's sole precise sense. A second usable precise sense matters; ordinary imprecise hearing does not satisfy this exception. [Nethys: Dazzled](https://2e.aonprd.com/Conditions.aspx?ID=65).

**Confirmed gap:** `concealmentDC()` applies DC 5 whenever the observer has Dazzled. It does not consult prepared senses. The existing Blinded sense helper can inform a shared observer/sense resolver, but range, sense requirements and actual usability still need checking. Darkvision remains visual.

Evidence: [targeting gate](../src/foundry/environment-rolls.mjs), [sense handling](../src/foundry/perception-senses.mjs).

### 3. Reduction, removal and expiration are different operations

Different-valued conditions can overlap with separate durations; only the highest applies. Reducing a condition value affects every instance of that name. Removing a condition removes it entirely. Expiring one source must still preserve other continuing sources. Suppressed conditions continue aging. [Nethys: Conditions Appendix](https://2e.aonprd.com/Rules.aspx?ID=2455), [Overriding Conditions](https://2e.aonprd.com/Rules.aspx?ID=2457).

**Partial:** owned spell expiration preserves unrelated effects, which is appropriate. Retch, however, decreases a selected condition document and stops if the active document changes. Installed PF2e 8.6.1's `decreaseCondition()` / `ConditionManager.updateConditionValue()` update the selected item, rather than performing a general all-source reduction. Our owned spell grants are often in-memory conditions and are deliberately excluded from Retch.

A generic condition component needs source-level expiration plus condition-level reduction/removal, including safe edits to granting effects. It must not delete an entire parent spell merely to remove one granted condition. The original sickening DC and explicit recovery exceptions also need a source record. [Nethys: Sickened](https://2e.aonprd.com/Conditions.aspx?ID=91).

Evidence: [Retch](../src/foundry/manual-condition-actions.mjs), [owned spell effects](../src/foundry/ongoing-spells.mjs), installed native `pf2e.mjs` implementations named above. No multi-source native mutation was attempted in this audit.

### 4. Damage, recovery and spell end must be linkable events

Phantom Pain is not a basic save: success takes full initial damage; failure adds persistent damage and Sickened; recovering from its Sickened ends its persistent damage and the spell. Critical failure raises Sickened rather than simply doubling every effect. [Nethys: Phantom Pain](https://2e.aonprd.com/Spells.aspx?ID=1632).

**Confirmed unsupported spell:** it is absent from the current Dero spell registry. Its future definition needs per-degree outcomes and an explicit recovery dependency. Generic “apply Sickened for one minute” would be incomplete. Interaction with another source of Sickened needs a documented source policy and a GM override; the spell text does not provide an implementation algorithm for concurrent sources.

Evidence: [current registry](../src/framework/condition-spells.mjs), [native spell fixture](../test/fixtures/dero-magister-mechanics.json).

### 5. Confused recovery needs explicit automation ownership

Confused denies reactions and permits a DC 11 recovery check when attack/spell damage is taken. Its no-target self-hit and impossible-attack babbling outcomes also matter. [Nethys: Confused](https://2e.aonprd.com/Conditions.aspx?ID=63).

**Partial / verify owner:** our random-target NPC strategy and reaction denial work, but self-hit/babbling is explicitly manual. We do not own damage-triggered recovery. Installed PF2e Automations 1.4.10 implements a confusion recovery branch in its flat-check chat hook; that hook runs only when its `flatCheck` setting is not `no`. The earlier saved arena audit recorded `no`, so installation alone does not establish recovery coverage. That saved setting is historical, not a fresh live-world inspection.

Before adding a fallback, verify actual post-damage messages, positive damage, source exceptions, granted conditions, duplicate events and an awaited recovery barrier. Do not add another recovery roll alongside an enabled owner.

Evidence: [Confused implementation and limits](confused-ai.md), [owner reporting](../src/foundry/condition-compatibility.mjs), [saved ownership audit](../research/condition-automation-verification-2026-11-06.json); installed Automations `FlatHook.listen` and `flatPreCreateChatMessage`.

### 6. Sustain includes more than extending a timer

Sustain can have a special benefit, including one on an effect without a sustained duration. Repeated Sustains do not extend the duration across multiple future turns, but may still be useful if the individual effect allows repeated benefits. A disrupted Sustain ends the ability. The default maximum is ten minutes when unspecified. [Nethys: Sustain](https://2e.aonprd.com/Actions.aspx?ID=2317).

**Partial:** the current Laughing Fit workflow supports one maintenance action per turn. Its global “already sustained this turn” guard is not a reusable rule for all spells. Also, a failed condition check currently returns without extending the spell; it does not explicitly dispatch a disruption/end event. A shared resolver must distinguish an ordinary failed action from disruption, and represent repeat benefits separately from maintenance. Concentrate is not itself Manipulate.

Evidence: [Sustain execution](../src/foundry/ongoing-spells.mjs), [AI maintenance](../src/foundry/dero-magister-adapter.mjs).

## Other important interactions

| Topic | Rule and current coverage |
| --- | --- |
| Stunned mid-turn | Finish the current activity, then pay valued Stunned using remaining actions. Quickened/Slowed gained mid-turn do not change that turn's regained budget. Already represented in our action economy. Nethys' standalone Stunned entry omits the newer detail, but its [Conditions Appendix](https://2e.aonprd.com/Rules.aspx?ID=2455) includes it; [Paizo's Spring 2026 announcement](https://paizo.com/blog/spring-errata-2026) confirms the revision. Read the appendix rather than relying on the short condition alone. |
| General Quickened | Multiple sources grant one extra action with the union of permitted uses. When losing actions, the player chooses which to lose. Our taught command movement action is supported; arbitrary Quickened restrictions remain manual. [Quickened](https://2e.aonprd.com/Conditions.aspx?ID=89), [Gaining and Losing Actions](https://2e.aonprd.com/Rules.aspx?ID=2341). |
| Confused + Fleeing + Controlled | **Adjudication:** Paizo explicitly assigns precedence to the GM. There is no universal condition ordering to infer. Controlled and compulsory Fleeing currently stop ordinary AI for manual resolution. Our voluntary morale retreat is a separate policy. [Conditions Appendix](https://2e.aonprd.com/Rules.aspx?ID=2455), [Fleeing](https://2e.aonprd.com/Conditions.aspx?ID=74). |
| Paralyzed | Recall Knowledge and GM-approved purely mental actions remain possible; Seek does not. Manual restrictions have a mental-action exception, but the ordinary NPC readiness gate still blocks the whole automated turn. **Partial:** classify action requirements and preserve remaining actions if cured; do not equate every Concentrate action with a purely mental action. [Paralyzed](https://2e.aonprd.com/Conditions.aspx?ID=85). |
| Immobilized and forced movement | Forced displacement is not voluntary movement, but something holding a creature in place can require the external force to beat its effect DC or holder's relevant defense. Our voluntary-movement guard lets forced displacement through without resolving that holding check. **Partial:** require the holding source/DC; not every forced displacement automatically breaks restraint. [Immobilized](https://2e.aonprd.com/Conditions.aspx?ID=81). |
| Fascinated | Hostility against the creature or an ally ends ordinary Fascinated. “Hostile” can include indirect harm, and the GM decides borderline cases. Targeted Strikes and supported AI hostility are covered; generic manual hostile spells/areas and locked sources are not universally covered. **Partial / adjudication:** a missed attack can still be hostile; no damage requirement. [Fascinated](https://2e.aonprd.com/Conditions.aspx?ID=72), [Hostile Actions](https://2e.aonprd.com/Rules.aspx?ID=2251). |
| Persistent damage | Same-type sources do not stack; different types apply together for damage-triggered events. Damage precedes recovery. Assisted recovery and uncertain source comparisons involve GM judgment. We delegate ordinary application/recovery to native PF2e/Workbench; combined trigger handling and source-linked cleanup need verification before broad spell support. [Persistent Damage](https://2e.aonprd.com/Conditions.aspx?ID=86). |
| Prone while Flying/Climbing/Swimming | Being knocked prone while Flying or Climbing causes a fall; Swimming prevents being knocked prone. Our falling hooks target AI-configured flight tokens; they do not establish universal PC, climbing or swimming automation. Prone also permits Take Cover against ranged attacks without an obstacle; the AI does not gain that option merely by having Stand. [Prone](https://2e.aonprd.com/Conditions.aspx?ID=88). |
| Hidden, Concealed and Undetected | Concealed can still be Observed. Hidden gives a known square; Undetected permits a guessed-square attack with secret resolution. Area effects bypass targeting flat checks. Current AI conservatively locates Undetected targets before targeted attacks; blind square attacks remain unsupported. Do not supply their real positions to planning. [Concealed](https://2e.aonprd.com/Conditions.aspx?ID=62), [Undetected](https://2e.aonprd.com/Conditions.aspx?ID=96). |
| Invisible | Becoming invisible while observed initially makes the creature Hidden; it does not instantly erase its known square. Seek cannot normally make an invisible creature Observed. This is observer-relative, with special senses/magic as exceptions. Existing perception/memory handles much of this; future revealing spells must provide explicit overrides rather than just delete Invisible. [Invisible](https://2e.aonprd.com/Conditions.aspx?ID=83). |
| Unconscious | At positive HP, waking can depend on damage, healing, Interact, noise or a source exception. At 0 HP, dying and non-dying cases differ. Current action denial is not a universal wake-up resolver. **Verify owner:** inspect native/external waking before adding one. The entry's “more than 1 Hit Point” wording also leaves the positive-1-HP sleep edge case worth GM confirmation. [Unconscious](https://2e.aonprd.com/Conditions.aspx?ID=95). |
| Incapacitation and immunity | Native saves must retain spell rank, origin and item traits. A target above twice a spell's rank improves its result; non-spell sources use source level instead. Our execution passes native context, but generic AI valuation must also consider permitted knowledge about likely efficacy, without reading hidden saves or unknown immunities. [Incapacitation](https://2e.aonprd.com/Traits.aspx?ID=631). |

## Implications for the shared spell constructor

Keep the proposed range, targets/shape, defense, damage, conditions, duration and Sustain cost. Add these reusable fields/components:

- **Outcome table:** independent damage, persistent damage, condition values and phases for every degree of success; whether the save is basic.
- **Source identity:** caster, cast instance, target, rank, original DC, condition grants and resource pool.
- **Timing:** caster/target start or end, elapsed time, maximum duration, ongoing maintenance and repeated Sustain benefits.
- **Recovery and end events:** Retch, damage, hostile action, Escape, dispel, source expiration and linked-effect cleanup.
- **Action requirements:** traits, physical versus GM-approved mental use, reaction restrictions and disruption behavior.
- **Perception and targeting:** precise senses, auditory/visual requirements, observer-relative detection, target count and area exceptions.
- **Overlap policy:** highest applicable value, separate source durations, global reduction/removal and source-only expiry.
- **Resolution owner:** native PF2e, an enabled external automation feature, or our resolver; idempotent and awaited where execution depends on it.
- **AI knowledge:** actual results remain in resolution; planning receives only information the actor could know and estimated benefit of effects.

These are implementation requirements inferred from the cited rules, not additional game rules. Complex recovery dependencies need an explicit component; numeric metadata alone cannot safely execute arbitrary spell prose.

The recommended implementation order is shared source/reduction semantics and flat-check grouping; precise-sense targeting; linked outcomes such as Phantom Pain; then generic Sustain, recovery and compelled-action policies. Keep the AI evaluator and manual-play resolver separate consumers of the same rule definitions.
