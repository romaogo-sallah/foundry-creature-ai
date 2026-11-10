# Foundry creature AI

**Version 0.43.5:** Translocate rejects destinations beyond movement-blocking terrain-wall boundaries and checks the caster's whole body against walls, ice walls, surfaces and occupied space. Planner, pre-cast and post-reaction checks share the same destination rules. [Cause and placement policy](docs/teleport-destinations.md). Reload clients with **Ctrl+F5**.

**Version 0.43.4:** vampire bat forms and native battle forms cannot cast spells unless explicitly permitted. AI forecasts and manual casting share the restriction, preserve unspent resources on stale choices, and allow ordinary polymorph disguises. [Rules and scope](docs/polymorph-casting.md). Reload clients with **Ctrl+F5**.

**Version 0.43.3:** casters compare Fly with Climb when trapped in a pit, budget casting plus the escape move, and use native flight paths to ascend through the opening onto a clear bank. Existing flyers prioritize leaving the pit before resuming ordinary combat tactics. [Pit details](docs/pits.md). Reload clients with **Ctrl+F5**.

**Version 0.43.2:** persistent spell areas remain visible while controlling tokens. Clouds, smoke, blizzards and ice walls now use the same native visibility as Grease and fire. Existing layer-only spell zones update when viewed by the active GM; hidden and explicitly restricted zones retain their visibility. Reload clients with **Ctrl+F5**.

**Version 0.43.1:** fixes Frightful Presence immunity persistence, invalid Dispel retries, nonliving spell targets, indefinite caster waiting and animation-sensitive pit jumps. Adds guarded recovery for missed Mist Escape turns. [Details and verification](docs/combat-fixes-0.43.1.md). Reload clients with **Ctrl+F5** after installing the suite.

**Version 0.42.0:** teaches the supplied [Young Cinder Dragons and Lich](docs/cinder-dragon-and-lich.md), their distinct martial/caster kits, shared Counterspell, Siphon Life, Frightful Presence, 3D areas and sixteen additional spell components. Adds editable [pits, Climb and crossing jumps](docs/pits.md) for manual play and AI, including the two marked Stadium pits. Fixes restricted retreat movement and unaffordable Strike follow-up scoring. Restart Foundry to discover the Pit behavior type, then reload clients with **Ctrl+F5**.

**Patch 0.41.2:** fixes lethal Vision of Death and Drained-5 Drink Blood trying to create a nonexistent Dead condition. Native death status is preserved and the spell action can finish normally. Failed Grab reports now state the outcome. The [completed vampire review](docs/battle-analysis-2026-11-07-vampires-finished.md) records 16/21 Mastermind spell coverage, good area targeting and remaining retreat/caster-planning weaknesses. Reload every client with **Ctrl+F5**.

**Patch 0.41.1:** fixes grounded vampires selecting End Turn with an action left and never auto-passing. The flight component now preserves the ordinary caster?s completion policy. The [first vampire encounter review](docs/battle-analysis-2026-11-07-vampires.md) separates the confirmed deadlock from movement/scoring weaknesses and legitimate concealment failures. Reload every client with **Ctrl+F5**.

**Version 0.41.0:** adds the supplied [Vampire Guardian, Count and Mastermind](docs/vampires.md), independent mixed-group resources, Claw/Grab/Drink Blood, at-will Dominate, group buffs, lingering fire, native Fire Shield, bonded recasting and Mist Escape toward scene borders. GM controls mark sunlight, stakes and actual coffin rest. Reload every client with **Ctrl+F5**, then select an unlinked vampire and open **Alt+W**.

**Patch 0.40.1:** fixes Soothe dealing damage instead of healing, shares witnessed spell attempts to avoid known temporary immunity and redundant control, estimates Incapacitation from public combat evidence, values brief Blindness by initiative timing, and applies tactical bonuses once. Healing was checked against native PF2e with detached actors. See the [caster battle review](docs/battle-analysis-2026-11-06-casters.md). Reload every client with **Ctrl+F5**.

**Version 0.40.0:** adds the [shared caster framework](docs/spellcaster-framework.md): reusable spell definitions, automatic caster discovery and spell components for taught martial kits, native prepared/spontaneous/innate/focus resources, bounded multi-action planning, healing/support tactics and **Alt+W → Spell AI** authoring. Dero now uses 13 unique spells from a shared 17-spell library. Complex unresolved spells remain listed for manual use. Reload every client with **Ctrl+F5**.

**Version 0.39.0:** applies the table's [condition precedence](docs/condition-precedence.md): Fleeing overrides Confused, which overrides Controlled. A shared escape driver uses ground movement or flight; lower conditions retain their other effects. New Fascinated sources replace older fascination while preserving unrelated source effects. Reload every client with **Ctrl+F5**.

**Version 0.38.0:** teaches the Dero Magister Vampiric Feast with native Fortitude saves, void damage and source-tracked one-minute temporary HP based on actual post-resistance damage. Casters compare Spell control, Spell assault and Life drain opportunities, including affordable approaches and known casting reactions at the destination. Damage spells no longer inherit the control-spell retry cooldown. Reload every client with **Ctrl+F5**.

**Patch 0.37.3:** fixes wounded NPCs holding still under ranged fire because their retreat stopped at 30 feet. Avoiding now weighs known weapon range, blocked firing lines, cover and movement risk, and prioritizes an available safer retreat over unnecessary weapon preparation. Tactical captions have their own cached text object beside the native elevation tooltip, eliminating competing text writes with Global Auto Level Change. Reload every client with **Ctrl+F5**.

**Patch 0.37.2:** restores stealth, cover and concealment captions when Global Auto Level Change overwrites token tooltip text. A batched post-refresh repair preserves the module's elevation display and appends cached observer-relative captions without additional geometry or render loops. Select one observer token and reload every client with **Ctrl+F5**.

**Patch 0.37.1:** fixes overlapping turn/time hooks deleting the same ongoing spell effect twice (`Item does not exist`). Spell application, Sustain, End, Reset and expiry share a mutation queue; manual and unrelated effects are preserved. Movement memory reads native action configuration without invoking Foundry's deprecated teleport getter. Reload every client with **Ctrl+F5**.

**Version 0.37.0:** Confused NPCs use a random-target attack override: allies and neutrals become potential targets, with ordinary Strikes, taught offensive cantrips and simple attack preparation/movement. Normal tactics, stealth, special abilities, complex aerial plans and slot spells are excluded. See [Confused AI](docs/confused-ai.md). Reload every client with **Ctrl+F5**.

**Version 0.36.2:** fixes Sneak missing from NPC movement menus. Manual Hide/Sneak now supports creature tokens, including NPCs, with the same secret checks, movement budget, removable effect and observer rules. Managed AI actions keep their existing lifecycle. Reload clients with **Ctrl+F5**.

**Version 0.36.1:** adds a native **Ramp / stairs** Region behavior and GM helper in the Movement module. Set lower/upper elevation and uphill direction; walking follows the Region shape, including native platforms created manually. Existing scene ramps remain supported. See [manual ramp instructions](docs/ramps.md).

**Version 0.36.0:** the [modular suite](docs/modular-suite.md) separates Core, Environment, Conditions & Spells, Movement and Creature AI. Manual rules work with AI disabled. Movement owns Step, Sneak and flight costs, including doubled upward diagonals and half-cost downward diagonals. Install the complete suite archive, restart Foundry to discover the packages, enable dependencies and reload clients. Existing flags, shared settings and owned Regions migrate without resetting actors.

**Patch 0.31.1:** fixes a threatened melee flyer choosing Hover → End Turn because known reaction risk outweighed every escape climb. Reaching a safe destination now receives its full escape value at the start of the turn as well. Reactive Strike prompts and action costs remain intact. Complete turn tests cover Eagle Dive against an airborne Large target, staging then attacking next turn, scorpion-tail Stinger/venom against a flyer and quill-tail ranged attacks against a flyer. Reload all clients with **Ctrl+F5** and confirm **Running code 0.31.1**.

**Version 0.31.0:** adds the [quill-tail Manticore](docs/manticore-quill.md), airborne ranged tactics, one-action split/pinning Spike Volley, a persistent 12-spike supply and automatic NPC Escape from pins. Shared flight crosses open scene levels; physical surfaces define ceilings. Ranged flyers preserve safe firing altitude and worker proposals retain lateral escapes under low ceilings. Reload **all clients with Ctrl+F5** and confirm **Running code 0.31.0**. [Tests](docs/testing.md) now use configurable isolated parallel processes and faster worker-backed flight groups: `npm test`, or `npm test -- --jobs 4`.

**Version 0.30.0:** adds the supplied [scorpion-tail Manticore](docs/manticore-scorpion.md): shared Fly → native Strike → Fly passes, reach-10 Stinger, Jaws, agile Claw and staged venom. Native Fortitude saves, poison damage/IWR and owned Enfeebled effects resolve on exposure and poisoned combatants’ turn ends. Flight workers retain melee approaches as well as high-altitude staging routes. Reload **all clients with Ctrl+F5**, select the imported Manticore and open **Alt+W**; confirm **Running code 0.30.0**.

**Version 0.29.0:** background Web Worker flight search and Dive setup ranking, with a bounded shortlist checked by native Foundry geometry and movement costs. Cancellation and stale-result guards protect action reservations; automatic and explicit native fallback remain available. Reload **all clients with Ctrl+F5** and confirm **Running code 0.29.0**. See [flight worker](docs/flight-worker.md) and [Git / rollback](docs/version-control.md).

**Version 0.28.3:** Eagles prepare a complete **Eagle Dive (two actions) → Fly to safety (one action)** turn and preserve that useful activity goal instead of substituting a short Fly/Beak pass. Ground creatures with no answer to known enemies above melee reach use **Lay low**: take protection, Hide, Sneak to gain an estimated defensive Undetected advantage, then hold until circumstances change. Secret results remain separate from planning. Reload **all clients with Ctrl+F5** and confirm **Running code 0.28.3**. See [Eagle and shared flight](docs/eagle-flight.md) and [tactics](docs/tactics-and-components.md).

**Version 0.28.0:** teaches the imported Eagle to take off, approach with its 60-foot Fly speed, attack in the air and use Eagle Dive. Shared flight provides bounded 3D routes, native wall/surface checks, upward difficult-terrain cost, half-cost straight descent and hover maintenance. Targets and Reactive Strikes use native 3D reach across elevations. Falls use native damage and an available Arrest a Fall reaction. Ground Steps/Strides are suppressed while flight is available.

**Version 0.27.0:** adds owned platform surfaces and walking ramps. Native ground movement follows configured ramp profiles, reaches deck height at the exact edge and preserves native collision, costs and manual movement/reaction handling. Raised deck edges require a ramp or a separately resolved jump/climb/fall. Flying, forced displacement, undo and unrelated geometry remain native. Ground-only AI planning avoids routes that would unexpectedly change height; full vertical AI and flight planning are subsequent work. Reload every client with **Ctrl+F5** and confirm **Running code 0.27.0**.

**Patch 0.26.3:** AI spell Regions skip Toolbelt's targeting/placement dialog and do not open their configuration sheets. After a native stopped or shortened movement action, AI retains the spent action, rebuilds its choices from the actual position and continues the turn. Explicit Stop, game pause, unresolved reactions, manual damage and One action mode retain their existing pause behavior. Reload all clients with **Ctrl+F5** and confirm **Running code 0.26.3**.

**Patch 0.26.2:** fixes successful Balance moves stopping at Region boundaries. Foundry continues these moves with new update options; the manual movement handler now recognizes the same native movement chain and preserves its resolved-action/Sneak markers. It does not request a second action, reroll Balance, or reject native boundary coordinates as a new unsnapped drag. Fresh drags still receive normal checks. Reload every client with **Ctrl+F5** and confirm **Running code 0.26.2**. See the [Ogre movement investigation](docs/grease-movement-investigation-2026-11-05.md).

**Patch 0.26.1:** repairs Grease falls at Region boundaries. Interrupted landings snap inward to a legal grid placement on Grease, preserving the actual travelled distance and spending no extra action. Critical Balance failure replays the legal path only to the entry square before applying Prone and ending the automated turn. Manual movement uses the same landing repair; genuine wall stops, reaction cancellation and death still stop movement. Reload all clients with **Ctrl+F5** and confirm **Running code 0.26.1**.

**Version 0.26.0:** adds [tactical plans and actor behavior components](docs/tactics-and-components.md). The shared selector chooses aggressive, defensive, avoiding, kiting, hiding, charge, swarming or supporting goals from the known battlefield. Actor configuration is inherited with token overrides. Stand/Escape/Seek, prepared Strike providers, Hide and Sneak can be reused; unfamiliar NPCs with prepared melee Strikes receive a basic kit. Alt+W adds **Tactics / behaviors**, and explanations show the selected goal and active components. Unique abilities and untaught spell lists still need handlers.

**Version 0.25.0:** Goblin Pyros prefer defensive setup against approaching melee foes: nearby cover/concealment, automatic secret Hide, and preemptive Grease on a clear approach lane. Prepared casters can wait and auto-pass their turns instead of walking forward just to unlock a cantrip. Beliefs do not read secret Hide results; active prepared Grease prevents repeated empty-ground casts. After two quiet setup turns, cautious approach is allowed to avoid a standoff.

**Version 0.24.0:** applies the [caster investigation](docs/dawnsbury-caster-ai-findings.md) to Goblin Pyro decisions. Compare casting now, moving then casting, and casting then retreating using affordable actions and MAP. Retreat preferences are bounded; Grease charges for restricting prone allies; movement control considers observed/remembered weapon roles. Slot conservation weakens as the caster loses its own HP.

**Patch 0.23.2:** fixes token dragging/path previews crashing in the Grease terrain hook. Foundry passes a TokenDocument into `_getTerrainEffects`; the hook now accepts both documents and placeables, bypasses its lookup for unrelated terrain, and preserves native results for unidentified previews. Grease Step/Crawl/critical Balance exceptions still match the correct token. Reload every client with **Ctrl+F5**.

**Patch 0.23.1:** fixes libWrapper unregistering the shared check hook after a failed manual concealment check, cancelled Stealth choice or deferred Sneak. The check hook now uses the required `MIXED` registration, allowing it to cancel an attack without rolling it. Grease terrain exemptions retain `WRAPPER` and always chain before filtering their own difficulty. Reload every client with **Ctrl+F5** to restore any already-unregistered hook.

**Version 0.23.0:** [Goblin Pyro](docs/goblin-pyro-foundry.md) adds the first caster profile: native spell slots, Ignition, Tangle Vine, Breathe Fire cone aiming, persistent Grease, torch fallback and Goblin Scuttle. Shared casting helpers handle action/MAP costs, reaction interruption, saves, targeting checks and damage. Spell planning uses encounter benchmarks and weighs resource use, positioning, redundancy and friendly fire. Reload every client with **Ctrl+F5**.

**Patch 0.22.2:** ogres place more weight on poor ranged accuracy and conserve missiles. At -4/-6 range, productive approaches toward melee can beat Draw/throw even without an attack afterward this turn, fixing the two-action Draw → last-action distant throw loop. Movement still accounts for terrain, reactions and sight; normal attack rules are unchanged. Reload clients with **Ctrl+F5**.

**Patch 0.22.1:** [reset selected actors to their prototype state](docs/actor-reset.md), including HP, resources, deleted ammunition, equipment and conditions. The GM macro also clears old AI combat state and defeated markers. It preserves token placement and AI preferences, skips linked actors, and leaves AI paused for the next test fight. Reload every client with **Ctrl+F5**.

**Version 0.22.0:** empty or missing bolts lead scouts to draw their shortswords and approach melee, without requiring swarm support or replenishing resources. A bounded tactical grid estimates enemy routes, footprint restrictions, interception and safe escape space. Recent movement history discourages circling across turns. The GM can inspect a scout's last tactical map through the module API. Reload every client with **Ctrl+F5**.

**Version 0.21.0:** scouts can kite with ranged support or switch to shortswords and surround an isolated enemy. Forecasts include one future native move as well as weapon changes, shots and Reloads. Support considers visibility, firing lanes, initiative and nearby reinforcements. Actual flanking supplies melee off-guard and Sneak Attack; crossbows no longer receive a projected flanking bonus. All taught creatures can move through and stop on dead, zero-HP or defeated tokens. Reload all clients with **Ctrl+F5**.

**Version 0.20.0:** scouts compare short action sequences across their remaining turn, weigh cover against estimated incoming danger, retreat using known enemy reach/pursuit, and prefer otherwise comparable targets recently hit in their view. Forecasts respect MAP, ammunition, hand changes and uncertain stealth; decision explanations show the estimated sequence. Reload all clients with **Ctrl+F5**.

**Patch 0.19.3:** stops Creature AI when the battle is won, before another action, command or automatic turn advance. The check covers the whole combat roster, including untaught and hidden living opponents, and preserves the tracker and remaining actions. The latest Ogre/Kobold battle review is in [the analysis report](docs/battle-analysis-2026-11-04.md). Reload every client with **Ctrl+F5**.

**Patch 0.19.2:** fixes stopping with ordinary and movement-only actions left. Approach distances now route a creature's full footprint around occupied spaces to usable stopping positions. When engagement is blocked, NPCs can keep Seeking or spend a restricted move to investigate a different point near a known enemy area before Seeking. Hidden targets still use DC 11 attacks. Ogres can use a last ordinary action to ready ammunition for next turn, without receiving a free throw.

**Patch 0.19.1:** adds the world setting **Suppress Dice So Nice for AI-controlled NPCs**, default Off. It skips 3D dice on all clients for rolls from enabled AI NPC tokens and managed NPC reactions while preserving roll results and chat visibility. Reload every client, then enable it under Foundry Creature AI module settings.

**Version 0.19.0:** battle-driven fixes to setup utility. Scouts no longer Hide again merely to improve confidence in an unobserved secret result, or Sneak solely to become Undetected before the same shot. Existing stealth is not counted again as a new movement benefit. Seeing extra distant enemies no longer beats approaching enemies already in view; returning to the turn starting square has a cost. NPC Seek now defaults to the requested simplified whole-visible-field mode, with bounded search areas selectable in world settings. See the [battle findings](docs/battle-analysis-2026-11-04.md). Reload every client with **Ctrl+F5**.

**Patch 0.18.1:** movement scores destination line of sight explicitly. Scouts no longer receive cover/stealth movement rewards for blind destinations unless making useful route progress or escaping melee. All profiles reject blocked follow-up attacks even if readiness flags say usable. Clear views of known Hidden squares can support projected attacks; Undetected/unknown Invisible positions remain searches. Expected destination sight is revalidated after pacing. Reload every client with **Ctrl+F5** and verify the running version in Alt+W.

**Version 0.18.0:** [automatic NPC Seek](docs/npc-perception.md) for wolves, both ogres and scouts. They search remembered enemy positions using a native blind Perception check, spend one action without MAP, update detection for that observer and continue their turns. Hidden and concealed targets receive automatic targeting flat checks. Search areas never follow an undetected creature's live position or see through walls. Reload every client with **Ctrl+F5**.

**Version 0.17.0:** NPC stealth planning uses estimated Hide/Sneak chances rather than secret results or actual opposing Perception DCs. The real rolls still resolve visibility, reactions and precision damage. Ogres compare ranged attacks after moving, including range penalties, cover, concealment and Draw costs. Cover/concealment also reduce weapon-preparation scores and wolf Knockdown setup chances. Reload every client with **Ctrl+F5**.

**Patch 0.16.3:** fixes the Alt+W styles not loading when the running Foundry server still caches an older module manifest. The controls now await their own versioned stylesheet before opening, so wrapping, scrolling and the button grid work without restarting the server. Reload clients with **Ctrl+F5**.

**Patch 0.16.2:** the Alt+W controls open in a compact, resizable 560 × 620 window bounded by the viewport. Labels and long text wrap; only the settings body scrolls, while all nine action buttons remain below it in a three-column grid. Styles are scoped to this dialog. Reload all clients with **Ctrl+F5**.

**Patch 0.16.1:** scouts account for losing stealth when choosing Stride, Scamper or Reload. Movement lookahead no longer carries hidden precision damage into a revealing action. Useful covered Sneaks preserve their advantage and can repeat within the normal action budget. Already-undetected scouts do not move solely to consume another Sneak. Weapon preparation comes before offensive Hide; last-action defensive Hide remains available. Reload all clients.

**Version 0.16.0:** [AI pacing and intent](docs/ai-pacing.md). Defaults pause 1.5 seconds before each action and 0.75 seconds after its result. Native token bubbles describe the chosen tactic in natural language; wolves use nonverbal descriptions. Intent can be public, GM-only or off, independently of the new GM-only automated NPC roll option. Stop cancels waits, and the action is revalidated before spending it. Automated NPC reactions share this pace while holding movement. Configure these world settings under Foundry Creature AI and reload every client.

**Patch 0.15.3:** fixes normal PC dragging across scene regions being rejected as unsnapped. The movement wrapper preserves the requested path before native region-boundary points are added, inherits omitted waypoint fields, and uses native token snapping/traversal. Generated boundary points do not invalidate a legal move; explicit unsnapped destinations and elevation/level/size changes retain manual handling. Terrain costs, hazards and reaction pauses remain native. Reload all clients with **Ctrl+F5**.

**Patch 0.15.2:** fixes the libWrapper startup error introduced by the player-stealth integration. Terrain and player stealth now share one registration for the native PF2e check method. Regression tests reject duplicate registrations and exercise Hide, concealment, hidden Strike bonuses, revelation and persistent Sneak through the combined wrapper. Reload every client with **Ctrl+F5**.

**Patch 0.15.1:** selecting Sneak creates a persistent, player-removable **Sneak** effect with a token icon. Each ground move uses Sneak without the movement-choice popup, rolls separately and rechecks current Speed, Swift Sneak, Legendary Sneak and observer protection. Remove the effect or use **Stop Sneak** to stop. Mode selection is separate from enemy detection; attacks can reveal the character while leaving the movement choice active.

**Version 0.15.0:** [player Hide and Sneak](docs/player-stealth.md). Native Hide rolls resolve separately against enemy Perception DCs; dragging offers Stride, legal Sneak, and legal Step. Sneak uses half Speed, recognizes Swift/Legendary Sneak, checks start/end protection, and shares the paused reaction engine. Each enemy token records its perception of each hiding character. Reload every client; player action counts remain manual.

**Patch 0.14.3:** hazardous terrain on a 5-foot square grid resolves damage on each hazardous square entry, with native movement checkpoints so a long drag cannot defer damage until the exit. Leaving for safety does no extra damage. Large creatures take one instance per entered step; native walls, costs and reaction handling are preserved. Reload every moving client.

**Patch 0.14.2:** directional captions also show **Hidden/Undetected** and the cause: stealth, invisibility, blocked LOS, or the GM's token-hidden toggle. Conditions, effects, stealth flags and walls/doors refresh them; rendering still reads cached text. Captions do not apply Hidden conditions or expose undetected token locations to players.

**Patch 0.14.1:** cover zones have an editable **10-foot firing radius** by default. A nearby shooter ignores that zone's cover against targets outside its radius; return fire keeps normal cover. Both nearby creatures use the normal geometry. Concealment and other sources of cover remain independent.

**Version 0.14.0:** directional terrain for regular play. Native weapon/spell attacks and targeted attack-trait skill actions resolve concealment before rolling; crossing cover modifies the targeted attack's AC. Observer-relative token indicators refresh on movement/selection and read cached text during rendering. Existing Stadium foliage now also obscures sight lines passing through it. Reload all clients.

**Patch 0.13.1:** tokens inside concealment regions gain the native Concealed condition and lose only the zone's condition on exit. Manual/spell concealment is preserved. Zone conditions remain compatible with AI targeting, flat checks and reactions. Reload all clients.

**Version 0.13.0:** [attached scene terrain behaviors](docs/scene-terrain.md), native difficult-terrain costs, weather shelter and paused hazard damage. Cover/concealment remains editable with the cloud tool and can be disabled in the native behavior list.

**Version 0.12.0:** [Kobold Scout skulk](docs/kobold-scout-foundry.md), [cover/concealment regions](docs/environment-zones.md), per-observer Hide/Sneak, native crossbow/reload/ammunition and Scamper. GM cloud/eye controls configure terrain and detection. libWrapper is required. See the [current setup](docs/creature-ai-foundry.md); all clients must reload.

**Patch 0.9.1:** front-line targeting preferences are calculated from maximum HP and current AC. No per-character role checkboxes or class assumptions; legacy manual selections are ignored.

**Version 0.9.0:** [general controls](docs/creature-ai-foundry.md), a [shared capability framework](docs/creature-framework.md), and the supplied [Ogre Boss bruiser/leader](docs/ogre-boss-foundry.md). The wolf remains supported. Ogre behavior includes Large movement, reach, Trip/Sweeping Hook, Bellowing Command with a restricted movement pool, and javelin inventory handling.

Behavioral extraction of Dawnsbury Days 4.44 NPC AI from decompiled method bodies, with a runnable Foundry PF2e wolf adapter.

**Wolf module 0.8.0:** [entertainment preferences and pack morale](docs/wolf-pacing-and-morale.md) add bounded ability showcases, front-line engagement and coordinated retreat after heavy losses. Both options default on and can be adjusted in the wolf controls. These are explicit encounter pacing additions, separate from recovered DD scoring and native PF2e rules.

**Patch 0.7.2:** automated Escape rolls immediately regardless of the GM's check-dialog preference, using the same roll-event helper as jaws and Knockdown.

**Patch 0.7.1:** [Escape compatibility](docs/wolf-escape-automation.md) recognizes PF2e Automations' locked grapple conditions through their granting effect, uses its recorded attacker DC when available, and removes the correct cause on success.

**Wolf module 0.7.0:** [setup and supported behavior](docs/wolf-foundry.md), for Foundry 14 / PF2e 8.6.1. [New decision improvements](docs/wolf-decision-improvements.md) apply the additional decompiled findings: useful Knockdown setup value, reaction-aware route search and recorded GM explanations. Existing [Step, Crawl, Escape and prone choices](docs/wolf-maneuvers.md), pack attacks, allied passage, alliance targeting, [reaction waits](docs/reactions-foundry.md), death/healing recovery and optional automatic turn passing remain. Missing Escape source/DC information is requested from the GM before an action is spent. Run `node tools/build-module.mjs` to build. Automated integration and native-grid tests pass; a running-world multiplayer smoke test is still needed.

The key finding is that Dawnsbury uses a layered utility chooser with creature-specific overrides. A reusable chooser plus small enemy policies is a better starting point than writing a separate complete decision tree for every stat block.

## What is available

- [Recovered AI behavior](docs/dawnsbury-ai-behavior.md): source provenance, exact ranking and attack formulas, wolf construction, movement decisions and Foundry adaptations.
- [Wolf rules coverage audit](docs/wolf-rules-audit.md): missing rules, missing choices, native-system responsibilities and proposed implementation priorities for version 0.5.2.
- [Oracle verification](research/dawnsbury-behavior-verification.json): 8,000 ranking pairs and 2,000 attack evaluations compared with compiled decompiled methods; zero mismatches.
- [Initial metadata report](docs/dawnsbury-ai-findings.md): historical findings before decompilation, through version 0.4.1.
- [Installed-game inventory](research/dawnsbury-api-inventory.json): public Intelligence member names and literal constants from Dawnsbury Days 4.44.0.0, identified by assembly hash.
- [Recovered shared chooser](src/dawnsbury/chooser.mjs): priority layers, comparison, tactical attack value, random ties, and supplied-option threat/Step/door branches.
- [Wolf planner](src/wolf/planner.mjs): legal wolf candidates and movement lookahead using that chooser.
- [Earlier demo engine](src/decision-engine.mjs) and [example policies](profiles/creatures.json): illustrative Standard/Mindless/Pack linear weights, separate from the live wolf policy.

The installed game's AI methods have now been decompiled and inspected. The module ships newly written JavaScript implementing recovered behavior; game binaries and raw decompiled C# stay out of the package. The wolf adapter supplies a limited set of supported actions; other enemies still need handlers. DD's rules are distributed across its game engine, so recovering the chooser does not port every PF2e rule. Foundry resolves native rolls and effects, with supported adaptations documented explicitly. Installing the module does not enable it or edit world databases.

## Run

Requires Node 20 or newer; no packages to install.

```powershell
node --test test/decision-engine.test.mjs
node examples/decide.mjs
node tools/build-module.mjs
```

The demo gives the same options to four illustrative policies. It uses the earlier linear-weight demo engine, not the recovered live wolf chooser. Run `npm test` for the full parallel suite. After locally decompiling the required types as described in the research report, `node tools/verify-dawnsbury-policy.mjs` verifies the reconstruction against actual methods.

To refresh the game API inventory, with .NET 10 SDK:

```powershell
dotnet run --project tools/InspectDawnsbury -- "G:\SteamLibrary\steamapps\common\Dawnsbury Days" "research/dawnsbury-api-inventory.json"
```

The extractor reads assembly metadata and XML member identifiers without loading the game assembly or executing game code.

## Customize a creature

For the earlier demo engine, add a profile that extends `standard`, `mindless`, or `pack`, then set feature weights or ordered `rules`. The `wolf-example` and `dragon-example` profiles demonstrate this; they are design examples rather than extracted game creature definitions. Live wolves use `policy: dawnsbury-4.44-pack`; changing demo weights does not change their recovered ranking.

Call `resolveProfile(profiles, id)`, then `decide(snapshot, profile)`. A snapshot supplies `actionsRemaining`, optional facts under `self`, and `candidates`. Each candidate requires a unique `id`, `kind`, integer `actionCost`, and `legal: true`; numeric `features` determine its utility. Mark an explicit idle action `fallback: true`. Unknown legality excludes an option. Rules select only from the filtered legal set; a rule with no matching option falls through.

For new live enemies, generate supported legal candidates with `assessment` fields for the shared `chooseOption` function. Its optional `override` receives only affordable legal options and can select one or return null to preserve normal ranking, matching DD's override architecture. Add creature-specific action execution and native legality checks before enabling it in Foundry.

The caller must refresh game state and candidate legality after every executed action. A returned choice must be revalidated before execution.
