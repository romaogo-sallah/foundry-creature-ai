# Dawnsbury Days: caster AI findings

Inspected 2026-11-04. These findings come from static decompilation of the installed **Dawnsbury Days 4.44.0.0** assembly, not descriptions of its public API. This investigation changes no Foundry runtime code.

Subsequently, **0.24.0** applied the Pyro-relevant subset through shared caster helpers. See [implemented behavior and limits](goblin-pyro-foundry.md). The findings and recommendations below describe the research before that implementation; the new remaining-turn forecast extends the original one-move lookahead.

Assembly: `G:\SteamLibrary\steamapps\common\Dawnsbury Days\Data\Dawnsbury Days.dll`.

SHA-256: `61d48e6c059777a74b17e0fe4d9bc6600d57fbf6a09fe78e47cfdb7272304b23`.

Decompiler: ILSpy command-line 11.2.0.10050. Extracted method bodies remain in private `.scratch/dawnsbury-decompiled`; this report summarizes behavior. The [evidence manifest](../research/dawnsbury-caster-verification.json) records source hashes and checked evidence. Existing comparator/arithmetic parity tests do not validate these caster methods, and no game encounters were executed for this investigation.

## Shared evaluators, with a few personalities

The inspected Kobold Dragon Mage, Orc Shaman, Orc Necromancer, Skeletal Mage and Dinosaur Wizard builders mostly supply spell lists, slots, statistics and ordinary creature abilities. They do not define a separate caster decision tree in those builders. Their spells participate in the shared action chooser through per-spell utility callbacks.

One explicit exception is **Gnoll Green Sorcerer**. `GnollBlackSorcerer.CreateGreenSorcerer` attaches a **Fireball lover** effect, whose `AdditionalGoodness` callback adds **150** for Fireball. It is an ongoing preference, not a once-per-fight showcase bonus.

Important detail: `AI.ModifyGoodness` applies that bonus per affected creature, after the ordinary enemy/ally sign from `CombatAction.WithGoodnessAgainstEnemy`, and before attack/save probability adjustment. Thus the bonus is not inherently safe for allies: a negative ally contribution can become positive. This is a warning about the inspected scoring path, not a claim established by an observed encounter.

**For Foundry:** shared spell evaluators plus small creature preferences are a good architecture. Our bounded showcase bonus should remain separate from the cost of harming allies; copying the literal +150 would be a poor choice.

## Movement asks what can still be cast afterward

`AI.CalculateTileGoodness` temporarily spends one action, regenerates possibilities, translates the creature to each reachable free destination, recalculates flanking and evaluates the best legal non-movement action there. It records that follow-up as `ObjectiveAction`, then restores the original position and action count.

This is **one-move lookahead**, not an exhaustive whole-turn planner. Nevertheless, an important safeguard follows from the action budget and comparator:

- With three actions available, movement can compete with casting if a useful follow-up remains.
- With two actions available and no attack yet this turn, movement has `YouStillHaveGoodAttacksLeft = false`.
- An ordinary positive stationary action ranks in layer 6; ordinary positive movement without that flag ranks in layer 5. Extreme scores of at least 5000 receive an additional layer.

Consequently, in the ordinary two-actions-left case, a viable two-action spell takes priority over repositioning. After moving there would be only one action, so that spell is unavailable in the destination assessment anyway.

**For our Pyros:** their retreat bonus and `fullTurnPlan` promotion are Foundry adaptations, not extracted caster behavior. They can let Stand → retreat consume the opportunity to cast, as seen in the latest battles. The next correction should compare complete affordable alternatives: **cast now**, **move then cast**, and **cast then move**. Retreat can still be justified, but should pay for the casting opportunity it consumes.

Evidence: `AI.CalculateTileGoodness`, `Target.CanBeginToUse`, `AIUsefulnessComparer.GetLayer`; comparison with `src/profiles/goblin-pyro.mjs` and `src/dawnsbury/chooser.mjs`.

## Support and control have spell-specific priorities

| Evaluator | Verified behavior | Useful Foundry lesson |
| --- | --- | --- |
| `AI.Stupefy` | Values only the increase over existing Stupefied. Halves its value if the target has no spellcasting. | Control should consider existing benefit and the target's apparent role. |
| `AI.Fear` | Zero value against Frightened, Fleeing, Bravery or Protector Tree targets. Otherwise caster minimum level × 5. | Avoid redundant debuffs; retain spell-specific exceptions. |
| Heroism, `Level3Spells.LoadModernSpell` | Rejects a target already under Heroism, and targets with a spellcasting source containing at least four spells. Otherwise target level × 2.5 × bonus magnitude. | Favor martial allies for attack-oriented buffs. This is a rough role heuristic. |
| Haste, same method | Normally rejects recipients other than the caster and targets already Quickened. Value 20, or 10000 for the Dark Poet special case. | Useful anti-redundancy check, but self-only preference is too restrictive for a general support AI. |
| `AI.Heal` | Caps value by missing HP. Friendly recipients more than two levels below the healer have value capped at 3. Demon healers reject non-demons. | Avoid overhealing and permit creature-specific priorities. The low-level cap is a game preference, not a PF2e rule. |

These helpers are not uniformly sophisticated. Slow calls `AI.StupefyAndSlow`, which uses fractions of target maximum HP for missing Stupefied/Slowed components. Its name and formula should not be read as a faithful marginal valuation of Slow's actual effects.

**For our Pyros:** extend this architecture to ask whether movement denial matters. Tangle Vine against an approaching wolf and against an archer already firing from cover should have different values. Grease should charge for future allied movement restrictions even when an ally is already Prone. Neither of those improvements was found as an existing Dawnsbury formula.

Dawnsbury sometimes inspects actual target spellcasting, conditions or HP. Our implementation must respect the user's knowledge constraint: infer roles from observable behavior and encounter assumptions, without reading secret check results into the policy.

## Areas are optimized, within limited candidate sets

`AI.DetermineAreaValue` sums per-creature values, counts a large creature only once, honors the area's inclusion filter and excludes undetected creatures of another faction. Damage spell callbacks can assign negative value to allies.

`CloseAreaTarget` evaluates **16 directions** for cones/lines. `BurstAreaTarget` normally tries centers on detected enemy center tiles, rather than searching every legal point. It also exposes overrides for candidate centers and whole-area utility (`OverriddenDetermineCenterPointByEnemy`, `CenterPointGoodness`).

**For Foundry:** whole-area callbacks are a useful extension point for terrain, escape routes and persistent effects. Searching additional legal burst centers could outperform the default enemy-centered approximation. Our current eight cone directions are a separate approximation; any expansion must use Foundry's native geometry.

## Important gaps: Grease and Tanglefoot

In the inspected base definitions, **Grease, Tanglefoot and Produce Flame do not attach an AI goodness callback**. Grease creates a burst whose constructor initially bans AI consideration. Tanglefoot and Produce Flame create creature targets that likewise start banned without a callback; `WithSpellAttackRoll` adds attack mechanics, not utility.

The shared chooser rejects targets marked `BannedFromAiConsideration`. The inspected spell factory does not supply a general fallback evaluator, although it does run mod hooks that could alter spells. These are therefore gaps in the inspected base scoring path, not proof that no mod or encounter customization can ever enable those spells.

Grease's execution does create persistent hazardous/Balance tiles, and Tanglefoot supplies an Escape action. **Having rules execution is separate from knowing when to choose the spell.** We still need our own tactical evaluation for the Pyro's corresponding remaster spells.

Evidence: `Level1Spells.LoadModernSpell` (Grease) and `GreaseTiles`; `Cantrips.LoadModernSpell` (Tanglefoot, ProduceFlame); `CreatureTarget` and `BurstAreaTarget` constructors; `CombatAction.WithSpellAttackRoll`; `AllSpells.CreateModernSpell`; `AI.TakeActionAgainstTarget`.

## Resources and scripted openings

`Spellcasting.CreateSpellcastingMenu` filters spontaneous spell ranks by available slots. `UseUpSpellcastingResources` removes used prepared spells or decrements spontaneous slots. The inspected generic scoring chain contains no universal last-slot conservation charge comparable to our Pyro's explicit slot-reserve penalty. This finding is limited to the traced methods; it does not rule out special spell or creature policies elsewhere.

`CommonAIStrategies.CreateAndApplyBuffingStrategy` can temporarily replace normal selection with an ordered scan for available spell IDs, then expire and return control to the normal chooser. It scans availability each decision, rather than advancing a stored program counter. The helper was verified; this investigation does not establish which encounters use it.

**For Foundry:** support short creature-specific openings without scripting every turn. Reassess our conservation charge using fight urgency and competing spell opportunities; Dawnsbury did not provide a ready-made formula for that.

## Recommended application order

1. Preserve the opportunity to cast when comparing casting and retreat. Score affordable action sequences.
2. Separate immediate control from persistent terrain value and allied movement cost.
3. Add role-aware control and buff valuation, using information the actor may know.
4. Retain modest signature-spell preferences and add optional opening policies for future casters.

Keep native Foundry PF2e resolution. Dawnsbury's attack scoring omits critical-hit damage, and its generic save scorer blends full/half damage instead of enumerating all four degrees; it even reuses that path for some non-basic control spells. Our four-degree evaluator should not be downgraded to reproduce those shortcuts. Legacy spell names, damage and durations also need remaster-aware translation.
