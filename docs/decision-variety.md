# Decision variety

Creature decisions used to be deterministic after legality and tactical scores were known, except for uniform rolls between exact comparator ties. Version 0.46.0 adds an optional bounded weighted roll so repeated encounters can produce different good decisions without letting obviously poor actions win.

Open **Alt+W** for a taught NPC and set **Decision variety** from 0 to 100 percent. The form proposes 35 percent. Saving the creature, running one action, or running its turn persists that value. Existing creatures without this saved field retain deterministic behavior until their controls are saved again. A value of 0 preserves strict ranking and only randomizes exact ties.

The chooser first applies legality, action costs, tactical components, priority layers, and reaction-aware safety. Variation then operates under these limits:

- It never crosses a priority layer. A lower-layer action cannot enter the roll even when its numeric value is large.
- Only ordinary positive action layers 5 and 6 are eligible. Mandatory/recovery choices in layer 7 and navigation/fallback layers 1–4 remain strict.
- The highest score defines a bounded competitive band. At 100 percent, its width is 15 percent of the best score, clamped between 2 and 10 value points. The configured percentage scales that width linearly.
- Candidates outside the band are excluded. Within the band, exponential weighting makes the best score most likely and rapidly reduces the probability of lower scores.
- Exact ties remain uniform. Creature overrides, safe Step handling, door fallbacks, Fleeing, and Confused directives keep their existing precedence.

Every decision stores the random sample, eligible IDs, score band, weights, and normalized probabilities. **Alt+W → Decision graph** colors the pool gold and labels each option with its chance. The chat explanation records the same probabilities from the completed decision and does not reroll while rendering it.

The roll uses the decision worker's pseudorandom source. It is intended to vary play rather than reproduce a seeded encounter. Set the control to 0 when exact replay is required.
