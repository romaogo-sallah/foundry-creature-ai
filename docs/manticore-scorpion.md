# Manticore (Scorpion Tail)

Version 0.30.0 teaches the supplied level-6 Monster Core export. Select its imported unlinked token, open **Alt+W**, confirm **Manticore (Scorpion Tail)** and save the usual automation options. Reload all clients with **Ctrl+F5** after installation. No ammunition count is needed: this variant has no ranged spikes or Eagle Dive.

The kit reads native Jaws (+17, 2d8+8), agile Claw (+17, 2d6+8) and reach-10 Stinger (+17, 1d8+8). Their real rolls, MAP, critical damage, targeting flat checks, IWR and Shield Block retain the shared native Strike handling. Shared flight uses Fly 40 ft, ascent/descent costs, body-box reach, native surfaces/walls, hover, falls and Arrest a Fall. It stages at altitude and looks for **Fly → Strike → Fly**, measuring the escape before committing. Shelter can produce a deliberate standoff, as with Eagles.

Venom adds a benchmark on-hit benefit to prepared Strike scoring. The estimate uses the monster’s known successful Stinger hits to reduce repeat preference; it never reads target Fortitude, immunity, actual poison stages or secret save outcomes. Jaws and agile Claw remain alternatives when their expected value and reach are better. The worker retains melee approach destinations alongside high-altitude routes, with final native validation.

## Venom resolution

After a successful Stinger hit, **Manticore Venom** rolls native **Fortitude DC 22** once. A critical hit does not double the poison exposure. Failed initial saves start at stage 1, critical failures at stage 2. Stage effects apply immediately:

| Stage | Poison damage | Enfeebled | Interval |
| --- | --- | --- | --- |
| 1 | 1d10 | 1 | 1 round |
| 2 | 2d10 | 1 | 1 round |
| 3 | 2d10 | 2 | 1 round |

Ongoing saves resolve at the poisoned creature’s combat turn end. Success lowers one stage, critical success two; failure raises one, critical failure two, capped at stage 3. A new nonzero stage applies its damage and condition, including when a failure repeats the maximum stage. Stage 0 ends the effect. Additional failed exposures advance the existing poison without extending its **six-round maximum**; successful exposures leave it unchanged. Native poison immunity skips exposure. See [Afflictions](https://2e.aonprd.com/Rules.aspx?ID=2389) and [Turn Step 3: End Your Turn](https://2e.aonprd.com/Rules.aspx?ID=2430).

PF2e 8.6.1 disables its production `affliction` item type, so the module owns an ordinary effect with a stage badge and native `GrantItem` rules. The granted Enfeebled is in memory only and disappears with this effect; independently applied Enfeebled remains. Poison damage uses native DamageRoll and `applyDamage`, so IWR still resolves. Physical Stinger damage follows the ordinary Shield Block barrier; poison is resolved separately. In manual damage mode, damage cards retain buttons and automation pauses for application.

The active GM resolves each interval once, holding the shared reaction barrier through saves, effect updates and damage. Pending intervals are marked before rolling; cancelled saves or interrupted damage remain flagged for GM inspection instead of silently rerolling. Remove or correct the owned effect after resolving such an interruption. Prototype reset restores native actor effects/resources and clears the monster’s encounter hit history, including observers’ history about reset targets.

## Scope and corrections

This handler implements the exported **DC 22, six-round, three-stage** venom. Arbitrarily edited venom mechanics need a taught handler update. Another existing effect named for Manticore Venom is left to its external controller instead of creating a second managed poison. External modules with differently named effects may still need manual reconciliation.

Automatic interval saves currently require the poisoned token in the viewed combat scene. Outside combat, resolve intervals manually; advancing world time still expires owned poison effects in the viewed scene. Ordinary disease treatment, antivenom bonuses not represented in native rules, changing interval lengths and arbitrary afflictions are outside this kit. Removing the owned poison effect represents a cure. No real actor or combat is reset by installation.

## Verification

The 0.30.0 regression run passed 841 tests, including an actual background worker completing a Manticore approach, Stinger and retreat. Venom tests cover exposure/recovery degrees, repeated exposure without extending duration, expiry, poison immunity, native damage options, manual damage, cancellation, interval deduplication, shared reaction barriers and secret-result-independent scoring. Targeted checks passed again after correcting the optional native effect-origin fallback.

On Foundry 14.369 / PF2e 8.6.1, temporary in-memory actors confirmed profile recognition, all native weapon bindings, reach 10, prepared Fly 40, poison DamageRoll typing and GrantItem Enfeebled values 1 and 2 without rule or item validation failures. This tested native data preparation without attacking, moving or damaging live combat actors. A complete live encounter remains a playtest.
