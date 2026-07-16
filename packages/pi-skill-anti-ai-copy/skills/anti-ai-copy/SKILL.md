---
name: anti-ai-copy
description: "Voice-preserving prose drafting, rewriting, and review. Use for product copy, docs, READMEs, emails, posts, bios, essays, UI text, or removing AI/SaaS/corporate tells. Not detector analysis or mechanical proofreading."
---

# Anti-AI Writing

Write prose that has a real job, context, and point of view. Remove generic model polish without forcing every writer into the same dry, quirky, or aggressively casual voice.

## Principles

1. **Meaning before polish.** Know what the writing needs to say before tuning how it sounds.
2. **Preserve the author.** Keep their stance, confidence, uncertainty, vocabulary, humour, restraint, and regional conventions unless asked to change them.
3. **Respect the genre.** An email, technical guide, essay, product page, personal note, and UI label should not share one house voice.
4. **Never invent specificity.** Ground details in supplied context, source material, or verified facts. Invent only when the task is explicitly creative and invention fits it.
5. **Prefer clear construction.** Give one main idea to a sentence. Split stacked clauses, nested qualifications, and ornamental detours unless their relationship genuinely needs one sentence.
6. **Treat tropes as evidence, not verdicts.** A suspicious word may be exact. A sentence with no suspicious words may still be empty, repetitive, or synthetic.
7. **Do not perform humanity.** Random slang, fragments, profanity, fake jokes, and deliberate roughness are not substitutes for voice.

## Inputs

Work from whichever material the user has:

- a topic, brief, argument, or desired outcome
- facts, examples, experiences, and constraints
- an existing draft or file
- audience, venue, voice references, or phrases that must remain

Infer ordinary context when it is clear. Ask only when a missing choice would materially change the piece; otherwise make the smallest reasonable assumption and write.

## Workflow

1. **Identify the job.**
   - Determine whether the user wants a draft, rewrite, or review.
   - Establish what the reader should understand, believe, feel, or do.
   - Note the relationship between writer and reader and the amount of formality the venue expects.

2. **Find the substance.**
   - Separate known facts, supplied opinions, assumptions, open questions, and creative material.
   - Find the actual point rather than opening with a generic statement about the topic.
   - Preserve caveats and unresolved judgment. Cleaner prose MUST NOT imply stronger evidence or confidence.
   - If support for a broad claim is missing, narrow the claim or ask for the missing fact instead of fabricating proof.

3. **Choose a fitting voice and shape.**
   - For an existing draft, notice its useful rhythm, diction, technical density, humour, irritation, warmth, and odd phrases before editing.
   - For a new draft, derive voice from the writer, audience, purpose, venue, and any examples—not from a generic “human” persona.
   - Choose only as much structure as the material needs. Do not turn a short thought into a framework of headings and bullets.

4. **Write the direct version first.**
   - Lead with the point, event, question, or concrete observation.
   - Prefer nouns and mechanisms over claims about vibes, value, or importance.
   - Keep sentences easy to hold in working memory. Use a long sentence when the ideas belong together, not to sound thoughtful.
   - Let paragraphs perform distinct work. Do not summarize a point immediately after making it.

5. **Run the anti-AI pass.**
   - Consult `references/trope-checklist.md` for a full review, difficult diagnosis, genre-specific risks, or a broader phrase scan.
   - Fix the underlying problem before changing vocabulary. Do not synonym-swap one brochure phrase for another.
   - Check for generic setup, inflated stakes, fake contrasts, rhetorical signposting, rule-of-three cadence, repeated conclusions, clause-heavy sentences, abstraction fog, canned empathy, and unsupported certainty.
   - Then scan the phrase blacklist. Keep a listed word when it is precise and natural in context.

6. **Read for cadence and voice.**
   - Remove monotony where it makes the prose feel generated or hard to follow.
   - Preserve natural variation already present. Smooth prose is allowed; uniform prose is the warning sign.
   - Keep quirks that carry voice without obscuring meaning. Do not inject quirks the writer never had.
   - Read aloud when rhythm matters. Split sentences that run out of breath or lose their subject.

7. **Finish in the form requested.**
   - When asked to write or rewrite, lead with the finished prose.
   - When asked for diagnosis, explain the important patterns naturally and quote only what helps.
   - Mention assumptions or consequential choices briefly when useful.
   - Use before/after comparisons or tables only when they make several edits easier to judge.

## Genre notes

- **Technical writing and docs:** clarity and correctness first; keep necessary repetition, terminology, warnings, and qualifications.
- **Essays and articles:** retain argument, tension, transitions, and deliberate style; do not reduce everything to short declarative sentences.
- **Emails and messages:** lead with the reason, ask the real question, and keep genuine warmth without ceremonial padding.
- **Product and marketing writing:** replace broad value claims with behavior, mechanism, evidence, or a narrower honest promise.
- **Social and personal writing:** preserve the writer's natural roughness and timing; avoid launch-thread cadence and manufactured vulnerability.
- **UI writing:** prefer the shortest label that remains clear in context. Do not explain the interface inside every control.
- **Creative writing:** invention and stylization are allowed; continuity, intentional voice, and the requested form matter more than anti-AI vocabulary rules.

## Final read

Read once for meaning, once for truthfulness, and once for sound when rhythm matters. Remove repeated ideas, conclusions, transitions, headings, adjectives, and complexity that do no work. Make sure the result belongs to this writer, subject, audience, and venue rather than any interchangeable product or person.

Then stop. Repeated polishing can remove the voice the skill is meant to protect.

## Supporting reference

- `references/trope-checklist.md` — structural tells, phrase blacklist, genre-specific risks, and concrete rewrite moves.
