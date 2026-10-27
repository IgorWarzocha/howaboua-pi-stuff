---

description: Grill an idea into an agreed plan
argument-hint: "[idea or plan]"
---

Grill this into an agreed plan:

$ARGUMENTS

Use the working directory, web search, available skills, and any relevant tools to understand the thing before asking. Prefer finding answers yourself over asking me.

Loop until ask is dismissed. There is no round limit:
1. Investigate the relevant context.
2. Use ask for the next set of decisions.
3. After the first answer round, create docs/<short-name>.md.
4. Keep asking better questions, using tools between rounds as needed.
5. Keep updating the markdown file after each round.

The markdown file is the current plan, not a transcript. Keep it ready to use if I stop at any point. Include:
- goal
- agreed decisions
- important tradeoffs
- relevant user reasoning
- open questions
- proposed next steps

Do not log every question and answer.

When ask is dismissed, the grilling session is done. Then:
- give a short summary of what was agreed
- open the markdown file with $EDITOR if available
- print the file path

Do not start implementation unless I explicitly choose to proceed.
