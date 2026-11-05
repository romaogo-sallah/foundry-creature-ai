# Creature AI reactions

For Foundry 14 / PF2e 8.6.1, the engine supports standard Shield Block and Reactive Strike, including legacy Attack of Opportunity, during managed NPC turns. Version **0.9.2** also automates the Ogre Boss's off-turn Reactive Strike and handles threatened manual ground movement during the mover's combat turn. Manual character-sheet attacks, spells and Interact actions still need manual reaction handling.

## Manual movement and Step

1. Save an Ogre Boss through **Alt+W**. **Use Reactive Strike automatically off turn** defaults on, including for bosses already saved before this update. It is independent of automatic turn starts.
2. Leave the world setting **Manual movement reactions** enabled under Configure Settings → Foundry Creature AI. All connected clients must reload after installing the update.
3. During a character's turn, drag, use the keyboard, or submit native API walking along a path threatened by an available automated NPC reaction. The original movement is cancelled before the token changes squares. The active owner receives **Stride — allow reactions**, an eligible **Step — avoid movement reactions**, and **Cancel movement**.
4. Stride resolves through native movement one square at a time, preserving user waypoints and corners. Reactions occur before leaving a threatened square. The GM rolls automated NPC attacks and applies damage; player Shield Block decisions still wait for their owner. Lethal damage or new movement restrictions stop the path.
5. Step is available for one adjacent five-foot ground movement, with Speed at least 10 feet and no unsupported terrain. Native walk mode alone never implies Step. Since **0.10.3**, Define Surface geometry is handled by native constraints and does not automatically disable Step. Other active scene Region behaviors conservatively disable Step because special terrain exemptions are not taught.

Choose one move action per drag (up to the current land Speed for Stride). The module does not deduct actions from manually played characters. It pauses AI execution and automatic turn advancement until the movement/reaction workflow resolves. Cancel keeps the token at the origin; Pause/Stop also cancels subsequent automation. Native walls and movement constraints still apply during replay. GM and player movement use the same active-GM execution path; remote requests require ownership and a matching combat turn, scene and origin.

This handler covers snapped walking on a five-foot square grid, without changing elevation or level, during that combatant's turn. Flight, swimming, Crawl, difficult-terrain Step exceptions, off-turn moves, forced movement and teleports require manual resolution. Native displace/teleport and undo are excluded. Turn off **Manual movement reactions** while resolving a special movement workflow. Known automated AI movement is tagged so it cannot be intercepted or reacted to twice.

Reactive Strike shares the ordinary reaction with Sweeping Hook. The automatic policy takes an eligible off-turn opportunity with the strongest ready melee attack; it does not reserve that reaction for later abilities. A spent reaction cannot be used twice, and a one-handed ogre hook cannot react. **Apply damage automatically** on the reacting NPC is respected; rolls-only hits leave the mover in place and ask the GM to apply the rolled damage before continuing manually.

## Enable and use

1. After installation, all connected users reload Foundry with **Ctrl+F5**.
2. As GM, select a configured wolf, open **Alt+W**, enable **Prompt for Shield Block and Reactive Strike**, and save. This replaces the old **Pause move actions inside enemy reach** checkbox and retains its saved value. If you previously unchecked the old pause, enable the new checkbox.
3. For Shield Block, keep **Apply damage automatically** checked. The player must have the standard Shield Block ability and a raised, usable physical shield. Reactive Strike requires its ability and a ready melee Strike with reach to the mover. Add reacting creatures to combat.
4. The active owner receives a dialog. Choose **Shield Block**, a melee weapon for **Reactive Strike**, **Pass**, or **Pause automation**. Pass keeps the reaction available. Closing the dialog pauses automation.
5. The active GM executes accepted reactions through PF2e's roll and damage APIs. With no active non-GM owner, the GM receives the prompt. When multiple owners are active, the assigned character's owner is preferred, then one owner by user ID. One user is prompted for each decision.

The GM receives a waiting notification for remote prompts. A disconnected or timed-out owner can fall back to a GM decision. A closed prompt never silently counts as Pass. Remote prompts use Foundry's authenticated `User.query` interface; socketlib is unnecessary. Player clients accept prompts only from the active GM for a creature they own.

Every AI runner shares a reaction wait. While a decision is pending, the wolf cannot continue movement, make another attack, or advance the turn. Accepting a reaction keeps that wait active through the roll, native damage/shield updates, and any nested Shield Block. A queued AI run also waits. The wait releases only when all reaction processing finishes. This pauses AI execution without toggling Foundry's global game pause, so players can resolve their reactions.

## Shield Block

After the attack and damage rolls resolve, the handler checks for positive, nonpersistent bludgeoning, piercing or slashing damage, the Shield Block ability, a raised usable shield, and an available ordinary reaction. It asks before applying damage. A raised shield alone does not grant the ability. These prerequisites follow [Shield Block](https://2e.aonprd.com/Feats.aspx?ID=5212).

Accepting reserves the reaction before calling PF2e's native `ActorPF2e.applyDamage` with `shieldBlockRequest: true`. The system handles IWR, Hardness, damage to the shield, damage to the character, and shield breakage. The engine confirms the reservation after that call completes. It does not independently subtract Hardness or apply a second damage roll.

The prompt displays the rolled damage before IWR. It does not predict target-specific mitigation; the owner can Pass if the attack is fully resisted or immune. Spell shields, Shield Warden, and extra or restricted Shield Block reactions require separate handlers. In rolls-only mode, the existing manual damage workflow handles Shield Block instead of this prompt engine.

## Reactive Strike

The handler checks enemy combatants throughout the viewed scene, whether or not the wolf was assigned to attack them. It requires Reactive Strike or legacy Attack of Opportunity, an ordinary reaction, and a ready melee weapon or unarmed Strike whose actual weapon reach covers the triggering square. Ranged-only or unequipped options are not offered. Line of sight, elevation and scene level must match. Hidden or concealed movers and blinded reactors require manual handling.

A Stride checks each departure from a threatened square, including entering an enemy's reach and then leaving a square later in that same path. Merely arriving in reach without leaving a threatened square does not trigger the prompt. When an enemy might react, movement advances through the planned grid waypoints, waiting for each animation and each reaction decision. All segments remain one Stride with one action cost and one Speed budget. Each reacting creature is asked once per move action.

Stand removes Prone and verifies the update first, then offers the reaction. This follows the timing for [move actions that trigger reactions](https://2e.aonprd.com/Rules.aspx?ID=446): an action that stays in its square triggers at its end.

The owner chooses a valid melee Strike. The engine uses the first attack variant without MAP, rolls damage once on a hit, and applies it once in automatic-damage mode. It does not alter the wolf's attack count. A normal Reactive Strike critical hit does not automatically disrupt a move action; the standard action's disruption clause concerns manipulate triggers. See [Reactive Strike](https://2e.aonprd.com/Actions.aspx?ID=2256).

Lethal damage, a new movement-blocking condition, a changed position, or a cancelled decision stops further movement. In rolls-only mode, a damaging reaction pauses for the GM to apply damage. Special feats that modify reaction triggers or disruption need their own handlers. Standard manipulate and ranged triggers are also handled when executed by this module's NPC turns; manual character-sheet actions remain outside automatic trigger detection.

A mover that dies, reaches 0 HP, becomes dying or unconscious, or is marked defeated completes its NPC turn after the reaction resolves. This keeps the reaction confirmed and allows automatic turn passing when enabled, even with unused actions or in One action mode. It does not invoke the global reaction-pause callback or stop the next automated creature. Temporary movement restrictions and explicit Pause decisions still pause for manual handling. A turn already advanced by another module is not advanced a second time.

## Reaction counts and interruptions

The engine stores one ordinary reaction on the reacting actor. It refreshes at that creature's turn, rather than at the start of the next round. Shield Block and Reactive Strike share the count. The first pre-turn reaction is available by default; the GM can mark it spent if the encounter's opening circumstances prevent it. Minions and incapacitated or defeated creatures are excluded.

Select a combatant and click the **shield icon** in the token toolbar to mark its reaction spent or available. Use this when a reaction was spent manually, or after checking an interrupted reaction.

Since **0.9.3**, these controls also show **Current Reactive Strike check**: the ability, reaction budget, ready melee attacks, and missing equipment requirements. A two-handed ogre hook held in one hand after a javelin throw cannot react. Movement near such an ogre displays the reason once per turn/readiness state without blocking ordinary movement or granting an illegal free regrip. The boss can spend an action to prepare the hook on its own turn when enemies are nearby.

The same controls show **Current Shield Block check**: whether the ability was found, whether a physical shield is equipped and raised, and whether the reaction is available. If an automated damage check has run since the GM's last reload, **Last incoming damage** shows the rolled amount and the reason a prompt was skipped, passed, or accepted. Current state and the last attack's state can differ after turns or equipment change. If Reactive Strike already spent the ordinary reaction, Shield Block remains unavailable until its next refresh; the interface names that reason. Do not mark a legitimately spent reaction available to obtain a second reaction.

Ability detection accepts explicit slugs, PF2e's prepared item roll options, and the standard Shield Block compendium source identity. This handles nullable slugs and renamed or translated copies whose source identity is preserved. A related feat such as Quick Shield Block alone does not grant the base Shield Block ability.

The active GM can also call:

```javascript
const reactions = game.modules.get('foundry-creature-ai').api.reactions;
await reactions.openControls();
// After selecting the relevant token and checking its actual spent reaction:
await reactions.setSpent(canvas.tokens.controlled[0], true);
```

The engine reserves reactions before rolling or applying damage. An interrupted reaction remains spent and uncertain until checked; reloads cannot grant it again during the same reaction cycle. Extra reactions from feats, restricted reactions, Ready, and reactions spent through other modules are not automatically counted.

**Alt+Shift+W** cancels further automated actions and pending decisions. Changes to the combat turn, active GM, pause state, ownership, or trigger invalidate pending responses. A late response cannot roll a reaction or resume an old turn. A Stride already started remains spent at the reached square if paused. A paused Shield Block decision leaves the incoming rolled damage unapplied: resolve it manually, then correct the wolf's action counts. Do not rerun the incoming Strike to apply that same damage.

Choosing **Pause automation**, closing a prompt, or encountering a reaction error stops all AI runners and subsequent automatic starts. A manual run or saving an automatic-start configuration resumes starts after the GM has resolved pending effects. Stop can cancel an AI runner waiting behind another reaction without spending a new action.

## Verification

Automated tests cover eligibility, owner selection, authenticated query handling, disconnection, timeout, stale replies, ordinary reaction refresh, shared budgets, duplicate requests, cancellation, interrupted rolls, native damage options, correct Stand timing, threatened departures along a path, and lethal reactions stopping movement. Foundry/PF2e documents and remote clients are simulated in these tests; the installed native square grid is also exercised by the movement suite. A live GM-plus-player test has not yet been performed.

Additional blocking tests deliberately leave reaction decisions, rolls and native damage updates unresolved. They verify that movement, further Strikes, queued AI runs and `nextTurn` cannot proceed until resolution, including a reaction opened while turn advancement is being reserved.

For a live check, first use a disposable encounter with a wolf and an owned character with a raised shield and Shield Block. Test Use and Pass, checking actor and shield HP once each. Then give the character Reactive Strike, start the wolf prone in melee reach and test Stand, followed by a path that enters and leaves reach. Verify the player receives one prompt, the wolf waits, the reaction uses no MAP, and a spent reaction stays unavailable until the character's next turn.

Implementation interfaces were checked against the installed PF2e 8.6.1 bundle and the Foundry 14 [User.query](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#query) and [DialogV2.wait](https://foundryvtt.com/api/v14/classes/foundry.applications.api.DialogV2.html#wait) APIs.
