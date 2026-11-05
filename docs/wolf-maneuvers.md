# Wolf maneuvers — version 0.6.0

Version **0.7.1** additionally supports [PF2e Automations' dedicated grapple effects](wolf-escape-automation.md). For those validated effects, Escape removes the granting effect and uses its recorded attacker when available. The earlier limitations on arbitrary locked/granted effects below still apply to other sources.

This update adds Step, Crawl, Escape, prone choices, conservative physical attack-path checks, and outcome-based remaster Knockdown valuation. The shared Dawnsbury 4.44 comparator and basic Pack Attack evaluator remain unchanged. These new Foundry action handlers and maneuver values are explicit adaptations, not newly discovered DD wolf code.

## Using the update

Reload every connected Foundry client with **Ctrl+F5**. Existing wolves keep their configuration and action budget. Use **Alt+W → Preview**, **One action**, or **Run turn** as before.

If a wolf becomes Grabbed, Restrained or Immobilized, manually applied conditions often do not identify the creature or effect that caused them. Before spending an Escape action, the GM is asked to choose the holder or enter the effect's known Escape DC. This is needed to avoid guessing the source or deleting unrelated restraints. The GM confirms that Escape can end that cause.

- Choose a holding creature to use its current prepared Athletics DC.
- Enter a custom DC for an effect, object, or a different defense required by that source. A custom DC overrides the selected creature's Athletics DC.
- **Handle manually**, closing the dialog, Stop, or changing the turn cancels setup without spending an action.
- Use **Alt+W → Escape sources** to edit the setup for currently applied restrictions while the runner is stopped.
- A saved source applies to that condition instance. Removing it and applying a new condition instance requires new source setup. Replacing the selected source actor invalidates the old binding.

## Implemented actions

| Action | Execution and accounting |
| --- | --- |
| Step | One action; at most 5 feet; land Speed at least 10 feet; does not offer movement-triggered Reactive Strike. Difficult-terrain movement cost, wall constraints, occupied endpoints and turn diagonal parity are checked. |
| Crawl | One action; at most 5 feet of measured ground movement; stays Prone. Can provoke Reactive Strike and waits for it. Native `crawl` waypoints are used; native crawl cost multipliers are accounted for separately from the five-foot displacement limit. |
| Stand | One action; only when Prone and able to use a move action. Duplicate removable Prone entries are cleared together and verified. Locked or temporary Prone sources exclude Stand without prohibiting other legal actions. Its reaction occurs after standing resolves. |
| Escape | One action, with the attack trait. Selects the largest modifier among PF2e's prepared unarmed, Acrobatics and Athletics previews. Applies current MAP and increases the attack count once. |
| Knockdown | One action immediately after the qualifying successful jaws Strike against the same target. Remaster Trip ignores MAP and does not increase it. Legacy automatic Knockdown remains distinct. |

Step movement is submitted as native walking waypoints because Foundry's standard movement-action configuration has no separate Step entry. The AI's action kind records Step and suppresses its own movement reaction handler for that move. Integration with unrelated modules that independently react to token updates is not established by this implementation.

Step and Crawl use native whole-path measurement, including previously recorded diagonal movement. They do not receive a fresh cheap diagonal by resetting history. Since **0.10.3**, Define Surface geometry uses native movement constraints; other active Region behaviors still require manual movement. This does not add general hazardous-terrain handling or navigation between elevations and scene levels.

## Grabbed, Restrained and Escape outcomes

A Grabbed wolf can still use its jaws. It cannot Stride, Step, Crawl or Stand while Immobilized by the hold. Restrained prohibits normal attacks, so the supported attack exception is Escape.

An Escape removes only its selected removable condition root and the restrictions granted by that root. It does not delete every Grabbed/Restrained/Immobilized entry. A condition granted by an unrelated effect, a locked root or a temporary source requires manual handling; the module does not delete an arbitrary spell/effect to end it.

- **Success:** remove the selected cause, then rebuild the wolf's state and choices.
- **Critical success:** also offer the optional Stride of up to 5 feet when legal and useful. This costs no additional action and adds no MAP. It can provoke reactions. It must be used immediately; another action or Correct counts forfeits it. It cannot be used while Prone or still Immobilized by another cause.
- **Failure:** the action and increased MAP remain spent; the wolf may choose another legal action, including another Escape.
- **Critical failure:** no further Escape that turn, including against another cause. A Grabbed wolf can still bite if a target is available. If no supported action remains, a full run ends the turn with unused actions recorded as forfeited and advances only when configured.

An uncertain or cancelled roll retains its reservation and needs **Correct counts** after checking the outcome. A condition that has already ended before execution is a known unexecuted skip and costs nothing. The critical-failure Escape restriction persists across retries of the same turn and resets with the next turn; Correct counts does not silently remove that restriction.

For a custom DC with no opposing creature, PF2e's action API is explicitly targeted at the escaping actor. Omitting the target would make the installed API use the GM's target tool, possibly bringing an unrelated creature's context into the check. Standard wolf checks are supported; unusual effects conditional on target identity require a compatibility review.

## Decisions and estimates

The ordinary DD preference for standing remains when safe and useful. Under a known reaction threat, or with only one action left to bite, the wolf can choose a prone Strike instead. Native PF2e supplies the Prone attack penalty; the adapter does not subtract it a second time. Crawl can compete when movement is legal. Immobilized wolves cannot Stand because Stand has the move trait.

Maneuver scores are estimates, not additional rules:

- **Known movement reaction exposure:** one wolf-average-damage proxy per available opposing reactor along the path. A reactor is counted once for the move. Step removes this exposure. The model does not predict each opponent's exact damage or special reaction riders.
- **Remaster Knockdown:** enumerate the 20 possible Athletics results against an estimated Reflex DC, using the existing encounter-level benchmark. Value causing Prone using a one-action pressure estimate and possible follow-up attack improvements. Estimate one attack per nearby ally using wolf statistics, not a full allied turn. Add critical Trip damage, subtract the estimated cost of becoming Prone on a critical failure, and retain the recovered Pack Attack tactical preference.
- **Escape:** estimate success and critical failure at current MAP against the configured source DC. Escaping is valued more when restraint prevents other useful actions. This is a greedy cause choice; it does not solve all sequences of multiple simultaneous restraints.

The Knockdown model does not inspect a target's undiscovered base Reflex DC. Its own native Trip roll uses the actual defense. An already-Prone wolf is not charged for falling Prone again. A target using native Swim movement mode is excluded from Knockdown; general water, flying and climbing state handling remains incomplete.

Preview displays the ranking layer and value. Chat-message flags also store the chosen maneuver's probability/value estimate for inspection. The model is not a guarantee of optimal animal tactics.

## Physical attacks and remaining scope

Jaws, Knockdown reach checks, pack-support eligibility and Reactive Strike now require a physical movement-collision ray in addition to the relevant sight checks. This prevents a clear sight ray through a solid transparent wall from authorizing an attack. It is conservative for low or partial barriers and **does not implement a full line-of-effect or cover solver**.

This release does not add low-light/scent detection, Seek, hidden/concealed-target flat-check handling, Quickened/restricted action pools, commanded minions, other reaction types, Ready/Delay, arbitrary movement modes, recovery actions or morale. Those remain separate audit items.

## Verification

The automated suite includes Step speed/terrain/diagonal limits, movement through allies, Crawl reactions while staying Prone, prone/Grabbed attacks, Restrained attack restrictions, physical barriers, source-specific Escape deletion, DC selection, cancellation, MAP/retries, the critical-failure lockout, optional critical-success movement and remaster Knockdown risk choices. Existing reaction barriers, actor death, healing, duplicate-Prone protection and turn-passing tests are retained. The shared DD oracle comparison still has zero mismatches.

The native PF2e API signatures and Foundry movement behavior were inspected locally. A full running-world/multiplayer smoke test of these new maneuvers remains necessary. A useful first check is a wolf beside a reach-weapon fighter: test Step, then Prone, then Grabbed with the fighter selected as its holder. Check one Escape failure and one critical success before testing automatic turn passing.

Rules: [Step](https://2e.aonprd.com/Actions.aspx?ID=2304), [Escape](https://2e.aonprd.com/Actions.aspx?ID=2296), [Prone](https://2e.aonprd.com/Conditions.aspx?ID=88), [Knockdown](https://2e.aonprd.com/MonsterAbilities.aspx?ID=46).
