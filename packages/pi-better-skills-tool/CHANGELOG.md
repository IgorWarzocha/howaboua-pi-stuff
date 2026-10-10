# @howaboua/pi-better-skills-tool

## 0.0.9

- Skills discovery and invalid-input errors now show the JavaScript string-call syntax.

## 0.0.8

- ### Improvements
  - Skills returns its catalog with command guidance when called without arguments. Explicit help remains supported.

## 0.0.7

- Better Skills now hides the skill catalog from Pi, Code Mode, and Notebook Mode prompts while preserving native `/skill:<name>` commands.

  Remove `--no-skills` from launch wrappers or aliases. Separate catalog-clearing hooks are no longer needed.

## 0.0.6

- Requires Pi 1.0.0 or later.

  - Skill reads now resolve shorthand references within the selected skill and accept semicolon-separated read/list groups.
  - Large results now return bounded pages with explicit continuation commands instead of failing.

## 0.0.5

- Skills tool usage now advertises category-filtered listing in Code and Notebook modes.

## 0.0.4

- The skills tool now reads mixed skills and unique cross-skill references in one call. Ambiguous reference names report their qualified choices.

## 0.0.3

- Removed redundant tool guidance from Ask, Shepherdr, Skills and Browser. Code and Notebook Mode now show one callable contract per tool, with detailed Browser and agent rules in help.

## 0.0.2

- Batch independent skill reads in one execution cell.

- Keep tool results actionable.

  - Browser evaluation errors preserve JavaScript exception details instead of a generic “Uncaught”.
  - Skill path inventories omit installed dependencies; reference reads list only the requested sources instead of repeating the full inventory.

## 0.0.1

- Initial release of Better Skills for progressive skill discovery in normal Pi, Code Mode, and Notebook Mode.

  - List the available catalog first, then load only the requested skill and references.
  - Combine global, project, and package-provided skills while respecting invocation visibility and local precedence.
