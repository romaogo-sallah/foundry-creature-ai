# Decision graph debugger

Select one taught NPC as GM, press **Alt+W**, and choose **Decision graph**. The graph calculates a fresh preview without spending actions, rolling dice, changing resources, or saving the control form.

To inspect an action the creature already took, choose **Last decision**, then **Open graph**. The complete most-recent trace is retained in memory; the persisted chat record remains compact, so reopening an older decision after a client reload can show fewer movement alternatives.

The debugger displays the runtime decision pipeline rather than pretending the AI is a binary tree:

1. **Situation** contains the prepared combat facts available to the NPC.
2. **Tactic stages** show the preferred, backup, and desperate choices. The stage actually used is green. A backup is tried only when the preferred plan produces no useful legal action; deliberate hiding, laying-low, and withdrawal holds remain valid decisions.
3. **Tactical plans** show every configured plan, including **Ranged engagement**. The selected plan is green. Plans whose conditions were not met remain visible as inactive nodes.
4. **Behavior components** show the actor's attached ECS-style abilities and policies. Only the components active under the selected plan feed the action ranking.
5. **Action ranking** shows legal candidates ordered by Dawnsbury priority layer and then value. The chosen option is green; weighted-roll candidates are gold and include their probabilities; equal best options are blue; rejected candidates are red.
6. **Score terms** show the recorded contributions that produced an action's value. Selecting any node opens its exact serialized diagnostic data.

Use the checkboxes to hide inactive plans/components, rejected candidates, or score terms. Drag the canvas to pan. The mouse wheel zooms relative to the current level and keeps the point beneath the cursor fixed; trackpads and line/page scrolling use the same scale. Search by node label, and use **Fit** to restore the full view. **PNG** exports the current visible graph. **JSON** exports the complete graph data for bug reports.

The renderer is Cytoscape.js 3.35.0, distributed under the MIT license. Its built-in directed breadth-first layout keeps the debugger self-contained and offline while supporting pan, zoom, filtering, selection, and image export. The vendored license is included beside the runtime library.

Foundry 14 defines a read-only `Array.prototype.equals`. Cytoscape also names a collection method `equals`, so the vendored build creates a writable property on its own collection prototype before installing that method. It does not modify Foundry's global Array prototype.

The decision graph is GM-only. It uses the same prepared belief state as the AI, so secret check results that the actor does not know are not added to the graph.
