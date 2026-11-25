# Water zones

Version 0.44.0 adds a native **Water** Region behavior to **PF2e Tactical Rules — Movement**. It describes a bounded three-dimensional volume for manual token movement. The Region shapes define the horizontal footprint, its bottom elevation defines the floor, and its top elevation defines the water surface. Bottom elevations can be negative.

## Create water

1. Open **Region Controls** and draw the water footprint. Foundry 14.370's Grid Space shape is useful for pools that follow exact grid cells; ordinary rectangle, polygon, freehand, ellipse and hole shapes also work.
2. Keep the Region selected and click **Water zones** in the Region palette.
3. Set **Water bottom elevation** and **Water surface elevation**, then save.
4. Select a creature token and choose Foundry's native **Swim** movement action before dragging or using planned movement.

Hiding the Region drawing does not disable the water. Disable its Water behavior in the Region sheet or clear **Enabled** in the helper. A Region can contain other behaviors independently.

## Movement policy

- A Swim may move horizontally, vertically, or diagonally while the token's movement origin remains inside an enabled Water volume.
- The action budget is the actor's prepared PF2e Swim Speed. Fly and land Speed never increase this budget.
- A creature without a prepared Swim Speed keeps PF2e's ordinary Athletics-based Swim workflow. The module does not invent a check DC or distance for it.
- A managed Swim cannot leave the Region through its sides, bottom, or surface. Split mixed movement into separate Swim and land/Fly actions at the boundary.
- Negative elevation is valid. For example, a Region from `-30` to `0` permits descent to elevation `-30`.
- Grease ground checks do not apply underwater. Movement reactions still resolve before leaving threatened space.

The module uses Foundry's native movement path, collision, Region segmentation, terrain measurement, animation, history and movement action. The Water behavior supplies the missing volume boundary and PF2e Swim-Speed validation.

This release automates manual Swim-Speed movement. Athletics-based Swim checks and aquatic NPC tactical planning remain separate work.
