# Entertainment preferences and pack morale — version 0.8.0

Version **0.9.1** replaces front-line role checkboxes with automatic maximum-HP/current-AC comparisons. The details below reflect that update for both taught profiles.

These are encounter pacing additions requested for the Foundry module. They are not PF2e rules or extracted Dawnsbury wolf formulas. They add preferences to legal choices; the native checks, action costs, multiple attack penalty, reactions and damage still resolve normally.

Both options default on for existing wolves. Reload every connected client with **Ctrl+F5**. Use **Alt+W** to adjust them for each wolf.

## Show the creature's abilities

With **Entertainment preferences** enabled:

- The first legal Knockdown attempt by each wolf receives **+4 utility**. The GM can change the bonus from 0 to 20. It is used up by an actual attempt, including a failed Trip, and resets in a new combat. A skipped or unresolved action does not claim a completed attempt.
- A supported jaws hit with Pack Attack receives a **+1 showcase preference** until that wolf has actually landed a Pack Attack hit in this combat. The extra damage still requires two other allies in reach; a preference never grants the damage by itself.
- Strike setup scoring also considers whether an initiating jaws hit could open a useful showcased Knockdown, paying the action cost first.

This makes an occasional distinctive action worthwhile even when a simple damage estimate favors another bite. It does not force an impossible, unaffordable or extremely unfavorable maneuver. A prone target, missing prerequisite hit, restraint or Trip immunity still prevents Knockdown. Once the ability has been shown, its ordinary tactical score resumes.

The combat-scoped display history lives on each token's `playState` module flag. It does not reset by correcting action counts or reopening the controls.

## Let the front line hold attention

The creature receives **+1.5 utility** for a Strike against a calculated front-line character until it has attempted one such Strike that turn. This is a soft preference rather than a target lock. Pack opportunities, other scores and legal reach still matter. Other characters can be chosen, and subsequent attacks return to ordinary selection.

Each snapshot compares eligible opposing player characters. A character qualifies when both their maximum HP and prepared current AC are at least their respective group medians. This identifies the upper half on both measures; high HP alone or high AC alone does not suffice. Wounds do not change maximum HP, so an injured tank retains the preference. AC changes are reflected in the next snapshot. Missing stats do not fall back to remaining HP, armor labels or class names. Tied values can qualify multiple characters.

There are no per-character front-line controls. Old saved manual lists are ignored immediately and cleared when settings are saved. The GM-requested pacing assessment reads prepared AC; the underlying attack/DC estimates still use the existing encounter benchmark. The calculated roles and thresholds appear in **Why this decision?**.

The adapter does not adjust anyone's AC, HP or damage reduction. It gives durable characters opportunities to use their existing defenses and reactions. A new turn restores the small engagement preference. Prerequisite rolls and reactions continue to use their real rules.

## When the pack gives up

**Pack morale** groups combatants by scene, base wolf actor, alliance and **Pack group**. Duplicated tokens from the same wolf actor normally belong to one pack. Give separate packs different group names. Other actor types or actor documents are not silently incorporated. Wolves sharing a pack can contribute to its losses even if their individual automation is disabled.

The first automated turn records each member's maximum HP as the pack's initial HP capacity. Subsequent assessments retain the roster, including members removed from the scene/combat. Reinforcements are added without erasing a previous retreat decision.

A pack retreats when either:

- At least half its members are dead, defeated, dying, unconscious or gone from its combat roster; or
- Its remaining combined HP is **35% or less** of its recorded HP capacity.

A lone wolf instead retreats at **25% or less HP**. Retreat is shared in that Combat document's module flags and remains in effect after healing or reinforcements. A new combat starts fresh. Disable **Pack morale** to override the decision and resume fighting.

These are deterministic defaults, not morale saving throws. If enabled during an ongoing fight, existing casualties and wounds can immediately trigger retreat.

## How retreat executes

Retreating wolves stop choosing jaws attacks and Knockdown. They can Escape restraints, Stand or Crawl as appropriate and use native Stride/Step movement to leave. A critical Escape's free movement remains available when legal.

The planner seeks a reachable, unoccupied scene boundary at least **30 feet from every currently known eligible enemy**. A flood search guides it around physical obstacles rather than merely pushing it straight backward. If no safe boundary route is available, it can increase separation from known enemies. Each move still respects walls, occupied endpoints, willing allied passage, terrain measurement, diagonal history and action costs.

Reactive Strike and other supported reaction prompts still pause execution. Retreat does not teleport the creature or bypass a reaction, and death during a departure remains an incapacitation rather than a successful escape.

Once a wolf actually reaches a safe boundary, its unused actions are forfeited for this combat and it sits out future automated turns. **Its token and combatant remain for the GM**; the module does not delete it, mark it dead or hide it. Automatic turn advancement still requires the existing checkbox. The GM can remove escaped combatants from the tracker when convenient.

The boundary must be reachable on the map. Active Region behaviors, sealed rooms, unsupported movement and unresolved restraints can block retreat. A blocked wolf preserves its actions for GM review rather than inventing movement or claiming it escaped. Full perception, special senses and hazards remain outside this adapter's existing coverage.

## Review and tuning

Expand **Why this decision?** or open **Last decision**. Showcase, front-line engagement and retreat progress appear as explicit scoring factors, and a retreating pack's reason is recorded. Turn **Entertainment preferences** off to restore ordinary tactical scoring; turn **Pack morale** off to keep fighting regardless of losses. These are independent options.

Tests cover the previously reported negative Knockdown score, once-per-combat and once-per-turn preferences, legal prerequisites, shared loss and HP thresholds, healing, separate packs, native retreat movement with reactions, a lethal reaction, blocked movement, retirement and optional advancement. A running-world multiplayer smoke test remains necessary.
