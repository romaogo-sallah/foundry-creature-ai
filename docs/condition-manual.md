# Manual character automation — 0.35.0

Reload all clients with **Ctrl+F5**. These controls apply to supported native PF2e actions while players continue to track their ordinary action expenditure.

## Movement

Choose **Step** or **Sneak** from the token's normal Foundry movement-mode menu. Normal Walk means Stride. The former Stride/Sneak/Step popup is removed. Step validates one 5-foot square, Speed of at least 10 feet, native terrain cost and supported scene terrain; it avoids movement reactions. Sneak validates the native path cost against half Speed, or full Speed with Swift/Legendary Sneak, then uses the existing per-observer Stealth and endpoint-protection rules. Invalid paths stop without a roll or movement.

Selecting Sneak synchronizes the removable Sneak effect with the native menu choice. Starting Sneak from the sheet/stealth controls selects that mode too. Choosing another mode removes the Sneak mode effect without itself revealing the character; Step can preserve Hidden while Stride reveals before movement. Previously armed Sneak remains compatible during migration. Reaction prompts, including Shield Block, still pause movement and AI until resolved.

The shared movement guard also prevents voluntary movement while Immobilized, Grabbed or Restrained. Prone permits Crawl and Stand, rather than letting another movement mode bypass the restriction. Forced displacement and explicit teleport/undo placement keep their existing workflow. From 0.36.2, automatic manual Sneak supports both PC and NPC creature tokens; managed AI Sneak retains its own lifecycle.

## Conditions and recovery

The **Condition actions / sources** heart-pulse toolbar button opens a compact dialog for the selected owned creature. The GM can record Sickened's original source DC and the subject of Fascinated. Players can Retch when the source is configured, or resolve valued Stunned by entering the actions they actually have left after completing their current activity. These requests use Foundry's authenticated user-query transport, active-GM ownership checks and the shared reaction barrier. During combat recovery actions require the creature's active turn. For Stunned, count restricted extra actions too and lose those first when appropriate.

Native action rolls, spellcasting entries and actual-use item cards check Restrained and Fascinated legality. Spell legality is checked before native slot consumption. Sickened ingestion is blocked at native Consumable.consume, before the potion/elixir quantity changes. Paralyzed Recall Knowledge and purely mental supported Sustain are exempt from the blanket physical-action restriction; compulsory saves and passive checks remain available.

When PF2e Automations has its flat-check feature enabled, its manual item/spell-card checks remain the owner. When that feature is disabled, Creature AI resolves the supported condition flat checks before posting an actual-use card or resolving a supported skill action. A failed casting check can suppress the spell card after the native spellcasting entry has already spent its slot; the action and resource remain spent. This does not add automatic damage or another saving throw. Managed NPC casting always keeps its own awaited checks.

Fascinated concentration can target the recorded subject; intended consequences not represented by that target need GM adjudication. Ordinary unlocked Fascinated ends after a native targeted Strike against the creature or an ally, and before supported targeted hostile AI actions. Locked/granted spell sources and unusual hostile spell effects remain with the source resolver. The GM can mark an exception with `flags.foundry-creature-ai.ignoreHostileAction` on the condition.

## Module ownership

**Prevent duplicate condition automation** defaults on. If both modules reduce Frightened, Creature AI keeps PF2e Automations as the owner and disables Workbench's duplicate *client* preference on each loading client. Its previous value is saved in the client setting `foundry-creature-ai.conditionAutomationBackup`. Workbench's Stunned, persistent damage and recovery settings are preserved. Turning compatibility management off stops future preference changes; restore a previous preference in Workbench settings if changing ownership deliberately. The API `game.modules.get('foundry-creature-ai').api.conditions.owners()` reports current owners.

Existing Toolbelt save messages and PF2e Automations spell rules continue their normal workflow. Creature AI's explicit Laughing Fit/Stupefy/Blindness handler owns only its supported saves and source-tracked durations. It does not infer arbitrary spell outcomes or remove an entire parent effect to clear a locked condition. From 0.37.0, Confused denies reactions in supported manual controls and uses a random-target attack strategy for AI NPC turns. It does not take over PC turns. Generic manual action counting, overlapping Confused/Fleeing/Controlled precedence, effect-specific exceptions and untaught spell outcomes remain GM responsibilities.
