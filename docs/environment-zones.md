# Cover and concealment regions — 0.23.1

Patch **0.23.1** registers the shared check gate as libWrapper `MIXED`, so failed targeting checks may cancel the native attack without causing the hook to be unregistered. The same hook also handles cancelled Stealth choices and arming Sneak. Regression tests enforce the `WRAPPER` chaining contract and exercise repeated failed checks followed by a successful attack. Hard-reload every connected client to restore any hook removed by the old error.

The module uses ordinary Foundry **Scene Regions**. Since 0.13.0, the cloud editor attaches a named **Creature AI: Cover / concealment** behavior. Its configuration is stored in behavior flags; its short native Execute Script handler refreshes derived visibility and paths. The editor mirrors the old region flag for compatibility, and existing flag-only regions still work. Nothing is inferred from map artwork. Cover/concealment does not add floor surfaces. Existing walls continue to control sight, movement and physical line of effect.

## Set up a test scene

1. Reload every connected client with **Ctrl+F5**. Confirm the NPC controls show **Running code 0.23.1**. libWrapper must be enabled; it was already enabled in the inspected arena configuration.
2. Use Foundry's **Scene Region** drawing tools to draw a rectangle or polygon around foliage, smoke, an obstacle, or a protected area behind a barricade. Draw its actual footprint; native holes, elevation bounds and scene levels are respected. Set suitable elevation bounds for the creatures' native sight-ray heights. Region display color/visibility is presentation; native **Hidden** deactivates an attached behavior, as does disabling the behavior itself.
3. In the **Token tools**, click the **cloud icon — Cover / concealment zones**. Select the region. To reopen a different region's saved values, select it and click **Load region**.
4. Choose a cover and/or concealment mode, leave **Enabled** checked, and **Save zone**. This attaches/updates its named behavior. Clearing Enabled, or disabling that behavior in the Region sheet, stops its mechanical effects while preserving the settings.
5. Select an unlinked taught NPC and use **Alt+W**. Preview and the recorded decision explanation list environmental attack defenses. For a scout, save its current loaded/unloaded crossbow state before running.

| Example | Cover | Cover geometry | Concealment |
| --- | --- | --- | --- |
| Fog or smoke | None | Any | Fog / smoke: sight line enters or crosses region |
| Bushes giving concealment | None | Any | Foliage: target inside |
| Space protected by crates | Standard | Protected area: target inside, attacker outside | None |
| Low barricade footprint | Standard | Obstacle: crosses region, both creatures outside | None |
| Especially substantial cover | Greater, if the GM awards it | Appropriate mode | As appropriate |

**Protected areas** are a GM declaration of where cover applies, not automatic directional geometry: a target inside has the selected cover against an attacker outside, from any direction. Creatures sharing the same area have no cover from that area against each other. Draw separate protected areas where direction matters. **Obstacle** mode instead applies when both centers are outside and the native center-to-center sight-height line crosses the region. This describes partial cover, not a solid blocking object. Add/configure walls separately for solid obstacles.

**Fog/smoke** concealment applies if either endpoint is inside or the native line crosses the region, including two creatures within the same fog. **Foliage** concealment applies to occupants, regardless of whether the observer is also inside. These are explicit GM choices, not light or distance attenuation simulation.

Overlaps use the highest cover bonus and one concealment flat check. Lesser cover is +1 AC and does not permit Hide; standard/greater cover allow Hide and provide +2/+4 Stealth in the scout handler. Concealment can also permit Hide, but does not grant a Stealth bonus or automatically make someone Hidden.

## Firing from behind cover

Each zone has **Firing radius (ft)** in the cloud editor, default **10**. Existing zones without this field also use 10; set **0** to disable the exemption. The radius extends from the actual region footprint, rather than its center or bounding rectangle. Foundry's native expanded-polygon test respects rotations, irregular outlines, holes and multiple shapes. It measures the creature's sight-height center in scene feet and respects the region's elevation and scene levels.

| Attacker | Target | This zone's cover |
| --- | --- | --- |
| Within firing radius | Outside firing radius | Ignored by this attack |
| Outside firing radius | Within firing radius | Ordinary geometry applies |
| Both within firing radius | | Ordinary geometry applies |
| Both outside firing radius | | Ordinary geometry applies |

The radius grants no extra protected area: cover must still satisfy the configured line-crossing/occupant geometry. Thus a shooter beside a barricade can fire past it at a distant enemy while keeping cover against return fire. Two nearby creatures on opposite sides of that barricade retain ordinary cover. Two creatures sharing an occupant-only protected area keep that area's existing no-cover-against-each-other behavior.

This exemption suppresses only the originating zone's cover. Concealment, other cover zones, walls and Toolbelt's independently calculated wall/creature cover remain in force. It does not let attacks pass through solid walls. AI scoring, normal targeted attacks and the movement-refreshed token indicators all use the same directional rule. The geometry remains event/attack driven; the radius adds no animation ticker.

## Regular play and directional indicators

Patch **0.37.3** gives tactical captions a separate native `PreciseText` child beside the elevation tooltip. Global Auto Level Change and Foundry retain ownership of elevation text; our module neither wraps nor rewrites it. Repeated refreshes only position the cached caption above the final elevation display, without clearing its text, rerunning geometry, or requesting another render. This replaces the 0.37.2 append/repair workaround, which could shimmer while the two modules overwrote the same text object.

No AI profile or combat encounter is needed. Select exactly one creature token, then target another token and use its normal sheet attack. Cover/concealment is calculated between the attack's actual origin and target tokens. A sack pile between A and B can grant B cover from A while leaving B exposed to C approaching from another direction. Only that attack's contextual defense changes; no persistent global Cover condition is added to B.

Selecting a single observer displays **Cover +1/+2/+4** and/or **Concealed (DC 5)** above affected tokens beside the native elevation tooltip. No selection uses the player's assigned character if it has one token in the scene. Selecting several observers clears the ambiguous indicators. These labels are local to each client, inherit native token visibility/secrecy and preserve the existing elevation label. They do not dim, hide or make otherwise invisible tokens targetable. The client setting **Show directional zone defenses** can turn them off without changing any mechanics.

Since **0.14.2**, the same caption also identifies **Hidden (stealth)**, **Hidden (invisibility)**, **Hidden (LOS blocked)** and the framework's recorded **Undetected (stealth)** state. Several simultaneous causes are listed together. The GM's hidden-token toggle appears separately as **GM hidden**. Native sight walls and horizontal surfaces determine the LOS diagnostic; movement-only walls do not. Sheet Hidden/Undetected conditions without a more specific source are grouped under stealth/detection. When Hidden is captioned, an additional Concealed line omits DC 5 to avoid suggesting two flat checks.

These captions describe the selected observer's view. A LOS/invisibility-only Hidden label is a **visual diagnostic**, not a determination that the observer knows the creature's square. It creates no global Hidden condition, changes no recorded detection state, resolves no Seek and does not bypass solid obstructions. The cached API exposes `detection.diagnosticOnly` for this distinction. Native player visibility remains authoritative; player captions for undetected or GM-hidden subjects are suppressed even if another owned observer makes that token render. The GM can inspect the full cause labels.

Geometry refreshes on completed movement, spatial token updates, token creation/deletion, region/behavior edits and observer/target changes. Stealth flag changes, condition/effect item changes and wall/door edits also refresh the detection captions. Changes to an AI ledger or other unrelated token flags do not recalculate these labels. Updating one target refreshes that pair; moving the observer refreshes its pairs. Requests in the same update batch coalesce. Rendering/tooltip getters read cached strings and perform no geometry work. Each actual attack independently checks current geometry, including tokens moved while a flat check is awaiting its chat message.

For **crossing** concealment, choose **Fog / smoke: sight line enters or crosses region**. The mode also suits any foliage the GM declares obscures sight through it. Stadium's two annotated concealment regions now use this mode. **Foliage: target inside** remains available for occupant-only concealment. Neither mode disables existing wall or surface collisions.

## Rolls and other modules

Since **0.15.0**, [player Hide/Sneak](player-stealth.md) also uses these zones for per-enemy hiding eligibility, endpoint checks and continuous declared-cover bonuses. The masked-figure token tool supports players; native sheet Hide/Stealth and walking use the same observer records as NPC AI. These actions do not add global Hidden/Undetected conditions.

Since **0.13.1**, the active GM synchronizes a native **Concealed** condition for creatures whose sight-height center is inside an enabled concealment region. The condition appears on the sheet and token. Movement, token placement, zone/behavior edits and reloads refresh it; this works outside combat too. Overlapping zones keep one tagged condition until the final source disappears. Exiting, disabling, hiding or deleting the zone removes only this module's source. Existing manual, spell, granted and temporary Concealed sources are preserved; they prevent an extra zone condition from being created. Removing such a source while still inside restores the zone condition.

Fog crossing a sight line between two outside tokens remains observer-relative and does not create a global condition on either creature. Zone-generated conditions do not make targets Hidden or exclude them from AI/reaction eligibility; their flat check still comes from current geometry. A native condition belongs to the actor: if linked duplicates in the viewed scene straddle a zone boundary, the shared condition is omitted to avoid marking the outside duplicate incorrectly. Geometry and attack flat checks still work for the inside token. Use unlinked NPC tokens for independent creature conditions.

- Native targeted **attack rolls**, including manual character-sheet attacks, receive region cover through a clone of the system's contextual AC statistic. Existing circumstance bonuses (including shields and Toolbelt cover) use native stacking; no permanent cover/condition items are added or removed.
- **AI actions and managed Reactive Strikes** resolve a DC 5 concealment check before their attack/maneuver roll. A failed check spends the triggering action, MAP where applicable, ammunition, or reserved reaction; it deals no damage and opens no hit-triggered follow-up. The runner waits for the check and its chat message before continuing.
- **Normal sheet weapon and spell attacks**, plus targeted **attack-trait skill checks** such as Trip, automatically await an unmodified concealment flat check. Failure posts its flat-check card and returns without the attack/check, hit callback or damage follow-up. Native character Strike ammunition is consumed on failure when its native consumption callback was enabled; consumable weapons follow the native expenditure rule. The module does not invoke hit callbacks merely to consume ammunition. Manual action/MAP accounting still belongs to the player, and spell slots/other resources use their normal sheet controls. AI-managed checks do not get a second flat check.
- Manual attacks against sheet-level **Concealed** also use DC 5; **Hidden**, including the framework's relative Hidden state, uses DC 11. Rerolls retain the original defense and do not repeat the gate. Formula/view-only rolls (`createMessage: false`) are unchanged.
- **Non-attack spells and effects** do not all pass through PF2e's targeted Check API; their concealment resolution remains manual. General sense simulation and automatic special-sense exemptions are also outside this release. Macros can explicitly add `foundry-creature-ai:ignore-concealment` and/or `foundry-creature-ai:ignore-cover` to the native check context's options after GM adjudication.
- **Area effects** do not require concealment checks. Region bonuses to Reflex saves against area effects remain manual because the module does not infer an effect's point of origin from its caster token.
- Independently applied actor Concealed/Hidden/Undetected/Invisible conditions retain the AI's prior conservative targeting policy; manual targeted attacks can resolve Concealed/Hidden as described above. Relative scout Hide/Sneak detection uses token flags; it does not add global Hidden/Undetected conditions. Zone-generated Concealed remains automatically eligible for AI attacks and reactions.

The installed **PF2e Toolbelt** contains **Auto Cover**, which can estimate cover from walls and creatures when enabled in its settings. That is the likely existing wall-cover feature. Its installed version exposes no public cover-query API; this module leaves its native roll wrapper in charge of that cover and does not change its settings or depend on its private internals. AI scoring and Hide eligibility use the explicit regions described here, plus complete sight-blocking walls for hiding. A low wall that allows sight does not grant AI Hide eligibility automatically: annotate its protected area/footprint.

The saved arena configuration inspected during development had Toolbelt enabled and Avoid Notice disabled. Avoid Notice handles initiative stealth and does not itself supply general region-based concealment. No additional module was installed or world setting changed.

## API

`game.modules.get('foundry-creature-ai').api.zones` exposes `open(regionId?)`, `configure(regionDocument, settings)`, the read-only `between(observerToken, targetToken)` geometry query, `refresh()` and `view()`. The last returns the current client observer ID and cached directional defenses. `refresh()` refreshes both occupant conditions and the local directional display.

```js
const ai = game.modules.get('foundry-creature-ai').api;
await ai.zones.configure(canvas.scene.regions.get('REGION_ID'), {
  enabled: true, cover: 'standard', coverMode: 'intervening', concealment: 'none', firingRadius: 10
});
```

Rules references: [Cover](https://2e.aonprd.com/Rules.aspx?ID=2372), [Concealed](https://2e.aonprd.com/Conditions.aspx?ID=62), [Toolbelt Auto Cover](https://github.com/reonZ/pf2e-toolbelt/wiki/Auto-Cover).
