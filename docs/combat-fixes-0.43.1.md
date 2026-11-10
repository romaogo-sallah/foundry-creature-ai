# Combat corrections in 0.43.1

This release addresses the [Lich versus vampires review](battle-analysis-2026-11-08-lich-vampires.md). The corrections are shared by the native compatibility planner and the decision Web Worker. Existing saved combats do not receive refunded actions, spell slots, HP or retroactive save results.

## Immunity and rejected actions

Frightful Presence stores a source UUID under an encoded, dot-free key. Foundry can no longer expand it into a structure the next lookup misses. Existing flat and expanded UUID keys are still recognized. Checks serialize per target actor, including checks from different sources, so movement and turn hooks cannot race or overwrite another source's immunity. A failed/unresolved save does not establish immunity.

Dispel planning and execution now use matching visibility, line-of-effect, subject and effect checks. The AI does not select obsolete benefits on a 0-HP or escaping mist subject. This is a tactical restriction on supported automatic dispelling, not a ruling that Dispel Magic can never affect magic on a corpse.

A known-unexecuted action restores its reserved cost and records its candidate ID. Shared ranking and caster forecasts exclude it while replanning. This memory lasts for the current turn until another action resolves successfully; correcting the action counts also clears it. A chooser that ignores the filter pauses instead of repeating the same rejected action until the iteration limit. Uncertain execution errors still retain their reservations.

## Spell and hybrid tactics

Living-only spell definitions and target evaluation now agree, including Vampiric Feast and Void Warp. Vision of Death and Vampiric Exsanguination also use the shared target-category filter. Toxic Cloud receives no damage value against recognized nonliving creatures; the planner currently does not generate a separate concealment-only use of that cloud. Mist remains a supported defensive alternative where available. Purely void damage spells and Strikes are not selected against recognized undead. Vampires retain Grab's group benefit against nonliving foes, but stop forecasting Drink Blood healing/drain against them.

**Table knowledge policy:** an observed creature with the undead or construct trait is recognizable as nonliving. The adapter supplies that category to the worker, and retains the observation when the creature leaves sight. It does not supply actual enemy immunities, AC, saves or secret outcomes. Unidentified targets retain uncertainty. This default assumes the encounter's visible representation identifies those bodies; disguised undead still require a future explicit identity/knowledge override.

Generic casters now persist quiet-turn patience, capped at two turns and counted once per round. Setup and repeated reports do not reset the counter. Offensive actions reset it. Hybrid creatures with a small innate list can consequently approach rather than wait indefinitely. Publicly witnessed ranged casting also updates apparent combat role, so a Lich's melee Hand no longer remains the only evidence used to classify its threat. Private and blind messages do not teach that role.

## Mist Escape and pit movement

Escaping mist bypasses offensive target refresh and pit action generation. A guarded `combatTurnChange` recovery runs after native turn processing when the ordinary start hook has not produced a ledger for the active mist turn. It honors Stop, active GM ownership, full-auto settings, existing runs and existing turn ledgers. It never grants another action budget to a turn already handled. The normal PF2e start hook remains the primary entry point.

The old encounter's precise missed-start cause could not be recovered from chat. This release adds recovery and tests full 0-HP mist turns, including the worker backend. It does not claim a reproduced trace of the original client failure. A subsequent encounter should confirm actual travel to the scene edge under its installed module combination.

Pit Climb, run-up and jump resolution await native movement animation and inspect settled source coordinates. A completed animated run-up can proceed to Long Jump. A genuinely constrained run-up or a newly applied restraint still stops the activity and keeps its spent actions. The original log's jump failure is consistent with this timing defect; an external movement constraint was not conclusively excluded.

## Verification and installation

The parallel suite passed **1,177 tests** in 46.5 seconds with 11 processes. After the final mist/pit separation, the affected movement, regression and real-worker files passed **42 tests**. Native browser results and installed/archive checks are recorded in [the verification record](../research/combat-fixes-verification-2026-11-10.json).

Install all five packages from `releases/pf2e-tactical-suite-0.43.1.zip`, preserving their dependency relationship, then reload every connected client with **Ctrl+F5**. No server restart or new module enablement is required for this patch. Previous installed modules were backed up locally before replacement. Saved scene state and world actors are not reset by installation or diagnostics.
