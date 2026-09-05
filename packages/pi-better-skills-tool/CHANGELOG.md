# @howaboua/pi-better-skills-tool

## 0.0.2

- Batch independent skill reads in one execution cell.

- Keep tool results actionable.

  - Browser evaluation errors preserve JavaScript exception details instead of a generic “Uncaught”.
  - Skill path inventories omit installed dependencies; reference reads list only the requested sources instead of repeating the full inventory.

## 0.0.1

- Initial release of Better Skills for progressive skill discovery in normal Pi, Code Mode, and Notebook Mode.

  - List the available catalog first, then load only the requested skill and references.
  - Combine global, project, and package-provided skills while respecting invocation visibility and local precedence.
