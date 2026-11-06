# Vampire profiles — 0.41.0

Import the supplied Vampire Guardian, Vampire Count and Vampire Mastermind actors. Use **unlinked tokens**, give allied vampires the same PF2e alliance, select each token and enable its AI through **Alt+W**. The full-auto macro also works. Reload every client with **Ctrl+F5** after updating all five modules.

The three profiles can share a combat, including multiple copies. Their casting pools, immunity sources, grabs, forms and escape states belong to individual creatures. Native prepared statistics preserve the exports’ elite adjustments; the AI does not substitute the base compendium HP or damage.

## Combat behavior

- Melee vampires compare native weapons with Claw → Grab → Drink Blood. Grab is a separate action, uses Athletics against Fortitude DC without applying or increasing MAP, and can be maintained. Restrained on a critical success, source expiry and Escape use the shared condition machinery. As the automatic counter choice on a critical Grapple failure, the target forces the vampire Prone.
- Drink Blood checks Athletics against Fortitude DC for a merely grabbed victim and succeeds automatically against a restrained, paralyzed or unconscious victim. Undead, constructs, incorporeal creatures and oozes are excluded. It reduces HP through Drained rather than a damage roll; healing overflow grants temporary HP. Already-drained victims increase Drained by one and provide no healing.
- The Guardian retains its export’s **Drained 1 / healing 13 / Sneak Attack 1d6**. Count and Mastermind use **Drained 2 / healing 10** and kill at Drained 5. The Guardian export does not specify that automatic Drained-5 death, so it is not added there.
- The Guardian can prepare its bow, spend arrows, release a bow hand for an unarmed attack, and regrip later. Stowing and drawing are separate Interacts with reaction checks. Native flanking and off-guard enable its Sneak Attack; it receives no unconditional precision damage.
- Giant bat form supplies the exported fangs, land 20, fly 30 and precise echolocation 40. Flight uses the existing movement planner. A vampire can resume its body when aerial pursuit is no longer useful.

## Group spellcasting

Every vampire has its own at-will, visual Dominate. Native saving throws, Incapacitation, immunity and targeting checks resolve after commitment. Blind casters or targets cannot establish the required eye contact. Successful saves grant immunity to that vampire, not the entire vampire group. Reducing the controller to 0 HP does not free its subjects; marking it fully destroyed does.

The standing automatic order is to fight the controller’s opponents using the controlled NPC’s available kit. Player characters remain manually directed by the GM. Control updates mechanical allegiance; this is an explicit, public order/obedience convention, not knowledge of a secret d20 result. Cast-attempt memory retains uncertainty when comparing control spells. Failure allows end-turn recovery saves; the automatic hostile standing order grants a critically failing subject one against-nature save at its next turn start. Fleeing and Confused still take precedence. Dominate’s next-daily-preparations duration uses a 24-hour world-time limit; earlier preparations need manual removal.

The Mastermind shares reusable spell components with other casters:

| Purpose | Spells / handling |
| --- | --- |
| Group advantage | Haste favors an engaged martial ally; Blur and Invisibility favor exposed allies. Existing taught/native buffs suppress duplicates. |
| Self protection / mobility | Fleet Step, Invisibility, Blur, Fire Shield; form changes for airborne opponents. |
| Damage | Fireball and Lightning Bolt account for known allies in their areas; Vision of Death uses Will and death effects; Frostbite uses Fortitude and its critical bludgeoning weakness. |
| Control | Dominate, Enfeeble, Stupefy and Dizzying Colors; source-specific durations, action denial and recovery. |
| Lingering fire | Floating Flame and Wall of Fire create native Regions without a placement dialog. |
| Removing magic | Dispel Magic can counteract visible taught effects with a known spell origin, using native counteract checks. Actual source DC/rank enter resolution, not target scoring. |

The Mastermind’s Drain Bonded Item can recover an expended prepared spell before its first AI action, once per day; casting still costs its normal actions. Steady Spellcasting rolls its DC 15 check when a reaction would disrupt casting. Slots and actions remain spent on a failed recovery or interruption.

Haste gives one **Strike/Stride-only** action at the beginning of a turn. It does not grant Step, Grab, Drink Blood, casting or Sustain. Slowed/Stunned can consume that extra action. Gaining Haste during a turn does not retroactively add an action. Blur supplies targeting concealment without qualifying the creature to Hide/Sneak by itself. Rank-2 Invisibility ends after a hostile automated action; rank-4 Invisibility persists.

Floating Flame rolls once per Sustain, moves up to 10 feet through a bounded set of legal squares, and damages each creature at most once per combat round. Actual swept occupants resolve after movement, including incidental unseen creatures. Wall of Fire conceals through its flames and burns on crossing or starting a turn inside; placement causes no immediate damage. The same native serialized roll, including elite modifiers, is used for crossing and turn-start damage. Fire Shield creates an owned temporary native shield: Raise costs one action, AC +1, hardness 10, HP 40, water halves hardness, and blocking an adjacent/unarmed melee attacker can cause fire retaliation. Spell expiry or shield destruction removes owned shield items.

## Mist Escape and recovery

At 0 HP, an unstaked, undestroyed vampire automatically assumes Mist Escape. This takes precedence over the ordinary death stop: it can move at 0 HP and ignores further damage. It uses fly 10 and native collision checks to seek a scene border, spending actions and replanning when movement is constrained. It cannot attack or cast as mist. Reaching a border marks it escaped without deleting its token; other combatants continue. Escape expires after two hours, leaving the vampire corporeal and unconscious.

A border represents departure **toward** the coffin. It does not teleport the vampire into its coffin or restore HP.

In token controls, the GM’s **Vampire forms / vulnerabilities** tool (droplet icon) can change forms or mark direct sunlight, staking, full destruction and actual coffin rest. Marking a stake sets HP to zero, prevents healing and suppresses Mist Escape. Removing it starts a fresh one-hour restoration period if coffin rest is marked. One hour of actual marked coffin rest restores 1 HP; normal fast healing can then resume. Direct sunlight immediately Slows 1 and increases that value at exposed turn ends; losing all actions this way destroys the vampire. Removing the sunlight mark removes only this source’s Slowed effect.

Fast healing keeps the native PF2e rule as its roll source. If Workbench’s persistent-healing automation is enabled, that automation owns HP application. Otherwise the suite applies the native vampire fast-healing message. Mist, staking and full destruction prevent this fallback. The Mastermind’s exported missing mist predicate is corrected on its own Fast Healing rule.

## Current boundaries

These are combat profiles, not unrestricted interpretation of every action description. Children of the Night does not manufacture an unlimited supply of mid-combat creatures; spawn/servitor creation, blood transfusions and weekly Drained recovery remain downtime adjudication. Detect Magic, Message, Sigil, Telekinetic Hand and unprepared Illusory Disguise remain manual utility choices. The supplied Mastermind also has one prepared rank-4 slot referencing a missing spell item; the module cannot cast that absent spell. Mixed physical/fire Shield Blocks use native shared damage allocation and require a GM correction if fire damage is assigned to the fire-immune shield. Environmental cold severity remains part of manual hazard adjudication.

Running water, private invitations, brandished garlic/religious symbols and direct sunlight cannot be inferred reliably from artwork or ordinary light settings. The sunlight/staking/coffin controls support explicit states; water, invitations and revulsion still require GM handling. Manual turn action counts and whether a stake was legally driven remain the GM’s responsibility.

Area planning currently uses the caster’s floor/elevation. Wall placement offers straight horizontal/vertical walls rather than rings, diagonal walls or arbitrary 3D shapes. Floating Flame plans horizontal movement, not arbitrary vertical levitation. These are legal subsets of the spells, not a complete geometric spell editor. Dispel does not infer arbitrary magic-item, artifact or unrelated module effects. Autonomous lingering-damage spells are unavailable in AI rolls-only mode; enable automatic damage for those spells. Manual native buff casting continues to use the system/other installed modules; the AI’s buff helper is also used when it casts on player characters.

## Sources and verification

The supplied actor JSONs are the mechanics baseline. References: [Vampire Count](https://2e.aonprd.com/Monsters.aspx?ID=3225), [Vampire Mastermind](https://2e.aonprd.com/Monsters.aspx?ID=3226), [Vampire Guardian](https://2e.aonprd.com/Monsters.aspx?ID=2149), [Vapor Form](https://2e.aonprd.com/Spells.aspx?ID=1738), [Dominate](https://2e.aonprd.com/Spells.aspx?ID=1501), and [Grab](https://2e.aonprd.com/MonsterAbilities.aspx?ID=45). Export-specific differences and the automatic counter/order conventions above are intentional.

Tests cover all seven nonempty profile combinations, duplicate Masterminds, independent states, full Claw/Grab/Blood turns, mist escape/turn passing, resources, conditions and lingering fire. Native Foundry 14.369 / PF2e 8.6.1 checks use guarded detached actors and Regions, intercept writes/chat and leave the actor directory unchanged. This verifies preparation and rule boundaries; it is not a replay of a live vampire encounter.
