# Ogre Boss withdrawal and caption investigation

The last Arena battle reached round 19. In rounds 18 and 19 the Ogre Boss ended its turn with all three actions, 47/130 HP, no javelins and two known Kobold Scouts at 45 and 65 feet. Both decision logs selected **Avoiding**, reported 80 reachable destinations and no movement obstruction, then offered only End Turn. This was a decision-provider gap, rather than a failed Escape check or a blocked Foundry move.

The withdrawal provider stopped offering movement at 30 feet. The profile's ordinary approach moves were then correctly rejected because they closed on threats while disengaging. Existing concealment also offered little new protective benefit. Together those rules left no action, although the scouts' known ranged weapons could still threaten the boss. In round 17, an overly valuable Regrip also displaced retreat preparation despite no immediate attack.

Version 0.37.3 replaces the fixed cutoff with estimates of known weapon reach/range, physical firing paths, cover/concealment and movement risk. It prioritizes an available useful retreat over preparing an unusable distant weapon. Safety distances remain tactical heuristics; they do not change legal attack range or guarantee immunity from retaliation. A truly sheltered or trapped NPC can still hold, with a specific explanation.

A read-only native preview of the same round-19 position now selects a 25-foot Stride to grid (34, 18), rather than ending the turn. The preview did not move the boss, roll checks, spend resources or advance combat.

Caption shimmer came from two modules writing the same PIXI tooltip: native/elevation refresh cleared the tactical suffix and our deferred repair appended it again. Tactical captions now have a separate native text child. Elevation stays owned by Foundry/Global Auto Level Change. With GALC enabled, 120 native refreshes caused zero tactical-text writes, zero blank caption states and zero additional geometry queries. Deselecting removes the caption, and token redraw recreates exactly one child.

Validation: 993 automated tests passed, followed by native scene rendering, redraw and decision-preview checks. See [verification record](../research/retreat-caption-verification-2026-11-06.json).
