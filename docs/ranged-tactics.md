# Ranged and fallback tactics

Version 0.47.0 makes ranged weapon selection compare the actual attack with movement and melee alternatives instead of treating every legal shot as an equally useful immediate attack.

- A clear shot keeps its ordinary expected attack value.
- Any PF2e range-increment penalty receives a major action-selection cost when a safe move can close distance. This changes only AI ranking; it never adds another modifier to the native roll.
- The first −2 penalty already favors a useful approach. At −10, only a minimal desperation value remains.
- If walls, hazards, reactions, or immobility prevent an approach, a penalized shot remains legal. The AI can still fire rather than ending its turn.
- Melee expected value is evaluated beside the ranged attack, including current MAP, cover, concealment, and known off-guard state. Bruisers can therefore close for a stronger melee plan instead of preserving ammunition at a poor range.
- Kobold scouts, prepared native ranged Strikes, manticore spikes, vampire ranged Strikes, and ogre throws use the same range policy. Specialized movement forecasts recompute the policy from the destination.

Alt+W → **Tactics** now offers three optional assignments. **Preferred** influences the first selected plan, **Backup** is tried when that plan has no useful legal action, and **Desperate** is the last-resort plan. Automatic selection ranks the preferred plan, takes the next-best applicable plan as backup, and uses **Desperate engagement** as the final stage. Critical danger, mandatory recovery, action costs, and native legality still take precedence. Hiding, laying low, and withdrawal may deliberately hold position without triggering an offensive fallback.

Alt+W → **Decision graph** shows the three stage cards, every configured plan, the active behavior components, and the range or melee score terms used for the final action.
