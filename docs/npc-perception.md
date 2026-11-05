# Automatic NPC Seek — version 0.19.2

Patch **0.19.2** retains Seek when observed opponents exist but cannot currently be attacked or approached usefully. Known suspected squares remain legal movement goals. If ordinary engagement choices are exhausted, a bounded investigation move can choose another clear viewpoint near the known area, spending a Step/Stride-only action first when available. Equivalent useful positions can be chosen randomly. The following Seek still costs an ordinary action; a restricted move never supplies that cost. These choices use remembered geometry, never an Undetected creature's current coordinates. Known areas entirely blocked by LOS are approached first rather than treated as visible through a field search.

**0.19.0:** at the GM's request, the default **NPC Seek search scope** is now **Simplified: all opposing creatures not blocked by LOS**. This deliberately broadens the normal search-area rule. One secret check resolves eligible creatures across that field; walls, surfaces, elevation/level, invisibility and separate Stealth DCs remain relevant. The original bounded-area mode remains selectable in module world settings.

Wolf, Ogre, Ogre Boss and Kobold Scout now share a Seek capability. It runs during their normal automated turns without a GM roll prompt or an extra checkbox. Reload all connected clients with **Ctrl+F5** after installing.

## Rules and action flow

[Seek](https://2e.aonprd.com/Actions.aspx?ID=2301) is a one-action, concentrate, secret Perception check. One roll is compared separately with the Stealth DC of each eligible hidden or undetected creature in its search area. A success makes an undetected creature Hidden or a Hidden creature Observed. Critical success can make either Observed. Invisibility still prevents observation using ordinary vision, so a located invisible creature remains Hidden. Failure does not change detection or refund the action. Seek neither applies nor increases MAP.

The handler uses PF2e's prepared native Perception roll with dialogs skipped and blind GM visibility. Native modifiers and natural 1/20 degree changes remain relevant. Explicit region cover contributes its Stealth bonus to the opposed DC without adding a second circumstance bonus over an existing one. It does not remove cover or concealment.

Once the check resolves, the same turn runner rebuilds state and continues choosing actions. It may Seek again, approach, attack a located target or choose another enemy. Three failed searches can consume the turn normally; automatic advancement then follows the existing option. Stop, reactions, human pacing, turn changes and uncertain reservations use the existing execution flow. A cancelled roll keeps its reserved action for inspection.

## Choosing an area without hidden information

In simplified field mode, the search has no centre and does not read live hidden coordinates to choose an aim. Execution scans eligible opposing combatants with an unblocked native sight ray on the observer's elevation and level. An alert encounter with opposing creatures but no known squares can trigger this general search without first locating any creature. GM-hidden tokens are excluded and do not supply search incentives.

In bounded mode, the search is a 15-foot-radius area centered on an enemy's remembered square, offered when that square is within 30 feet of the NPC. This is the module's bounded area policy under the remastered rule that the GM determines the area; it is not a claim that every Seek must use this shape or distance. More distant remembered positions remain movement goals so the creature can approach before searching.

The planner uses known observations, its own Perception modifier and the existing encounter benchmark to estimate new information. It never uses the enemy's actual Stealth DC, secret check degree or current undetected coordinates to aim or score a search. An Observed opponent normally gives the policy an engagement option; if attack and useful approach are blocked, the NPC may continue Seeking instead of stopping. In bounded mode a previously unknown opposing combatant can be found if it happens to be in the chosen area, but no unknown creature supplies its centre. Searching an empty old location does not follow the enemy to its new square. Field mode explicitly searches the visible field and is not silently presented as the standard bounded rule.

The first implementation uses ordinary visual search on the same elevation and scene level. Native sight walls and surfaces block it. A solid obstacle remains a movement problem; Seek does not see through it. GM-hidden tokens are excluded. Blind search, hearing through walls, scent, tremorsense, special ranges, darkness/light exceptions, traps and secret doors remain GM adjudication. Point Out and player-triggered Seek are not automated by this handler.

## Observer-specific results and attacks

A result changes only this observer's entry in the subject's `stealth` flag and the observer's `perception` mirror. Other observers' results and the subject's global/manual/granted Hidden, Undetected or Invisible conditions remain intact. Successful Seek can override a global Hidden/Undetected condition for this observer; adding a new stealth condition invalidates that override. A newer Hide or movement during the pending roll is preserved instead of overwritten. The normal visibility, captions and target-memory refreshes read the resulting effective state.

Perception discovery is sensory information: the NPC can act on a newly located square. The subject's own belief about whether its secret Hide/Sneak succeeded is not updated by being found. Actual roll totals and opponent DCs do not enter decision scores.

Hidden means the current square is known. Taught NPCs can attack it with the automatic DC 11 targeting check; an invisible creature found by Seek therefore does not trap them in an endless attempt to observe it. Observed but concealed targets use DC 5. Seek does not clear fog or an ordinary Concealed condition. Undetected enemies retain only their old search position and are not valid targeted attacks in this implementation. Guessing an undetected square remains manual.

Tests cover action/MAP costs, native blind rolls, per-observer transitions, mixed DCs with one die, cover stacking, invisibility, area/LOS/level limits, unknown creatures within a chosen area, stale results, preserved global conditions, target-memory safety, movement before searching, and automatic advancement after failed checks.
