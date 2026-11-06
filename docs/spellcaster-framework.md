# Shared caster AI — 0.40.0

NPC spellcasting is a reusable capability rather than a monster-specific spell list. An NPC with native spellcasting entries receives the generic caster fallback when it has no taught creature kit. Existing taught kits also gain the spell capability while retaining their own Strikes, abilities, movement and reactions. The Dero and Goblin Pyro use the same spell library.

Patch **0.40.1** corrects native healing execution and applies tactical score adjustments once. Witnesses remember allied spell attempts, not secret save outcomes. Observed Blindness casts establish a one-minute immunity window; other control casts reduce the estimated incremental value of repeating the same effect. Observed Sustain extends that belief. Memories expire and reset with the encounter or actor reset, including other observers' knowledge of a reset source/target.

Incapacitation valuation mixes normal and improved-save probabilities using an uncertain enemy strength estimate. Witnessed public Strike modifiers supply a rough NPC attack benchmark (modifier minus 10, with two levels of uncertainty); secret/private rolls and actual opposing levels/saves are excluded. Without evidence, the caster's own level supplies the uncertain baseline. This is a tactical heuristic, not Recall Knowledge or guaranteed identification. Native PF2e still resolves actual Incapacitation rules. Brief Blindness success value also considers allied turns before the target's next start and the caster's remaining actions.

Soothe now passes negative damage to native `Actor.applyDamage`, preserving native healing adjustments and the spell origin. The supplied Dero's innate entry explicitly sets auto-heightening to rank 1, so Daze remains rank 1 until the GM changes that native entry setting; its lower rank is not overridden by AI.

Select an unlinked NPC token, open **Alt+W**, save its normal automation preferences and preview/run its turn. No separate caster checkbox is needed for default behavior configurations. If an actor has an explicitly customized component list, enable **Spellcasting** in **Tactics / behaviors**. **Spell AI** opens the shared-definition editor; it is also available on the token toolbar.

## What the engine evaluates

The native spell item supplies cast rank, range, area, damage formulas and heightening, traits, attack modifier and spell DC. The spell definition supplies its effect components, outcome table, resource role, special rules and duration/recovery relationships. Definitions are reused by slug across actors; native numerical values remain specific to each actor.

Candidates account for action cost, action/MAP budget, target count, damage expectation, conditions, persistent damage, existing attempted control, duration, resource scarcity, friendly fire, cover/concealment, sight, reaction exposure and the position needed to cast. Healing compares actual missing allied HP; offensive estimates use encounter benchmarks and apparent combat roles. Melee opponents are estimated stronger in Fortitude, ranged opponents in Reflex, and casters in Will. These are heuristics, not reads of actual opposing saves or hidden outcomes.

The remaining-turn planner compares affordable sequences, including a two-action spell followed by a one-action spell, Sustain or another taught action. It tracks individual native resource pools during forecasts. Generic caster searches bound the action and movement alternatives, retaining a best option for each action cost. This avoids an exponential search through every spell/target/slot combination. One selected action executes, then the AI rebuilds the state.

Spell control, Spell assault, Life drain and Spell support are separate tactical opportunities. A caster can switch between them as visible opportunities, health and remaining resources change. Casts spend native resources before interrupting reactions resolve; interrupted casting keeps its action/resource cost. Reaction prompts remain awaited. Target/path/range changes are checked again after a reaction.

## Spell library

The initial shared library contains 17 named spells:

- Existing components: Ignition, Tangle Vine, Breathe Fire, Grease, Laughing Fit, Stupefy, Blindness, Void Warp and Vampiric Feast.
- New components: Daze, Force Barrage, Grim Tendrils, Phantom Pain, Soothe, Forbidding Ward, Paranoia and Telekinetic Maneuver.

**Dero supports 13 unique spells:** Blindness, Daze, Forbidding Ward, Force Barrage, Grim Tendrils, Laughing Fit, Paranoia, Phantom Pain, Soothe, Stupefy, Telekinetic Maneuver, Vampiric Feast and Void Warp. Its innate and spontaneous entries are scanned together. Cytillesh Stare remains a separate creature ability.

**Nine unique Dero spells remain manual:** Darkness, Levitate, Revealing Light, Nightmare, Rewrite Memory, Detect Magic, Light, Message and Read Aura. The last six chiefly require utility, exploration or narrative decisions. Darkness, Levitate and Revealing Light require additional visibility/movement components. They are not silently approximated by numerical profiles. Light appears twice in the supplied export; these counts refer to unique spell names.

Important resolution details:

- **Force Barrage:** one-, two- and three-action alternatives; one native slot per casting. It rolls independent shard dice, combines them before IWR and currently focuses the shards on one chosen creature. Split-target shard optimization is not implemented.
- **Phantom Pain:** full initial damage on a successful save, full initial damage plus persistent mental damage/Sickened on failure, and Sickened 2 on critical failure. Its unlocked Sickened records the source DC for Retch. Recovering from Sickened ends that cast's remaining effects. Native PF2e/Workbench owns ordinary persistent damage ticks and recovery.
- **Grim Tendrils:** oriented line aiming, Fortitude outcomes and source-owned persistent bleed. Execution affects living creatures actually inside the chosen line; planning uses known positions only.
- **Soothe:** self/allied healing and a native timed +2 status modifier to saves against mental effects. Full-HP targets do not gain artificial healing value.
- **Forbidding Ward:** a distinct ally and enemy, native contextual AC/save modifiers against the selected enemy, and shared one-action Sustain/expiry. Existing casts against that pair suppress redundant recasting.
- **Paranoia:** source-owned changes to ally treatment; critical failure also changes hostile reaction eligibility. It preserves ordinary rational tactics, rather than invoking Confused. The table policy keeps normal faction target priorities for proactive attacks.
- **Telekinetic Maneuver:** currently teaches **Trip**. It uses the native spell attack against Reflex DC, normal MAP, size/prone eligibility and Trip critical outcomes. Disarm, Shove and Reposition variants remain manual.

## Native casting resources

The catalog binds each spell to its actual entry and cast rank. Spontaneous/flexible slots, prepared slot indices, innate uses, at-will spells, cantrips and focus costs are distinct. Signature spells can expose higher ranks where the native entry has slots. The engine does not treat every spell as spontaneous or fabricate an unrestricted common slot pool.

Casting without a melee weapon is supported. A geometry-only reach probe supplies distance calculations; it is not added to the actor and never becomes a Strike candidate. A caster with a prepared melee attack retains that attack as a fallback. Supported targeted spells also participate in aerial attack forecasts; three-dimensional area spell placement remains a separate limitation.

## Teaching another spell

Use **Alt+W → Spell AI**, choose the native spell, edit its shared JSON definition, then save. GM-authored definitions are world settings shared across clients. Native spell descriptions are never executed or treated as instructions. The editor preserves known components when constructing a profile; an unknown non-basic save needs an explicit outcome table.

Simple pattern families include targeted saves, spell attacks, automatic damage, healing, selected multi-target saves and cone/line/burst areas. Outcome order is **critical failure, failure, success, critical success**. Native damage dice/heightening remain on the spell item; multipliers below describe what each result does:

```json
{
  "slug": "example-chill",
  "kind": "save",
  "save": "fortitude",
  "role": "damage",
  "actionCosts": [2],
  "range": 30,
  "outcomes": [
    {"damage": 2, "conditions": [{"slug": "clumsy", "value": 1}], "until": "caster-start"},
    {"damage": 1},
    {"damage": 0.5},
    {"damage": 0}
  ]
}
```

Use the selected item's actual slug. Optional fields include `maxTargets`, `duration` in seconds, `sustained`, outcome-specific durations, `noReactions`/`noActions`, and `until` (`caster-start`, `caster-end`, `target-start`, `target-end`). Valued Stunned uses native action-loss recovery rather than a guessed one-round timer. Persistent components declare type, formula using `@rank`, affected degrees and optional critical doubling. `endOnRecovery` links a cast to a recovery condition.

Sustained generic effects use the same maintenance/end lifecycle; separate repeated benefits on Sustain still need an effect-specific component. Source effects record spell rank and origin. Ending/resetting a cast, expiry or deleting its source removes only its own children. Removing a source does not delete unrelated persistent damage or other condition sources.

The API exposes `game.modules.get('foundry-creature-ai').api.casting.inspect(actor)` for current native descriptors and unresolved spells. Shared authoring helpers are under `api.spells.profiles`: `list`, `inspect`, `construct`, `save` and `open`.

Teaching a numerical pattern does not implement unmodeled riders. Walls, summons, possession, counteracting, custom movement, complex illusions and other unusual mechanics need an additional resolver. Current spell areas use the supported horizontal scene/elevation model; arbitrary elevated burst centers, spherical areas across elevations and volumetric cones are not yet taught. Spell attack activities with multiple independent attacks also need their own MAP/targeting component.

## Manual play and ownership

The shared condition module applies taught save effects for Daze, Phantom Pain, Grim Tendrils and Paranoia, alongside the existing Laughing Fit/Stupefy/Blindness handling. Players still cast and apply initial damage through normal native controls; the save handler applies conditions without rolling a second save or damage. Existing PF2e/Automations workflows continue to own manual healing and buff cards. AI-managed healing and wards use the explicit awaited resolver.

No new duplicate persistent-damage timer is installed. Prepared modifiers, IWR, immunity and save adjustments remain native. The Conditions module owns source effects/recovery/expiry; Creature AI owns choice and forecasts. The spell library and authoring data are shared services, and manual modules have no dependency on NPC decision code.
