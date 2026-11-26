# Decision graph audit — 2026-11-26

## Scope

This audit examines `saved-trees/ogres-vs-kobolds-open-field-decision-1.json`, the first Kobold Scout decision in the saved open-field encounter. The export uses `planning-trace@1`.

The linked information-gain article describes learned classification trees. Its entropy and Gini formulas require a population of labeled outcomes. The creature planner is an HTN and utility portfolio, so assigning Gini values to one combat decision would manufacture data. The applicable standard is the article's structural principle: a useful split reduces uncertainty. A layer which repeats its parent, or a fact which has no effect downstream, provides no information gain.

Source: [Information Gain, Gini Index — Measuring and Reducing Uncertainty for Decision Trees](https://gowrishankar.info/blog/information-gain-gini-index-measuring-and-reducing-uncertainty-for-decision-trees/).

## Findings

The export has 83 nodes and 85 edges. Every node is technically reachable from `planning-root`, so there are no graph-theory orphans. The visible problem is semantic dead weight:

- The root has 20 outgoing edges. Eleven doctrine facts and six situation facts terminate immediately. They are diagnostics presented as if they caused the decision.
- `engagement-ogre-two` also terminates immediately. Only the Ogre One relation supports a goal.
- “actions 300%” treats an action count as a normalized capability weight. This is a display and type error.
- Four surviving intents each expand the same six movement IDs. That creates 24 copies of six actual alternatives.
- Every copied alternative gets an AND/method node with exactly one primitive child. Those 24 method nodes do not decompose anything.
- Layers 6 and 7 both contain 24 nodes. Moving down a layer adds names but reduces no uncertainty.
- Twenty-three of the 24 primitive nodes terminate without reaching a comparison node. The selected primitive alone connects to the outcome, so the graph does not show where alternatives actually competed.
- The trace reports 224 grounded candidates, although only 56 candidate IDs are unique across the four intent runs. It exposes generation volume rather than the merged portfolio used by the chooser.

The saved graph therefore is connected but not a faithful decision explanation. It combines a fact dump, a repeated candidate dump, and one highlighted result.

## Replacement contract

`planning-trace@2` records the causal funnel:

1. **Situation** stores full doctrine, observations, and known engagements as inspectable detail. Uninstrumented facts do not become causal branches.
2. **Directive** applies legality, action budgets, and mandatory survival policy.
3. **Intent** compares scored tactical hypotheses and records their actual plan-score reasons.
4. **Objective** binds a surviving intent to its selected goal and relevant engagement.
5. **Timing** states whether the action exploits now, sets up this turn, sets up a later turn, recovers, holds, or disengages.
6. **Action or method** shows each merged candidate ID once. Atomic actions go directly to a primitive. An AND method exists only for a real multi-step activity and decomposes into ordered primitives.
7. **Competitive choice** receives every displayed finalist and records rank, exact tie, or weighted probability.
8. **Outcome** records the executed action.

Pruned intents and rejected actions remain available behind filters. They are hidden initially so the chosen causal path is readable. The trace keeps both generated and unique candidate counts to expose portfolio duplication without drawing it.

## Result on the audited decision

Running the same saved scenario with the new trace produces 20 nodes instead of 83:

- 5 intent nodes, of which 1 owns the final merged candidates;
- 1 objective and 1 timing commitment;
- 8 unique displayed finalists;
- 0 fake one-child method nodes;
- 1 shared competitive-choice node;
- 1 outcome.

The structural checks, complete suite result, and release archive hash are recorded in the [verification record](../research/decision-trace-v2-verification-2026-11-26.json).

The other three initially surviving intents are marked pruned in this view because none of their duplicate candidate representations survived portfolio merging into the displayed final set. Their scores and reasons remain inspectable when pruned branches are enabled.

## Limits

This change makes the trace honest; it does not turn the runtime planner into a learned classifier. The plan score functions still summarize several battlefield inputs without emitting a per-input contribution. A future explanation API should return structured score terms from every plan, allowing the graph to connect individual observations to an intent without guessing causality. Information gain or Gini pruning becomes meaningful only after the combat lab accumulates labeled outcomes for competing split policies.
