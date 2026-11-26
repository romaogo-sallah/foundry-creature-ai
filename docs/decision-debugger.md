# Decision graph debugger

Select one taught NPC as GM, press **Alt+W**, and choose **Decision graph**. The graph calculates a fresh preview without spending actions, rolling dice, changing resources, or saving the control form.

To inspect an action the creature already took, choose **Last decision**, then **Open graph**. The complete most-recent trace is retained in memory; the persisted chat record remains compact, so reopening an older decision after a client reload can show fewer movement alternatives.

Version 0.48.0 displays the hierarchy produced by the decision worker. The renderer does not infer intermediate boxes from the final action list:

1. **Directives and legality** constrain the decision before utility is compared. Emergency withdrawal and PF2e action/resource limits cannot lose to an attractive attack score.
2. **Doctrine** is a multi-label vector for damage, control, support, defense, scouting, delivery modes and risk posture. A creature can be a caster, skulk and melee combatant at the same time.
3. **Battlefield and engagement facts** show what each known enemy can affect now, how many actions each side needs to engage, and the belief-safe visibility, cover, concealment and range data shared by later branches.
4. **Intent hypotheses** show all applicable tactical plans. The worker keeps at most four plans within the abstract score band instead of discarding every plan except the nominal winner.
5. **Engagement hypotheses** bind an intent to its selected target or desired combat state. A lower-scoring abstract intent can still win when it produces a better concrete method.
6. **Temporal commitments** distinguish immediate payoff, setup with a same-turn payoff, next-turn setup, holding, recovery and disengagement.
7. **AND methods** represent activity bundles and component-generated ways to satisfy the engagement. Their primitive cards show exact targets, costs, score terms and any ordered `turnPlan` timeline. Multi-action activities retain their atomic action cost.
8. **Outcome** identifies the primitive that will execute next. Red branches record bounded rejection evidence; additional low-level rejections are summarized to keep large caster graphs readable.

The compact decision stored on a chat message omits the large planning trace. The current client keeps the complete latest trace in memory, and a fresh **Decision graph** preview always calculates one. Reopening an older chat decision after reloading can therefore show the legacy compact view.

Use the checkboxes to hide pruned hypotheses, rejected candidates, or legacy score-term nodes. Drag the canvas to pan. The mouse wheel zooms relative to the current level and keeps the point beneath the cursor fixed; trackpads and line/page scrolling use the same scale. Search by node label, and use **Fit** to restore the full view. **PNG** exports the current visible graph. **JSON** exports the complete graph data for bug reports.

The renderer is Cytoscape.js 3.35.0, distributed under the MIT license. Its built-in directed breadth-first layout keeps the debugger self-contained and offline while supporting pan, zoom, filtering, selection, and image export. The vendored license is included beside the runtime library.

Foundry 14 defines a read-only `Array.prototype.equals`. Cytoscape also names a collection method `equals`, so the vendored build creates a writable property on its own collection prototype before installing that method. It does not modify Foundry's global Array prototype.

The decision graph is GM-only. It uses the same prepared belief state as the AI, so secret check results that the actor does not know are not added to the graph.
