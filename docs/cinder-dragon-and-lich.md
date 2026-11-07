# Young Cinder Dragons and Lich - 0.42.0

Import the three supplied NPC exports as unlinked scene tokens, select one and open **Alt+W**. Their kits are recognized by their mechanics; the spellcasting dragon keeps its own spell list and does not acquire the martial dragon's Frenzy or Momentum. Existing full-auto start/pass controls apply. Reload every client after installing the suite.

## Young Cinder Dragons

Both dragons use their native prepared Jaws, Horn, Claw, Tail and Wing Strikes, 120-foot Fly speed, Pyre Breath, Stoke the Flames, Smoke Vision, Frightful Presence, Boiling Blood and Jaws-only Reactive Strike. The taught Pyre kit is the supplied young dragon's 9d6 / DC 29 version, rather than a guess for every age of dragon.

Pyre Breath costs two actions, uses one shared fire damage roll with separate native Reflex saves, adds the critical persistent-fire rider, leaves one minute of smoke and rolls a 1d4-round recharge. It does not spend a spell slot or increase MAP. Both enemy and allied creatures actually inside the chosen volume are affected; targeting predictions use known positions only. Stoke the Flames considers visibly burning known foes, then resolves its extra damage against actual eligible foes within 60 feet.

The martial dragon can spend two actions on two Claws and one Wing, in a benchmark-ranked order with ordinary increasing MAP. Each real Strike rechecks its target and reach. A critical Strike recharges breath through Momentum, including a taught Reactive Strike. The spellcaster export lacks those two abilities and never receives them artificially.

Flight positioning considers a two-action breath or Frenzy after moving. Dragons use the existing movement costs, native geometry and worker route proposals. They are not restricted to the eagle's Dive-and-escape hunting script. Frightful Presence, breath recharge and each creature's ordinary reaction are independent in mixed groups.

Smoke grants concealment through the cloud. Smoke Vision bypasses this smoke, not ordinary Mist or other sources of concealment. The volume and its projected Region shape are retained; a ground token does not become concealed merely because smoke is above it.

Boiling Blood uses the shared reaction reservation and awaited save/damage pipeline. It competes with Reactive Strike and Shield Block for the same ordinary reaction. Reactive Strike offers Jaws only. Automated NPCs use taught reactive abilities automatically; player-owned reactions retain prompts. Manual native attack rolls also feed the critical-hit reaction path. A paused reaction pauses AI continuation.

### Spellcaster coverage

**11 of 17 spell items** are taught reusable combat components: Fire Shield, Mountain Resilience, Wall of Fire, Fireball, Haste, Dispel Magic, Floating Flame, Mist, Revealing Light, Fear and Ignition.

Cleanse Cuisine, Detect Magic, Message, Read Aura, Sigil and Ventriloquism remain manual utility choices. The AI does not spend combat actions inventing a use for a utility spell with no taught tactical resolver.

## Lich

**22 of 26 spell items** are taught. The four manual utility spells are Locate, Detect Magic, Message and Telekinetic Hand. Native prepared slot indices, cast ranks and the daily Drain Soul Cage frequency remain distinct resources.

New shared combat components include:

| Component | Execution |
| --- | --- |
| Chain Lightning | Plans connected hostile targets within 30 feet of the previous target. Rolls damage once; a critical successful save stops further saves and damage. Links and line of effect are rechecked at execution. |
| Vampiric Exsanguination | Living targets in a cone make native Fortitude saves. Temporary HP use half the largest actual post-IWR damage instance, not the sum or predicted damage. |
| Howling Blizzard | Two-action cone or three-action burst; damage once, then difficult terrain until the caster's next start. An earlier combatant at the next round boundary does not end it. |
| Toxic Cloud | Concealment, native Fortitude saves and poison damage at a breathing creature's turn start; deduplicated per turn. Drifts 10 feet each round, stops at blocking geometry and expires after one minute. |
| Wall of Ice | Straight vertical walls with independent ten-foot sections, AC 10, Hardness 10, HP, fire weakness, and cold/critical/precision immunity. Blocking is limited to the wall's ten-foot height. Breaking a section without fire leaves cold, difficult terrain. |
| Translocate | A visible, unoccupied in-scene destination, independently rechecked after reactions. No movement along intervening squares. |
| Fly | Native prepared Fly effect and dynamic flight capability; a caster can acquire flight after combat starts. |
| Defensive buffs | Native False Vitality, Mountain Resilience, Shield and See the Unseen effects; Resist Energy selects a type from witnessed public damage. Existing buffs suppress duplicates. |
| Sure Strike | Native fortune/circumstance-penalty rules; skips attack targeting flat checks, then is consumed after one attack. It does not waive targeting checks for save spells. |

Counterspell uses an available matching prepared spell, native counteract statistic and the ordinary reaction. Both the counter's resource and the interrupted cast's resource remain spent. The automatic recognition policy covers an observed caster with clear sight and effect and an identical prepared spell. Recognizing an unseen casting from other evidence remains manual. Steady Spellcasting can protect against a disruptive reaction using its native DC 15 check. Treating a successful Counterspell as disruption for this protection is the chosen table policy.

Siphon Life resolves after an unarmed hit actually damages a living creature: five temporary HP, a native Fortitude save and cumulative Drained up to 4. A newly gained Drained value also removes current HP by the victim's level; it does not apply IWR to that HP loss. At turn start, source-linked physical grapplers can also be affected. An unidentified or magical restraint is not assumed to be a creature physically holding the Lich.

Drain Soul Cage can substitute a once-daily casting of a taught arcane spell present in this actor's spellbook, including an expended or unprepared item, up to rank 6. Its flexibility receives an extra conservation cost. It does not manufacture the entire arcane compendium. Rejuvenation and destruction of the soul cage remain encounter/campaign adjudication; the Lich does not respawn on the scene during this fight. Its staff's extra spellcasting, potion and ten-minute Teleport scroll remain manual equipment workflows.

## Shared behavior and boundaries

The library now contains **48 spell definitions**. Other NPCs with the same spells reuse these components. Dero gains Revealing Light as well, but the supplied Dero export's spent innate use is preserved.

Avoiding now gates restricted movement that closes on threats and postpones Bellow when a useful retreat exists. Strike follow-up benefits declare their required action budgets and are recalculated inside caster forecasts. The planner cannot value a last-action Claw as if Grab and Drink Blood still fit afterward.

Three-dimensional cones, lines and bursts test occupied five-foot cube centers against their volume, using native sight/effect checks. This is the module's explicit grid adjudication. Region drawings are projections, not new solid surfaces. It is not an arbitrary freeform 3D template editor. Wall of Ice currently offers grounded straight vertical walls, not hemispheres, bridges or custom angled walls. Use **Ice walls: attack a section** for native weapon attack/damage rolls against a section; manual action/MAP counting remains with the player. Ground and flight AI can route around/over the surviving sections; attacking wall sections is currently manual. The export's Wall of Ice structured heightening interval disagrees with its description; section HP and cold damage follow the description's two-rank interval.

Reset to prototype clears breath recharge, restores native spell/daily resources and removes this source's smoke, weather and ice Regions. It preserves unrelated terrain. Combat AI still replans after each executed action and does not read secret save results into its tactical forecast.

Mechanics baseline: the user's exports. References: [Young Cinder Dragon](https://2e.aonprd.com/Monsters.aspx?ID=4345), [Lich](https://2e.aonprd.com/Monsters.aspx?ID=3082), [Frightful Presence](https://2e.aonprd.com/MonsterAbilities.aspx?ID=64). Verification is recorded in [the release record](../research/cinder-lich-pits-verification-2026-11-08.json).
