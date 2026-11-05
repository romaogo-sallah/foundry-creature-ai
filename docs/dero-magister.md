# Dero Magister — 0.33.0

The supplied `fvtt-Actor-dero-magister-F523OUefhXqIWdbS.json` is a level-5 Monster Core Dero Magister with occult spontaneous DC 24 spellcasting, 4/4/3 spell slots and a separate innate entry. Profile detection uses its compendium provenance. Imported descriptions remain data; none execute as code.

Select its unlinked scene token, open Alt+W, save its AI settings and run or enable automatic turns as for the other creatures. This release teaches a specific combat subset:

| Ability | Execution |
| --- | --- |
| Laughing Fit | Two actions, native rank-2 slot and Will save; reaction denial, Slowed 1 or an initial no-actions phase; automatic Sustain/expiry |
| Stupefy | Two actions, native rank-2 slot and Will save; source-tracked Stupefied 1/2/3 with result-specific expiry |
| Blindness | Two actions, native rank-3 slot and Fortitude save; brief, minute-long or permanent Blinded, plus one minute of temporary immunity even on a critical success |
| Void Warp | Two actions, heightened native cantrip damage and basic Fortitude save; Enfeebled 1 until the caster's next turn on a critical failure |
| Cytillesh Stare | One action once per round, native Will save and incapacitation adjustment; Dazzled for one round and Confused on failure |
| Sustain | One action per ongoing spell, once per turn; retained only while its declared target remains relevant |
| Staff | Native melee Strike with the current MAP |

Native saves retain condition modifiers and incapacitation adjustments. Native GrantItem rules grant conditions, respect condition immunities and remove only this source's contribution. A native Dero inspection confirmed that its immunity to Confused suppresses that condition while Dazzled still applies. Stupefied 3 lowered its native spell DC from 24 to 21. The original inspection mistakenly persisted diagnostic actors; their cleanup and the corrected in-memory workflow are documented in [Foundry diagnostics](foundry-diagnostics.md).

The existing shared caster forecast budgets a two-action spell plus a one-action gaze or Sustain, or a move plus a spell. Once-per-turn capability keys prevent forecasting three gazes or repeatedly Sustaining the same spell. Gaze is planned before Blindness when combining them; a recent declared Blindness attempt suppresses another visual gaze against that target.

Control ranking uses benchmark saves and bounded estimates of lasting benefit. It does not inspect actual opposing save modifiers. Declared spell attempts and concentration commitments are recorded independently of hidden save outcomes, preventing a secret critical success from directly revealing itself through a different AI plan. The caster can consequently maintain an ineffective spell when it has no evidence the effect failed. Its own current prepared spell DC and resources remain known.

The remaining spell list is explicitly untaught, including Phantom Pain, Daze, Soothe, Forbidding Ward, Force Barrage, Paranoia, Levitate, Darkness, Revealing Light, Telekinetic Maneuver and the utility/innate spells. Dero Medicine and sunlight exposure are also manual. This profile does not claim general arbitrary spell support.

Confused or Blinded NPC decision-making still requires GM adjudication. Their conditions and durations apply automatically, but the AI does not invent confused targeting or precise attacks using unseen live positions. Dazzled NPCs can continue using the ordinary targeting flat-check pipeline. PC condition enforcement and manual saving throws are described in [condition handling](condition-handling.md).
