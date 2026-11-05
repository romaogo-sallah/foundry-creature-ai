# Manticore (Quill Tail)

Version 0.31.0 adds the supplied level-6 Monster Core export with Fly 40 ft, Jaws, agile Claw, range-increment-40 Spike and one-action Spike Volley. Select the imported unlinked token, open **Alt+W**, verify the profile and save the normal automation settings. Reload every client with **Ctrl+F5** after installation.

The flyer gains a safe firing altitude, closes poor range, and keeps its final Fly/hover action when needed to remain airborne. It holds a useful firing position rather than circling without improving its shot. Native cover, targeting flat checks, range penalties, IWR, critical damage and Shield Block remain authoritative. When no spikes remain, it switches to a measured flying melee approach, Strike and escape. Neither the scorpion-tail venom nor Eagle Dive belongs to this kit.

Shared flight considers open space across all scene levels. Level bounds alone do not create ceilings or upper-level floors; actual movement-blocking surfaces do. Paths update the token’s level as elevation crosses configured bands, preserve movement cost, and retain visible ground targets and reachable reactions. Bodies, walls and surfaces on other levels still block their physical space. The search keeps a finite, expanding planning window rather than treating its limit as a ceiling.

## Spike Volley

| Mode | Cost | Resolution |
| --- | --- | --- |
| Single ordinary Spike | 1 action, 1 spike | One native ranged Strike. Useful with one spike left or against an already Immobilized target. |
| Volley against two targets | 1 action, 2 spikes | Targets must be within 20 ft of each other and within Spike range. Roll separately at the same pre-Volley MAP; increase MAP only once after the activity. |
| Volley to pin one target | 1 action, 2 spikes | One Strike and one spike’s normal damage, including the native critical multiplier. A hit adds an owned Immobilized effect with Escape / Force Open DC 23. |

Volley scores compare damage, ammunition accuracy, estimated control value and an optional first-use showcase bonus. An already Immobilized target receives no redundant pin reward. Native reactions resolve before each ranged Strike. A creature killed before launch spends no unlaunched spikes; if interrupted between split attacks, only the first launched spike is spent. Target positions, range and separation are checked again after reactions. Failed flat checks and misses consume launched spikes. Hidden attackers reveal after their first Strike, so the second attack does not inherit a lost Hidden advantage.

The module owns the pin effect and grants Immobilized in memory through native rules. AI Escape recognizes that source/DC and removes only its effect on success, preserving unrelated restrictions. Players can roll the effect’s **Escape DC 23** or **Force Open DC 23** link and remove the pin effect after success; automatic cleanup for manually rolled player checks is outside this kit. Pins have no automatic expiry. The same owned pin is not duplicated.

## Spikes and resets

Each creature has at most **12 spikes in 24 hours**. Usage is stored on its actor, so another combat or an HP heal does not replenish it. Each spent spike becomes available after 24 hours of Foundry world time. Linked tokens share their actor’s supply. The **Spikes remaining** field in Alt+W lets the GM correct the current count. Saving an unchanged count preserves its recovery timestamps; preview is read-only.

The prototype reset macro restores the actor’s saved baseline, including its quill-use flag, as well as clearing the token’s first-use showcase history. A fresh prototype with no spending history restores all 12. Installation itself never resets creatures or resources.

## Verification scope

Tests cover native bindings, Volley action/MAP accounting, single-target damage/pinning, twenty-foot separation, limited resources, regeneration, concurrent reservation, prototype reset, concealment failure, hidden-attacker reveal, ranged reactions and death, manual damage, controls, safe ranged flight and melee fallback. Flight integration uses actual worker threads with native validation stubs; explicit worker-failure tests retain native fallback coverage. Native effect preparation is checked separately in Foundry without changing real actors. A complete live battle remains a playtest.

The release run passed **868 tests in 16.6 seconds**. Native Foundry 14.369 / PF2e 8.6.1 validation confirmed Spike +14, range 40/240 ft, one-action Volley, a valid Immobilized grant, one removable pin source and native unarmed Escape DC 23. The Stadium probe confirmed bounds spanning 0–100 ft, the upper level at 25 ft and no artificial floor at its 20-ft boundary. Temporary probe actors were never saved; the inspection Region removed itself.
