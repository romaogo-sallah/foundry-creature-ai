# Reset selected actors to prototype state

Requires Creature AI **0.22.1** and the active GM. Reload Foundry with **Ctrl+F5** after installation.

1. Create a Foundry macro and set its type to **Script**.
2. Paste the contents of `macros/reset-selected-actors.js` from the installed module into its command and save. Alternatively, right-click a macro in the Macro Directory, choose **Import Data**, and import `macros/reset-selected-actors.json`.
3. Select the tokens you want to reset, then run the macro.

The module lives in `FoundryVTT/Data/modules/foundry-creature-ai`. Source files are also in `module/macros` in the development workspace; the build creates the importable JSON in `dist/foundry-creature-ai/macros`.

The baseline is the token's **current sidebar/world actor**, not a compendium entry or a snapshot from the start of combat. HP and resource values return to whatever is saved on that actor, even if those values are below their maximum. Set up the sidebar actor with the HP, ammunition and equipment you want for new encounters.

The macro uses Foundry's persistent `ActorDelta.restore()`. It replaces **all token-specific actor overrides** with that baseline: HP/temp HP, resources, ammunition and other inventory (including deleted stacks), spell slots, expended abilities, item uses, equipment and conditions/effects. Token-specific added items or stat edits are also discarded. The sidebar actor itself is unchanged.

It preserves token position, elevation, appearance/name and saved AI preferences/targets. The resource preferences for crossbow loading and an ogre's abstract Refuse supply come from the sidebar actor's **Prototype Token** AI flags; absent those, their defaults are loaded and zero Refuse. For example, set an ogre's prototype supply in the GM console with its sidebar actor ID:

```js
await game.actors.get('ACTOR_ID').prototypeToken.update({
  'flags.foundry-creature-ai.config.refuseCount': 6,
});
```

Old AI actions, movement/focus/target memory, stealth checks, spent reactions and retreat state are cleared. Combatant defeated markers are updated from the restored actor; affected pack morale records are cleared. Other observers lose only their knowledge about reset actors. Zone indicators are recalculated at the tokens' existing positions, so concealment from a zone can immediately return.

AI is paused after a reset. Use **Run turn**, re-save automatic controls, or run **Enable full auto for selected NPCs** when ready to resume. The full-auto macro is available as `macros/enable-selected-full-auto.js` and importable `macros/enable-selected-full-auto.json` from version 0.33.1. It enables AI, acting at turn start and automatic passing without immediately executing a turn. Combat round, initiative and tracker position are not restarted. The reset refuses to run while an AI action, managed movement or reaction prompt is resolving. Stop AI, finish the current prompt/action, then retry.

Linked tokens are skipped: their actor is already the sidebar actor, so there is no independent earlier state to recover. Tokens whose sidebar actors were deleted are also skipped. Each skipped or failed token is reported. The script never automatically selects or resets the rest of the scene.

The same reset is available to a GM through the console:

```js
await game.modules.get('foundry-creature-ai').api.resetActors();
```

This returns `{restored, skipped, errors}`. Only running the macro/API performs a reset; installing or reloading the module does not change actors.
