#!/usr/bin/env python3
"""Small deterministic efficiency check for SKILL.md files."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FORBIDDEN_HEADINGS = re.compile(r"^#{1,6}\s+(when to use|do not use when|activation|triggers?)\b", re.I | re.M)
REFERENCE_RE = re.compile(r"`((?:references|scripts|assets)/[^`]+)`")


def frontmatter_plain_scalar_issues(text: str) -> list[str]:
    if not text.startswith("---\n"):
        return []
    end = text.find("\n---", 4)
    if end < 0:
        return []
    raw = text[4:end]
    issues: list[str] = []
    for offset, line in enumerate(raw.splitlines(), start=2):
        if not line.strip() or line.startswith(" ") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if not value or value[0] in "\"'|>":
            continue
        if ": " in value or any(ch in value for ch in "{}[]"):
            column = line.index(value) + 1
            caret = " " * (column - 1) + "^"
            issues.append(
                f"frontmatter {key.strip()} must be quoted: unquoted YAML value contains plain-scalar traps at line {offset}, column {column}.\n"
                f"  {line}\n"
                f"  {caret}\n"
                f"Use `{key.strip()}: \"...\"`, especially when the value contains `: `."
            )
    return issues


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError("missing YAML frontmatter")
    end = text.find("\n---", 4)
    if end < 0:
        raise ValueError("unterminated YAML frontmatter")
    raw = text[4:end]
    body = text[end + len("\n---") :].lstrip("\n")
    fields: dict[str, str] = {}
    for line in raw.splitlines():
        if not line.strip() or line.startswith(" "):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip().strip('"').strip("'")
    return fields, body


def main() -> int:
    parser = argparse.ArgumentParser(description="Check a SKILL.md for prompt-efficiency and house-style issues.")
    parser.add_argument("skill", help="Path to SKILL.md or a skill directory")
    parser.add_argument("--warn-desc", type=int, default=320, help="description warning threshold in chars")
    parser.add_argument("--fail-desc", type=int, default=600, help="description failure threshold in chars")
    args = parser.parse_args()

    target = Path(args.skill).expanduser()
    if target.is_dir():
        target = target / "SKILL.md"
    target = target.resolve()
    root = target.parent

    issues: list[str] = []
    warnings: list[str] = []

    if target.name != "SKILL.md" or not target.exists():
        issues.append(f"missing SKILL.md: {target}")
        fields, body = {}, ""
    else:
        text = target.read_text(encoding="utf-8")
        issues.extend(frontmatter_plain_scalar_issues(text))
        try:
            fields, body = parse_frontmatter(text)
        except ValueError as exc:
            issues.append(str(exc))
            fields, body = {}, text

    name = fields.get("name", "")
    description = fields.get("description", "")

    if not name:
        issues.append("frontmatter missing name")
    elif not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        issues.append(f"name is not kebab-case: {name}")

    if not description:
        issues.append("frontmatter missing description")
    else:
        if "Use when" not in description and "Use for" not in description:
            warnings.append("description may not say when to use the skill")
        if len(description) > args.fail_desc:
            issues.append(f"description too long: {len(description)} chars > {args.fail_desc}")
        elif len(description) > args.warn_desc:
            warnings.append(f"description is long: {len(description)} chars > {args.warn_desc}")

    visible_line = f"- {name}: {description} (file: {target})\n"
    visible_tokens = (len(visible_line.encode("utf-8")) + 3) // 4

    if FORBIDDEN_HEADINGS.search(body):
        issues.append("body contains trigger-selection headings; keep trigger guidance in frontmatter description")

    for rel in sorted(set(REFERENCE_RE.findall(body))):
        if not (root / rel).exists():
            warnings.append(f"referenced path does not exist: {rel}")

    print(f"# Skill Efficiency Check\n")
    print(f"skill: {target}")
    print(f"description_chars: {len(description)}")
    print(f"model_visible_line_tokens_estimate: {visible_tokens}")
    print(f"body_chars: {len(body)}")
    print("\n## Issues")
    print("- none" if not issues else "\n".join(f"- {item}" for item in issues))
    print("\n## Warnings")
    print("- none" if not warnings else "\n".join(f"- {item}" for item in warnings))

    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
