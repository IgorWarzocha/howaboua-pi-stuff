Write for the user. A developer tool still has users. Its README is part of the product. Save the codebase tour for developer documentation.

## README journey

A README should take the reader from interest to useful operation, then reveal detail only as they need it.

1. **Position the product.** Say what it is, what useful outcome it creates, and what makes its approach different.
2. **Qualify the reader.** Make the intended use, important exclusions, trust boundary, and major requirements visible early.
3. **Reach first value.** Give the shortest real installation and first-use path. State what the reader should do or see next.
4. **Show the main capabilities.** Summarize the main features, modes, or package choices in terms of user-visible behaviour.
5. **Explain normal use.** Cover defaults first, then the settings and commands most readers will actually choose.
6. **Escalate into detail.** Add advanced configuration, migration, limitations, and troubleshooting after the ordinary path is clear.
7. **Route deeper questions.** Link to source, dedicated references, articles, changelogs, issues, or contributor material instead of putting all of that material in the README.

The exact order can move when the product demands it. Preserve the escalation from useful overview to operation to bounded detail.

## Sell with evidence

A README should make the product desirable. Earn that desire through mechanisms, choices, and visible outcomes. Skip slogans.

- Lead with the real promise. Do not open with history, architecture, acknowledgements, or a generic category definition.
- Replace broad benefits with what the product changes. Name the command, behaviour, result, or removed friction.
- State deliberate exclusions. A clear non-goal helps the right reader trust the product and helps the wrong reader leave early.
- Make recommendations. Own them as product judgment or lived experience instead of presenting taste as universal law.
- Preserve first-person voice when the author is part of why the reader trusts the recommendation.
- Keep warnings frank. Say what has permission, what can fail, what remains unauthenticated, or what the user should inspect.
- Let humour do a second job. A joke can expose a trade-off, puncture marketing language, mark a boundary, or make a warning memorable. Decorative jokes are filler.

Warm the framing. Keep the procedure crisp. Product voice can live in the opening, recommendations, transitions, warnings, and boundaries. Commands, settings, checklists, and recovery steps stay crisp enough to follow without interpreting a mood.

Preserve deliberate house phrases when they remain clear. If one starts appearing everywhere, keep the best use and write the rest plainly.

The mechanism earns the claim. `The adapter exposes exec and wait at provider level` says more than `a seamless developer experience`.

## Explain how to use the product

README detail remains user-visible:

- installation and removal
- requirements and supported environments
- first launch and expected result
- modes, defaults, settings, and commands
- configuration locations and precedence
- trust and security boundaries
- visible status and error meanings
- migration, failure recovery, and troubleshooting

Keep module ownership, internal call paths, source layout, build architecture, implementation rationale, and contributor procedure in code or dedicated internal documentation. Link to them only when a user decision depends on them.

Do not add a development setup section merely because the repository contains code. Add contributor guidance only when the product intentionally invites that workflow, then keep it separate from the main user path.

## Structure for decisions

- Use headings that match the reader's next question, such as `Install`, `Modes`, `Settings`, `Migrating`, and `Troubleshooting`.
- Use a table when rows repeat the same decision fields. Good tables compare packages, modes, settings, statuses, or deliberate exclusions.
- Use numbered steps for a sequence and bullets for parallel capabilities.
- Put the common path before exceptions. Put defaults before configuration breadth.
- Keep commands beside the outcome or state they produce.
- Use a contents list when the page is long enough that readers will jump between sections.
- Stop before the README becomes complete source documentation. Progressive detail still needs an upper bound.

Dense is acceptable when every section answers a real user question. Short is not a virtue when it forces the reader into source code for ordinary operation.

## Other technical documents

For material outside a README, choose the reader's dominant need:

- **Tutorial:** help a learner produce an early visible result.
- **How-to:** help a competent user complete a real task.
- **Reference:** make facts, options, limits, and errors easy to find.
- **Explanation:** build a mental model of one bounded topic and its reasons.

Treat these as lenses. A useful document may contain distinct zones with different jobs. Split material only when the mixture makes the reader's path worse.

## Use the product's real language

- Use exact symbols, commands, paths, flags, UI labels, and domain terms. Do not rotate synonyms for variety.
- Define a necessary term before later prose depends on it. Decide what the intended reader already knows.
- Name the actor and action when they affect understanding.
- Verify examples, outputs, paths, counts, defaults, and behavioural claims against the current product.
- State observable results when the reader needs proof that a step worked.
- Put a condition or warning before the action it governs.
- Preserve necessary repetition in warnings, procedures, and reference material.

Synthetic technical prose often uses vague architectural claims in place of mechanics. Replace `robust abstraction`, `seamless integration`, `developer-friendly workflow`, `flexible platform`, `powerful primitive`, and invented metaphors with the actual boundary, operation, or constraint.

## Punctuation and sentence construction

- Use periods, commas, question marks, and occasional exclamation marks. Use straight apostrophes and quotation marks.
- Do not use em dashes, en dashes, semicolons, ellipses, parenthetical asides, or slash constructions in prose.
- Use a colon only before a real list, example, or label.
- Preserve punctuation required by exact code, commands, paths, URLs, identifiers, and quoted source.
- Give each sentence one main thought. Keep a longer sentence when its condition and consequence belong together.
- Make every pronoun point to one clear noun. Repeat the noun when that is cheaper than ambiguity.
- Do not call a task easy, simple, obvious, or quick.

## Final read

Check the document in order:

1. Does the opening make the useful product and intended reader clear?
2. Can the reader install it and reach the first real result?
3. Do recommendations and claims have evidence or clear product judgment behind them? Does each joke expose a trade-off, boundary, or warning?
4. Does detail escalate without falling into implementation internals?
5. Are defaults, risks, limitations, and recovery easy to find?
6. Does the result sound like its author rather than interchangeable developer documentation?

Stop when the user can decide, begin, operate, and recover.
