# Polymorph and spellcasting — 0.43.4

[Polymorph](https://2e.aonprd.com/Traits.aspx?ID=670) does not impose a universal spellcasting ban. Its battle-form rules normally prevent casting, speaking, using hand-dependent manipulate actions and activating absorbed equipment, subject to explicit exceptions. An ordinary humanoid disguise is not automatically a battle form. [Change Shape](https://2e.aonprd.com/MonsterAbilities.aspx?ID=55) replaces the physical features specified by the creature's ability.

The [vampire's animal Change Shape](https://2e.aonprd.com/Monsters.aspx?ID=3226) refers to Aerial Form and Animal Form as guidelines. **Table adjudication, following the requested ruling:** the taught giant-bat form cannot cast spells, including innate Dominate and cantrips. It can use its form's movement and attacks, or spend Change Shape to return to vampire form. This does not categorically forbid casting in every monster's Change Shape form. [Vapor Form](https://2e.aonprd.com/Spells.aspx?ID=1738) separately prohibits casting, item activation and attack/manipulate actions; the existing vampire mist restrictions remain in force.

The shared rule service now recognizes:

- Taught vampire bat/mist states, including forms already active before this update.
- Active native PF2e `BattleForm` rule elements and their explicit `canCast` exceptions. Ignored or expired rules do not establish a restriction.
- The native prepared battle-form flag when a specific rule is unavailable.
- An active native Vapor Form effect on manually controlled PCs or NPCs.

AI descriptors disable restricted spells before forecasts or spell-area preparation. The same restriction reaches worker candidate legality, ordinary caster profiles, and the Confused cantrip list. Grounded vampires retain their existing option to revert to the normal body. A spell selected before a form change is checked again at execution, before slot consumption. A form change during the casting's reaction window prevents completion without refunding already committed resources.

Manual native casting entry calls, actual spell-card use and spell attack checks use the shared restriction. Browsing a spell card and rolling compulsory saves remain possible. Returning to an unrestricted form restores casting access without changing spent slots. Disabling the module's manual condition enforcement also disables its manual form guard; AI execution still enforces legality.

This patch implements **spellcasting eligibility**. It does not claim complete automation of polymorph counteracting/replacement, every form-specific equipment or speech limitation, or every custom exception written only in prose. Native PF2e continues to own battle-form statistics. Exceptions taught through native `BattleForm.canCast` are honored; an unknown polymorph trait alone never creates a casting ban.

Reload all clients with **Ctrl+F5**. Existing forms need no actor reset. Verification: [release record](../research/polymorph-verification-2026-11-10.json).
