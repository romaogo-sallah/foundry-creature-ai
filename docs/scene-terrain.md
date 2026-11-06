# Scene terrain conversion — 0.27.0

The active Stadium's standalone map notes and drawings can be converted to ordinary Foundry Regions without replacing the source artwork. The prepared scene-specific plan is a private workspace artifact, not a public module asset. The conversion checks the source IDs and geometry/text signatures before native embedded-document creation; it creates only missing regions with matching setup/source markers. It never replaces drawings, notes, tiles, tokens, journals or existing unrelated regions.

## Attached behaviors

- **Cover/concealment** uses the named Creature AI behavior described in [environment zones](environment-zones.md). Standard cover sources use the original tiles' actual centers, dimensions and rotations. Foliage regions follow the actual drawn polygon, not its bounding box. Cover settings remain editable through the cloud button; the attached behavior can be disabled from the native Region sheet.
- **Difficult terrain** uses Foundry 14's native **Modify Movement Cost**, with ground movement difficulty 2. The native terrain engine supplies measurement to AI planning and execution. A Step into terrain costing more than 5 feet is unavailable. Overlapping difficult regions follow native combination rules; this module does not multiply their cost again.
- **Interior** uses native **Suppress Weather** over the annotated tent footprint. Existing tent walls continue to handle sight and passage. It does not invent a ceiling height or a darkness modifier.
- **Hazardous terrain** has a named Creature AI Execute Script behavior for native movement-in/within events. Native movement pauses on the moving user's client while its handler resolves. The handler also holds that client's shared AI/reaction barrier. Region creation, resizing and standing still never deal retroactive damage. Flying, burrowing, displacement, paste and undo are excluded from these ground hazards.

## Hazard frequency

The behavior's `flags.foundry-creature-ai.terrain.frequency` supports:

| Value | Behavior |
| --- | --- |
| `manual` | Stops movement and asks the GM to resolve the declared damage; does not roll or apply it. This is the safe provisional setting until frequency is specified. |
| `entry` | One damage instance per move action that enters/traverses the region. |
| `per5` | On the 5-foot square grid, one instance when entering each hazardous square. A step into a safe square deals nothing. Movement cost and the number of occupied footprint squares do not multiply the damage. Other grids retain the prior distance counter. |

Since **0.14.3**, the native token pre-update workflow expands gridded movement with Foundry's own complete-path API and marks hazardous destinations as checkpoints before movement is finalized. This works for dragging, keyboard movement, Token/Scene movement APIs and ordinary position updates. Each checkpoint still goes through native collision, cost and reaction workflows. The mover pauses synchronously, reaches the entered-square animation, resolves the separate damage instance and only then continues. A long drag therefore cannot postpone damage to the exit. Ordinary paths without hazards, flying, displacement, undo/paste, resizing and planned previews keep their native workflow. Mixed elevation/level movement retains manual handling; this checkpoint addition covers the existing ground-navigation scope.

Native region notifications are deduplicated per update and hazardous square entry, rather than assuming `movement.passed.distance` is cumulative across checkpoints. Native within events can also be emitted at an exit: a destination outside the hazard is not charged. Moving from inside a hazard to another hazardous square is a new entry; re-entering a previously vacated square can damage again. Large creatures receive one instance per translation, not one per newly covered body square. On the square grid, extra diagonal or difficult-terrain cost does not add extra instances for that one entered destination.

The [general hazardous-terrain rule](https://2e.aonprd.com/Rules.aspx?ID=2368) says it damages creatures as they move through it; it does not prescribe exit-only damage. A specific terrain/effect determines its own damage and triggers. Stadium's cactus areas use the GM-selected per-square entry interpretation. Standing still or starting/ending a turn does not add damage unless the specific terrain is configured for that separately.

For manual token movement, use one drag per move action. The AI and threatened movement replay share an action context across their internal square-by-square native moves, so an `entry` hazard does not hit repeatedly for that one action. Native boundary/within events are deduplicated. Each damage instance uses a separate native PF2e DamageRoll and `actor.applyDamage`, so resistance/immunity applies separately to each instance. Damage application buttons are suppressed on automatically applied damage cards. Ground terrain damage is not an attack and does not request Shield Block.

If a creature dies from a hazard, movement stops, the framework re-evaluates the live actor and can pass its turn when enabled. Manual damage or an error stops automation for review. An active GM runner waits until hazard processing has finished before its next action.

AI routes include a known-hazard risk state, preserving longer safe alternatives, and movement scores include the expected terrain damage. Step and Sneak do not waive hazardous-terrain damage.

## Elevation notes

Version **0.36.1** adds manually creatable **Ramp / stairs** Region behaviors in the Movement module. Draw a Region, add the behavior, and set lower/upper elevations and uphill direction. The **Ramps / stairs** toolbar button offers the same configuration. Ordinary native Define Surface platforms work as adjoining floors without setup flags. See the [manual ramp instructions](ramps.md). Existing Stadium ramps retain their saved geometry until deliberately edited.

Version **0.27.0** interprets the Stadium's wooden artwork and +5/+10 ft notes as two native floor surfaces and three walking ramps. The +5 ft zigzag walkway uses three rectangles following its planks, preserving the open gaps. The western platform has its own +10 ft rectangular deck. The visible approaches connect ground to +5 ft, ground to +10 ft and +5 ft to +10 ft. The GM selected stairs/ramps using ordinary walking, rather than ladders requiring Climb.

Each deck Region has a native **Define Surface**, placed at its bottom elevation, with movement/light/sight restriction, occlusion, no sound restriction, and no exposure/culling. Its flags contain `foundry-creature-ai.platform.elevation`. Each ramp Region stores `foundry-creature-ai.ramp` with `from` and `to` center points/elevations. Region geometry limits the width; the axis defines the slope. Hide an owned Region to disable its interpretation. The existing scene level, artwork, height notes and unrelated terrain stay intact. Pit depth/falling automation remains separate.

The native token pre-update pipeline expands ordinary walking along configured ramps. It computes height at the token's movement origin and inserts exact slope-end corners before floor collision testing. This avoids a straight interpolation cutting through a platform edge. Generated corners remain present across native movement continuations. Manual movement accepts the owned vertical profile while continuing to validate original requested grid waypoints, Speed, walls and its existing reaction/stealth workflow. Players can stop partway along a ramp and continue later. No climb check or extra action is introduced for these walking connections.

Ground movement beneath a deck retains its elevation; entering its horizontal footprint does not teleport a creature on top. Leaving a raised deck without a ramp is rejected with an instruction to resolve jumping, climbing or falling. Flying, displacement, undo/paste, resized tokens and cross-level paths retain their native/manual workflows. Ground-only AI planners exclude edges that would change height unexpectedly. Full vertical targeting, 3D reactions, flying navigation and automatic pit/fall resolution are not implemented by this scene setup.

## Generic API

`game.modules.get('foundry-creature-ai').api.terrain.applySetup(plan)` accepts a prepared plan with `worldId`, `sceneId`, source signatures and region data. It requires the active GM and matching active scene. Completed plans are marked on the scene; a partial application can resume without duplicating its existing regions. The private preparation tool uses a read-only copied scene snapshot. Native socket/document writes update the running Foundry world; live LevelDB files are never edited.
