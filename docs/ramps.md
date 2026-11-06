# Manual ramps and stairs — 0.36.1

Ramps belong to **PF2e Tactical Rules — Movement** and work with Creature AI disabled. They are ordinary walking connections, not ladders or Climb actions.

1. Open Foundry's **Scene Region** tools and draw a Region over the full ramp or stairs. Rectangles, rotated rectangles, polygons, circles and ellipses are supported. Use ordinary shapes, not grid-based templates. Holes retain their normal geometry.
2. Open the Region's **Behaviors**, add **Ramp / stairs**, and save it.
3. Set **Lower elevation**, **Upper elevation**, and **Uphill direction**. For stairs rising from ground to a 10-foot platform toward the top of the map, use **0**, **10**, **North**. Elevations use the scene's distance units and token bottom elevation.
4. Start a token at the low edge and move normally. Height follows the slope in either direction; no teleport, climb roll or additional action is introduced. Native movement costs, walls and reaction handling still apply. Step and Sneak retain their usual limits.

The token-controls **Ramps / stairs** button is an alternative editor: select a Region, load its values, then **Save ramp**. It creates the same native behavior. Later edits can use either this helper or the standard behavior sheet. Legacy ramps prefill their elevations and nearest compass direction; saving replaces their fixed axis with the Region's full shape.

The Region's full extent in the chosen compass direction defines the low and high ends. Moving or resizing its shape moves those ends automatically. Its shape controls the width. Disable the behavior or hide the Region to turn the ramp off. Existing flag-based Stadium ramps continue to work until deliberately edited; no scene artwork is rewritten.

The upper edge should meet the edge of its platform rather than extend over the flat deck. On the adjoining platform, use Foundry's native **Define Surface** behavior with **movement restriction enabled**, **placement: bottom**, and the Region's bottom at the platform elevation. Flat platforms created manually need no AI flags. Lower endpoints below ground also need a supporting floor at that height. The ramp itself creates no flat floor or ceiling and does not alter flying paths.

This handles walking within one scene level. Cross-level links, jumps, ladders and arbitrary pit falls retain their separate handling. A token already placed partway up the ramp must have the correct starting elevation; adding a behavior does not reposition existing tokens. Ground AI still avoids routes that change elevation; a ramp does not itself teach multilevel route planning.

Registration uses Foundry's native [RegionBehaviorType](https://foundryvtt.com/api/v14/classes/foundry.data.regionBehaviors.RegionBehaviorType.html) and [RegionBehavior dataModels](https://foundryvtt.com/api/v14/variables/CONFIG.RegionBehavior.html). The standard Region behavior sheet edits its schema fields; no pasted scripts are required.
