# Lich–vampire tactical review — 0.43.6

The reviewed Stadium combat contained two Liches against a Vampire Mastermind, two Vampire Counts and a Vampire Guardian. The retained Creature AI reports were produced by 0.43.3; later teleport safety fixes are separate. This review uses decisions and public encounter state, not secret check outcomes.

## Findings

The strongest turns already worked. One Lich used Chain Lightning twice and followed with Force Barrage; the Mastermind opened with Wall of Fire, used Haste on itself and the Guardian, crossed the pit, and entered melee. The Guardian eventually closed, prepared its weapon and attacked.

Four recurring errors made the battle less decisive:

1. Counts treated their 30-foot Dominate gaze as if it made them protected long-range casters. At roughly 80–100 feet they selected Defensive, took repeated Steps, Hid, or ended with actions left instead of crossing the field.
2. Both Liches spent full turns on Wall of Ice without considering an allied wall already shaping the field or whether the separated opponents were nearby melee pressure. The two barriers helped create a mutual no-line-of-sight standoff.
3. A Lich cast See the Unseen because opponents were Hidden. Ordinary Hide, blocked sight and imprecise detection do not make that spell useful; the spell answers known Invisibility, incorporeal creatures and illusions.
4. A planned Long Jump used a run-up crossing an intact Wall of Ice, so native movement stopped before takeoff. The execution correctly retained the spent activity, but planning should never have offered that route.

## Implemented plan

Short-range spellcasters with prepared melee Strikes are now classified as melee hybrids unless they retain an available hostile spell beyond 30 feet. Their spell-control plan may move into effective range. Approach value is proportional to actual route progress, but only when no useful action is available in the current square and at least two actions remain. A caster therefore does not abandon an available two-action spell for shelter and does not spend its last action walking toward melee.

Wall of Ice is explicitly a control spell. Its value rises against nearby melee pressure and a wounded caster, falls against distant ranged/caster targets, and receives a saturation penalty for each intact allied managed ice wall. This is a tactical estimate, not invented damage. Another wall remains possible when immediate melee pressure makes it worthwhile.

See the Unseen now requires a known Invisible condition in the observer's snapshot. The snapshot records that fact only for a located target whose live Invisibility explains precision loss. It does not copy Hide/Sneak results or treat observer-relative Hidden as a global condition.

Pit Leap and Long Jump planning now validates every run-up and jump segment against intact managed ice-wall geometry. An impossible route is rejected before actions are reserved.

## Verification and limits

The parallel suite passes 1,212 tests in 11 isolated processes. New regressions cover the supplied Vampire Count's long approach, Hidden versus known Invisible spell choice, allied ice-wall saturation, and pit jumps through magical walls. Build, installation and archive checks are recorded in the [verification record](../research/lich-vampire-tactics-verification-2026-11-11.json).

Wall placement remains limited to the supported straight horizontal/vertical geometry. The planner does not simulate future wall destruction or every ally's multi-turn route. See the Unseen does not yet score incorporeal creatures hidden inside an object or suspected illusions; those need explicit observer knowledge rather than inspection of secret state. A new live encounter is still required to compare the revised tactics under actual initiative, dice and player decisions.
