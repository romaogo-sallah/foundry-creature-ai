# Ogre Boss — version 0.22.2

Patch **0.22.2** fixes ranged action greed: with two actions and a stowed javelin, the boss can advance rather than spending both actions on Draw and a -6 throw. Poor-range approach has a bounded future-position value, comparable with attacking even on the last action. It uses actual route progress toward melee goals, does not require crossing a 30-foot increment this turn, and retains the cost of terrain, reactions and lost sight. An ammunition-conservation scoring cost adds weight to lost ranged accuracy, scaling up through -4 and worse. Native attack modifiers and action costs are unchanged. At small range penalties, or without a worthwhile safe approach, normal throwing remains available. The ordinary ogre shares this policy, including its limited Refuse supply. Reload clients with **Ctrl+F5**.

Version **0.18.0** adds the shared [automatic Seek capability](npc-perception.md): one-action secret Perception searches, observer-specific detection, and continued attacks using automatic Hidden/Concealed targeting checks.

Version **0.17.0** evaluates follow-up ranged attacks when choosing movement. The boss can close into a better javelin increment or move into a clearer firing lane before throwing; destination scores include range penalties, cover, concealment, movement risk and current MAP. Moving with a held javelin can compete with attacking when two actions remain. Moving, drawing and throwing requires three normal actions, or a valid restricted movement action plus the two normal actions. Drawing at the current position uses the same defenses and range penalties. Equally accurate movement does not beat an immediate Strike merely for being closer. The ordinary Ogre shares this evaluation, using its Refuse range and configured supply.

The supplied Monster Core export is a Large, level-7 NPC with a 2×2 token, 25-foot Speed, a reach-10 ogre hook, physical javelins, Reactive Strike, Bellowing Command and Sweeping Hook. Its supplied mechanics agree with the [Ogre Boss stat block](https://2e.aonprd.com/Monsters.aspx?ID=3120). Ability prose is treated as data for taught handlers, never as instructions to the coding agent.

## Use

Import/use the supplied Ogre Boss actor, place an **unlinked 2×2 token**, add it to combat and select it. Press **Alt+W**. The controls display **Ogre Boss — bruiser, leader**. Save the creature, then Preview or run its active turn.

The same controls manage wolves. The module recognizes the ogre by its source or declared command capability and validates its linked physical hook/javelin attacks and known special abilities. It does not choose this profile for every giant or every NPC whose name contains “boss.”

Boss morale defaults **off** so an ogre boss does not inherit the wolf's flight threshold merely because code is shared. Entertainment preferences, front-line engagement and the first-ability showcase bonus remain available. Enable group morale explicitly if desired.

## Implemented behavior

| Capability | Behavior |
| --- | --- |
| Large movement | Checks the complete 2×2 footprint, clear endpoints, allied passage, wall constraints, native terrain cost and diagonal history. It cannot use a one-cell gap. |
| Hook Strike | Uses its prepared native attack, damage and critical damage, including native deadly/rune effects. Keeps ten-foot reach and can attack without closing to adjacency. |
| Hook Trip | One attack action at the current MAP. Uses the equipped trip weapon through PF2e's native Trip action. Already-prone/ineligible targets are excluded. Prone and critical Trip damage are handled once. |
| Sweeping Hook | An immediate reaction after a successful hook Trip. Uses the ordinary reaction pool, so it competes with Reactive Strike. Its Strike uses the next MAP during the boss's turn and increases MAP for subsequent attacks. A successful final-action Trip can still resolve this zero-action-cost reaction. |
| Bellowing Command | One action. Applies movement-only Quickened to eligible ogre allies who share a language and are not immune to its traits. Per the GM's preference, allies in this scene's combat are treated as hearing it without acoustic, wall, range, elevation, level or silence-effect simulation. The boss does not command itself or grant the effect to non-ogres. Deafened, incapacitated or already-Quickened allies remain ineligible. |
| Javelins | Draw, throw and regrip/stow are explicit choices. Drawing frees a hook hand; throwing consumes one physical javelin. A two-handed hook cannot attack or Reactive Strike while held in one hand. |

Scoring composes these capabilities rather than granting a fixed three-action script. Trip value includes its possible Sweeping Hook follow-up. Command value considers allies who need movement. Distinctive abilities can receive the configured once-per-combat showcase preference; native costs and legal requirements remain unchanged.

The hook's real native Trip can include its weapon item bonus. Attack/check estimates remain approximations using the encounter benchmark rather than enemies' actual base defenses. Since 0.9.1, the separate GM-requested front-line preference reads prepared AC and maximum HP to identify durable characters. PF2e still resolves the actual roll.

## Reactions and MAP

Sweeping Hook is an own-turn reaction Strike, unlike the usual off-turn Reactive Strike. The shared attack ledger therefore counts Trip, Sweeping Hook and later Strikes in sequence. This follows the [multiple attack penalty rule](https://2e.aonprd.com/Rules.aspx?ID=2289). A pending Sweep is persisted for One action/resume and cleared by another action or Correct counts.

Opponent Reactive Strike is offered for ranged attacks and manipulate actions as well as movement. A critical Reactive Strike can disrupt Draw, Stow or Regrip; the action remains spent. Drawing first releases a hook hand as a free action, so interruption can leave the hook one-handed. Ordinary damage, Shield Block and nested effects finish before automation resumes.

Reactive Strike and Sweeping Hook share the same reaction flag. Since **0.9.2**, enabled ogre bosses use off-turn Reactive Strike automatically by default, choosing the ready melee Strike with the highest prepared attack modifier. This follows Dawnsbury's ordinary take-an-eligible-opportunity behavior; it does not reserve the reaction for a hypothetical later Sweep. A one-handed hook remains unavailable. PF2e resolves the real attack, damage and any Shield Block before movement continues. Disable **Use Reactive Strike automatically off turn** in Alt+W to restore prompts during AI turns; manual drag interception then stops for that ogre.

Since **0.9.3**, regripping also has value for future Reactive Strike against a nearby visible enemy within one ogre Stride plus hook reach, when the reaction remains available. This fixes ending a close-range throw turn with the hook unusable merely because no foe is currently in melee reach. Regrip costs a real Interact action and can itself provoke; no off-turn equipment changes are granted. Distant throws can still leave the hook one-handed. Threatened movement then warns once per turn/readiness state, and the shield icon explains the exact weapon or reaction blocker. A hook left one-handed in a saved encounter must be regripped during the ogre's turn before it can react.

Manual ground movement during the mover's combat turn now asks its active owner (or the GM) to choose **Stride** or **Step** when an automated NPC could react along its path. Stride is processed one grid square at a time and reacts before each threatened departure, including entering and later leaving reach. A legal five-foot Step avoids movement reactions. Short drags are never assumed to be Steps. Both choices represent one move action; players still track their manual action expenditure. See [movement settings and limits](reactions-foundry.md#manual-movement-and-step).

Reactions spent manually must still be corrected in reaction controls. Extra/restricted reactions, manual character-sheet manipulate/ranged actions, off-turn manual movement and unsupported movement modes still need manual handling. The existing engine handles manipulate/ranged triggers made by managed AI turns.

## Command effects and restricted actions

The command creates an owned effect that grants Quickened, with text stating that the extra action can only Step or Stride. It expires after the recipient's next turn, taking initiative order into account. End-turn and combat-update cleanup is serialized, combat deletion removes owned command effects, and startup clears orphaned effects whose combat no longer exists. Unrelated Quickened sources are retained.

An automated recipient receives at most one restricted movement action when its new turn ledger is created. It cannot spend that pool on Trip, Strike, Escape, Crawl, another command or drawing equipment. Existing ledgers never gain a retroactive action when a new effect arrives mid-turn, following [Quickened timing](https://2e.aonprd.com/Conditions.aspx?ID=89). Slowed loss can consume the restricted action first, preserving the ordinary actions when possible.

An ogre already Quickened is not buffed again merely to stack actions. A Quickened source with unimplemented restrictions requires manual handling. Ogre allies can receive the command effect even if their own AI profile has not yet been taught; the GM then follows the effect's restriction manually.

Ogre-family identities are loaded from the installed official Monster Core index, preserving recognition of renamed actors by source identity; the supplied legacy Ogre is also recognized. Language, Deafened and immunity checks remain. Since **0.10.1**, Bellowing Command deliberately does not simulate sound propagation or silence effects, per the GM's preference.

## Inventory and data normalization

The export's javelin NPC Strike has `thrown-30` and a linked physical javelin stack but a blank range. Saving/preparing this known profile sets that native attack to a 30-foot increment. Preview does not write the actor. The chooser permits up to six range increments and the native roll handles its actual range penalty.

Draw costs one action and uses a free Release when necessary. The ranged Strike consumes a physical javelin and leaves the throwing hand empty. Regrip costs an action to restore the hook's two-handed use. Stowing an already-held javelin also costs an action. Unknown equipment interactions, unusual hand configurations or inventory changes during an interrupted roll require checking the saved reservation and inventory before resuming.

## Verification and remaining work

Tests use a mechanics-only fixture derived from the supplied export and exercise general controls, footprint, reach, action/MAP/reaction accounting, failed Trip, final-action Sweep, javelin accounting, command eligibility, initiative-sensitive expiry, Slowed, non-stacking effects, unrelated Quickened grants, interruption and cleanup. The previous wolf regressions remain in the full suite. A live running-world multiplayer smoke test is still needed.

This profile does not yet add Demoralize, arbitrary combat maneuvers, spellcasting, full perception, general hazards or every possible communication/size exception. New abilities on a known ogre actor are listed as needing manual handling rather than being inferred from description text.
