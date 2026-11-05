# AI pace, intent and roll privacy — 0.19.1

Reload every client with **Ctrl+F5** after installing. Open **Configure Settings → Module Settings → Foundry Creature AI**.

| Setting | Default | Effect |
| --- | --- | --- |
| AI pause before acting (seconds) | 1.5 | Show intent, then wait before reserving or executing the action. |
| AI pause after an action (seconds) | 0.75 | Let players follow its result before the next action or automatic turn advancement. |
| AI intent messages | Speech bubbles for players | Choose public bubbles, GM-only text, or Off. |
| Automated NPC roll visibility | Use the normal roll visibility | Choose GM only to whisper managed NPC rolls to GMs. |
| Suppress Dice So Nice for AI-controlled NPCs | Off | Skip 3D animations for rolls from enabled AI NPC tokens and managed NPC rolls, including reactions. |

The pauses range from 0 to 5 seconds. Set both to 0 for immediate execution. Turning intent Off disables its text while retaining configured pauses. Normal native animations, movement, reaction prompts and damage must still finish before execution continues.

These settings apply to **Run turn**, **One action**, automatic turn starts, and the Ogre Boss's automated off-turn Reactive Strike. Preview remains immediate and produces no intent bubble. A queued Sweeping Hook is presented as its own action. Manually chosen player reactions keep their existing prompts.

## Intent

The native token bubble shows a short description of the selected action. For example:

- Wolf pack attack: “A sharp bark; the wolf closes in with its pack.”
- Wolf Knockdown: “The wolf snaps low, trying to drag its prey off its feet.”
- Ogre Trip: “On your back! Then you get the hook.”
- Kobold Hide: “Lose sight of me, and you will regret it.”
- Retreat: “This fight is lost. Get out while we can!”

The templates follow the chosen action and supported tactical context: flanking, joining the pack, pursuing a last-known square, creating room to shoot, recovery, weapons, command, or retreat. They do not invent a “weakest target” justification when the decision did not establish it, claim an unsupported ability, or reveal numeric AC/HP/DC values. Repeated attacks have simple variation without consuming randomness used by the AI chooser.

Public messages use native synchronized bubbles with visibility required and camera panning disabled. Enable Foundry's core **Chat Bubbles** preference to see them. GM-only messages use a local bubble on the active GM's client and a GM-whispered chat entry; private text is never broadcast through the public bubble socket. GM-hidden, invisible, hidden, or undetected speakers automatically use the GM-only route, including when detection differs between observers. Other GMs can read the whispered entry.

These messages explain an intended action; they do not create speech actions, simulate sound/language, or alter stealth. Wolves use nonverbal descriptions. An intention can become unavailable during the pause; it is revalidated before spending the action. Rendering failures are logged without stopping a valid turn.

## Stop and reactions

**Stop Creature AI** cancels the wait. During the pre-action pause, no action, MAP, ammunition or reaction has been reserved yet. The runner checks its turn and the live action again after waiting. A reaction prompt opened during that interval must resolve before the action proceeds.

The post-action pause happens after the result and its ledger are resolved. Stopping then preserves the already spent action without starting another one. Turn, scene, GM or pause changes prevent continuing a stale action. Automated Reactive Strike holds the shared reaction barrier through its intent, roll, damage and result pause, so the moving character cannot leave first.

## Private NPC rolls

**Automated NPC roll visibility → GM only** applies to managed NPC attack, damage, skill and flat-check chat messages, including automated NPC reactions. It preserves native rolls and damage application while setting GM recipients and blind visibility before message creation. Ordinary player rolls and character Stealth retain their existing visibility. Private rolls remain separate from narration: public intent with private rolls, or private intent with normal rolls, are both supported.

HP changes, native effects and the information needed by reaction prompts still occur normally. Existing detailed AI decision reports already whisper to GMs and remain available through **Last decision**.

## Dice So Nice

Enable **Suppress Dice So Nice for AI-controlled NPCs** in the module's world settings to suppress their 3D dice on all clients. This includes ordinary rolls made from an NPC token enabled in Creature AI and AI-managed NPC attack, damage, skill, flat-check and reaction messages. Character rolls and NPCs outside Creature AI keep their normal animation behavior.

The integration sets Dice So Nice's supported `flags.dice-so-nice.skip` message flag before creation. It does not alter dice, chat cards, chat visibility, action pacing, damage or reaction handling, and it does not change Dice So Nice's global settings. Dice So Nice is optional. The setting defaults Off and affects new messages; existing messages retain their existing flags. Reload every client with **Ctrl+F5** after installing the update; subsequent changes to the setting apply without another reload.
