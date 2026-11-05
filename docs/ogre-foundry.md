# Ogre — version 0.10.0

This profile teaches the supplied level-2 legacy Ogre from `Compendium.pf2e.pfs-season-1-bestiary.Actor.DsEg9sT7jCcsuEDI`. It recognizes the source identity after renaming and uses the actor's prepared statistics, including numerical adjustments. It is separate from the Ogre Boss profile.

## Setup

Reload all clients with **Ctrl+F5**, select the unlinked 2×2 ogre token as the active GM, and press **Alt+W**. The profile reads **Ogre — bruiser**. Set **Refuse remaining** to its available supply, including any piece already held, and save. The default is zero because the export does not provide an ammunition quantity for Refuse. Automatic turn start and automatic advancement remain independent options.

Run Preview, One action, or Run turn during its active combat turn. It targets opposing-alliance combatants by default, respects the calculated front-line preference, and uses the shared movement, reaction waits, Stand/Escape, action reservations and death handling. Morale defaults off for this ogre; it can be enabled separately.

## Taught attacks

| Attack | Execution |
| --- | --- |
| Battle Axe | Native +11 NPC Strike for the supplied actor, 1d8+5 slashing, reach 10 feet. Uses current MAP and native critical damage. |
| Sweep trait | Tracks earlier axe attempts and targets within the current turn. A later axe attack against a different target receives PF2e's native `sweep-bonus` option, granting the +1 circumstance bonus. An earlier miss qualifies. Javelin/Refuse attacks do not qualify the axe; a new turn resets its history. Scoring values the actual bonus when choosing between targets. |
| Javelin | One Interact action to draw, then a Strike to throw. Uses the linked physical stack, consumes one on the attempt, and clears the throwing hand. The supplied bonus is +5, damage 1d6+5 piercing, range increment 30 feet and maximum six increments. |
| Refuse | One Interact action to pick up a piece, then a Strike to throw. Uses the configured supply, consumes one on the attempt, and clears the throwing hand. The supplied bonus is +5, damage 1d4+5 bludgeoning, range increment 20 feet and maximum six increments. Zero stock prevents pickup/throw. The count persists on the token and is shown when controls reopen. |

The exported axe is an unlinked NPC Strike, with no physical axe inventory item. This handler treats that declared melee attack as ready in one hand, leaving the other hand for a javelin or Refuse. The separate physical ogre hook is stowed and is not substituted for the declared axe or drawn automatically. If you add a linked physical axe later, the handler checks its equipped state and can draw it with an Interact action. Other held physical weapons need manual equipment resolution.

Refuse and a javelin cannot occupy the throwing hand simultaneously. An interrupted throw keeps ammunition spent and the ledger uncertain so retrying cannot duplicate it. A target that is gone or out of range before the attempt is skipped without consuming ammunition. Damage and criticals use the native PF2e roll and application flow, including player Shield Block. Draw/pickup and ranged attacks can provoke the existing standard reaction handler.

This actor has no Reactive Strike, Sweeping Hook, Bellowing Command or Knockdown ability; the profile grants none of them. Weapon Sweep is a trait, not the boss's Sweeping Hook reaction. Skills do not grant automatic use of every possible maneuver. Unknown added actions/attacks are listed for manual handling.

## Boss support

The Ogre Boss recognizes this legacy ogre as an ogre ally for Bellowing Command. Language, Deafened and immunity checks still apply; since **0.10.1**, all eligible allies in the scene's combat are treated as hearing the boss without acoustic, wall, range, elevation, level or silence-effect checks. An owned Quickened command effect gives it one extra Step/Stride-only action at its next turn start; it cannot spend that action to attack, draw ammunition or pick up Refuse. The shared command expiry rules still apply.

## Verification

Mechanics-only fixture tests cover profile detection and renamed actors, controls/count saving, full melee and ranged turns, weapon reach, MAP, Sweep history including misses and turn changes, stock consumption and interrupted attacks, throwing-hand conflicts, numerical adjustments and the boss's restricted movement grant. Native PF2e's installed attack-trait modifier implementation was inspected to verify `sweep-bonus`. Running-world multiplayer behavior still needs a live smoke test.
