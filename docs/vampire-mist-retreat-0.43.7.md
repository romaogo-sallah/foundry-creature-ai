# Lich–vampire tactical follow-up — 0.43.7

The same retained Stadium combat was reviewed after the 0.43.6 engagement fixes. Its 57 AI reports came from Creature AI 0.43.3, before either correction. The effective decisions were already clear: the Liches exploited Chain Lightning and Force Barrage, while the Vampire Mastermind used Wall of Fire, Haste, Fireball and melee pressure. The remaining severe failure was a critically wounded Vampire Count selecting **Avoiding** but ending a turn with all three actions because no supported ground withdrawal improved its position.

## Implemented plan

Turn to Mist is now an emergency withdrawal option for a true vampire at 25% HP or less. It requires at least two actions, a known opponent and a reachable scene edge. It competes normally with attacks and other useful actions instead of forcibly replacing a strong offensive opportunity.

Before transforming, the vampire evaluates the four scene edges against only observed or remembered enemy squares. It tries the safest edge first, falls back to another reachable edge if geometry blocks that route, and stores the chosen edge. The mist therefore does not inspect secret live positions and does not change direction every time the turn replans.

The cycle is deliberately bounded:

- Turn to Mist costs one action and uses the native unlimited Vapor Form effect.
- Remaining actions Fly at Vapor Form's 10-foot Speed toward the stored edge.
- After two Fly actions, reaching that edge, encountering a blocked route, or beginning the next turn, the vampire reforms for one action.
- Voluntary mist never selects `escapeScene`; only the distinct 0-HP Mist Escape lifecycle can remove the vampire from the encounter.
- The AI starts this emergency cycle at most once per combat. A new combat identifier permits it again.

This is a table policy for useful, finite automation—not a claim that PF2e limits the at-will Turn to Mist action to once per encounter. The limit prevents invulnerable-feeling transformation loops and keeps the creature participating in the fight.

## Rules and movement

The supplied statblocks define Turn to Mist as becoming vapor as *vapor form*, or returning to normal. The implementation continues to use PF2e's native Vapor Form effect rather than reproducing its resistances and action restrictions. Its retreat route uses actual scene walls and surface collision.

Wall of Fire remains a no-save damage zone in this automation: a creature takes its fire damage when crossing it or beginning its turn inside it, with normal immunity, weakness and resistance handling. The AI already prices the expected crossing damage into movement; this pass does not invent a saving throw for Liches.

## Limits

The retreat chooses a scene edge, not a coffin location, secret passage or arbitrary safe room. It does not predict future enemy movement. A fresh live replay is still needed to compare the revised emergency behavior under actual initiative and dice.

Build, test, archive and installation checks are recorded in the [verification record](../research/vampire-mist-retreat-verification-2026-11-11.json).
