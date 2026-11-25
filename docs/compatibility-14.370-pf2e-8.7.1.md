# Foundry 14.370 and PF2e 8.7.1 compatibility review

Version 0.44.0 was reviewed against the locally installed Foundry 14.370 and PF2e 8.7.1 bundles, then tested as five independently built modules.

## Changes used by the suite

- Foundry 14.370 adds Grid Space Region and Measured Template shapes, including holes. Water and other tactical Regions can now match individual grid cells without a hand-drawn polygon.
- Foundry 14.370 fixes wall-constrained Region geometry across Levels and several invalid-Level placeable problems. The suite continues to use native Region and Level geometry rather than replacing those fixes.
- PF2e 8.7 moves more token management to Foundry's upstream movement API. Step, Sneak, ramps, pits and Water continue through `TokenDocument.move`, `preMoveToken`/`moveToken`, native path completion and native cost measurement.
- PF2e 8.7 permits a nullable land Speed. Shared speed access now treats a missing or null prepared land Speed as zero while retaining prepared Fly, Swim and Climb Speeds. Landless creatures no longer fall through to the removed legacy `system.attributes.speed` object.
- PF2e 8.7 places templates on the currently viewed Level. Managed spell placement receives that correction from PF2e without a parallel module rule.
- PF2e 8.7.1 fixes reevaluated grants on unlinked tokens and adds native Keen support for NPC Strikes. The AI uses PF2e's prepared actor data and native Strike rolls, so both fixes apply without custom copies.

## Reviewed but not adopted

The new `createTokenMesh` hook does not replace observer-relative Hidden rendering, because the suite changes whether a token is rendered for a particular observer rather than how its mesh is constructed. The shared PF2e spell-list UI components do not expose a combat-evaluation API and therefore do not replace the caster component registry. Foundry's Swim action remains a movement-action descriptor; the Water behavior still has to provide a bounded volume and PF2e action budget.

Package manifests declare Foundry 14.370 as verified and accept PF2e 8.6.1 through 8.7.1. Earlier 8.6.1 support is retained through prepared/legacy speed access, while 8.7.1 is the installed verification target.

Official release notes: [Foundry 14.370](https://foundryvtt.com/releases/14.370), [PF2e 8.7.1](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-8.7.1), and the [PF2e 8.7.0 changelog](https://github.com/foundryvtt/pf2e/blob/v14-dev/CHANGELOG.md#870).
