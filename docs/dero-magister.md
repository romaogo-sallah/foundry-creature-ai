# Dero Magister — 0.40.0

The [shared caster framework](spellcaster-framework.md) now discovers its innate and spontaneous spells together and supports 13 unique spells: Blindness, Daze, Forbidding Ward, Force Barrage, Grim Tendrils, Laughing Fit, Paranoia, Phantom Pain, Soothe, Stupefy, Telekinetic Maneuver (Trip), Vampiric Feast and Void Warp. The detailed 0.38.0 investigation below explains the earlier limited kit; its untaught-spell list is historical. Current unresolved spells and component limits are listed in the shared framework document.

The supplied `fvtt-Actor-dero-magister-F523OUefhXqIWdbS.json` is a level-5 Monster Core Dero Magister with occult spontaneous DC 24 spellcasting, 4/4/3 spell slots and a separate innate entry. Profile detection uses its compendium provenance. Imported descriptions remain data; none execute as code.

Select its unlinked scene token, open Alt+W, save its AI settings and run or enable automatic turns as for the other creatures. This release teaches a specific combat subset:

| Ability | Execution |
| --- | --- |
| Laughing Fit | Two actions, native rank-2 slot and Will save; reaction denial, Slowed 1 or an initial no-actions phase; automatic Sustain/expiry |
| Stupefy | Two actions, native rank-2 slot and Will save; source-tracked Stupefied 1/2/3 with result-specific expiry |
| Blindness | Two actions, native rank-3 slot and Fortitude save; brief, minute-long or permanent Blinded, plus one minute of temporary immunity even on a critical success |
| Void Warp | Two actions, heightened native cantrip damage and basic Fortitude save; Enfeebled 1 until the caster's next turn on a critical failure |
| Vampiric Feast | Two actions, native rank-3 slot, touch range, basic Fortitude save and void damage; half the damage actually taken becomes native temporary HP for one minute |
| Cytillesh Stare | One action once per round, native Will save and incapacitation adjustment; Dazzled for one round and Confused on failure |
| Sustain | One action per ongoing spell, once per turn; retained only while its declared target remains relevant |
| Staff | Native melee Strike with the current MAP |

Native saves retain condition modifiers and incapacitation adjustments. Native GrantItem rules grant conditions, respect condition immunities and remove only this source's contribution. A native Dero inspection confirmed that its immunity to Confused suppresses that condition while Dazzled still applies. Stupefied 3 lowered its native spell DC from 24 to 21. The original inspection mistakenly persisted diagnostic actors; their cleanup and the corrected in-memory workflow are documented in [Foundry diagnostics](foundry-diagnostics.md).

The existing shared caster forecast budgets a two-action spell plus a one-action gaze or Sustain, or a move plus a spell. Once-per-turn capability keys prevent forecasting three gazes or repeatedly Sustaining the same spell. Gaze is planned before Blindness when combining them; a recent declared Blindness attempt suppresses another visual gaze against that target.

Control ranking uses benchmark saves and bounded estimates of lasting benefit. It does not inspect actual opposing save modifiers. Declared spell attempts and concentration commitments are recorded independently of hidden save outcomes, preventing a secret critical success from directly revealing itself through a different AI plan. The caster can consequently maintain an ineffective spell when it has no evidence the effect failed. Its own current prepared spell DC and resources remain known.

Version 0.38.0 adds **Spell control**, **Spell assault** and **Life drain** plans to the shared caster framework. The plans compare affordable casts now and after one move, weigh known reaction exposure at the destination, and retain ordinary survival/legality gates. They favor useful opportunities rather than impose a fixed spell rotation. A close living target and a useful temporary-HP buffer can justify Feast; distant control remains valuable when approaching would be unsafe. No opposing HP, save modifiers or hidden save results are read to choose these plans. Control-spell retry memory no longer suppresses repeated damage cantrips.

Feast's native damage update supplies the post-resistance amount, including overkill or damage absorbed by temporary HP. A native TempHP rule grants a separate owned effect; higher existing temporary HP are preserved, sources never stack, and expiry removes only the matching source. With automatic damage disabled, casting pauses for manual damage/temporary-HP resolution. Manual PC Feast remains with its normal sheet/module controls; this release adds the managed AI handler, while the shared condition module owns the resulting timed effect.

The previous battle logged five Blindness casts, four Laughing Fits and one Void Warp. Feast was in the manual/unsupported list throughout, including when enemies were already in touch range. Its absence was a missing capability rather than evidence that the evaluator preferred Blindness over a supported Feast.

The remaining spell list is explicitly untaught, including Phantom Pain, Daze, Soothe, Forbidding Ward, Force Barrage, Paranoia, Levitate, Darkness, Revealing Light, Telekinetic Maneuver and the utility/innate spells. Dero Medicine and sunlight exposure are also manual. This profile does not claim general arbitrary spell support.

Confused NPCs use the simple attack override from 0.37.0; slot spells such as Feast remain forbidden. Blinded NPCs use hearing, Hidden-square targeting, DC 11 flat checks and difficult terrain from version 0.34.0; Undetected live coordinates stay unavailable to planning. Dazzled NPCs continue using the ordinary targeting flat-check pipeline. PC condition enforcement and manual saving throws are described in [condition handling](condition-handling.md).

Rules checked against the supplied native spell item and Paizo's [Scourge of Sheerleaf character supplement, page 10](https://downloads.paizo.com/ScourgeofSheerleaf_Supplement.pdf).
