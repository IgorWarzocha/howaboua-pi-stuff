#!/usr/bin/env python3
"""Lightweight structural and prompt-efficiency checks for a SKILL.md."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FORBIDDEN_HEADINGS = re.compile(
    r"^#{1,6}\s+(purpose|when to use|do not use when|activation|triggers?)\b",
    re.I | re.M,
)
FIELD_RE = re.compile(r"^([A-Za-z0-9_-]+):(?:\s*(.*))?$")
NAME_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DESCRIPTION_HIGH_END = 500
DESCRIPTION_LIMIT = 1024
NAME_LIMIT = 64


def split_frontmatter(text: str) -> tuple[list[tuple[int, str]], str]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing opening YAML frontmatter delimiter")

    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("missing exact closing YAML frontmatter delimiter") from exc

    return list(enumerate(lines[1:end], start=2)), "\n".join(lines[end + 1 :]).lstrip("\n")


def parse_quoted_scalar(value: str, line_number: int) -> str:
    quote = value[0]
    if len(value) < 2 or not value.endswith(quote):
        raise ValueError(f"unterminated quoted frontmatter value at line {line_number}")

    inner = value[1:-1]
    if quote == "'":
        result: list[str] = []
        index = 0
        while index < len(inner):
            if inner[index] != "'":
                result.append(inner[index])
                index += 1
                continue
            if index + 1 >= len(inner) or inner[index + 1] != "'":
                raise ValueError(f"unescaped quote in frontmatter value at line {line_number}")
            result.append("'")
            index += 2
        return "".join(result)

    escaped = False
    for char in inner:
        if char == '"' and not escaped:
            raise ValueError(f"unescaped quote in frontmatter value at line {line_number}")
        escaped = char == "\\" and not escaped
        if char != "\\":
            escaped = False
    if escaped:
        raise ValueError(f"unfinished escape in frontmatter value at line {line_number}")
    return inner


def parse_scalar(value: str, line_number: int) -> str:
    if not value:
        return ""
    if value[0] in "\"'":
        return parse_quoted_scalar(value, line_number)
    if ": " in value or " #" in value:
        raise ValueError(
            f"frontmatter value at line {line_number} contains a plain-scalar trap; quote it"
        )
    return value


def parse_frontmatter(lines: list[tuple[int, str]]) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line_number, line in lines:
        if not line.strip() or line.lstrip().startswith("#") or line.startswith((" ", "\t")):
            continue
        match = FIELD_RE.fullmatch(line)
        if not match:
            raise ValueError(f"malformed top-level frontmatter at line {line_number}")
        key, raw_value = match.groups()
        if key in fields:
            raise ValueError(f"duplicate frontmatter field `{key}` at line {line_number}")
        fields[key] = (
            parse_scalar(raw_value or "", line_number)
            if key in {"name", "description"}
            else (raw_value or "")
        )
    return fields


def has_files(directory: Path) -> bool:
    return directory.is_dir() and any(path.is_file() for path in directory.rglob("*"))


def strip_fenced_code(text: str) -> str:
    """Remove fenced blocks before checking Markdown structure."""
    visible: list[str] = []
    fence_char = ""
    fence_length = 0

    for line in text.splitlines():
        marker = re.match(r"^[ \t]{0,3}(`{3,}|~{3,})", line)
        if not fence_char:
            if marker:
                fence_char = marker.group(1)[0]
                fence_length = len(marker.group(1))
            else:
                visible.append(line)
            continue

        if re.fullmatch(
            rf"[ \t]{{0,3}}{re.escape(fence_char)}{{{fence_length},}}[ \t]*", line
        ):
            fence_char = ""
            fence_length = 0

    return "\n".join(visible)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run lightweight structural and prompt-efficiency checks on a SKILL.md."
    )
    parser.add_argument("skill", help="Path to SKILL.md or a skill directory")
    args = parser.parse_args()

    target = Path(args.skill).expanduser()
    if target.is_dir():
        target = target / "SKILL.md"
    target = target.resolve()
    root = target.parent

    issues: list[str] = []
    warnings: list[str] = []
    suggestions: list[str] = []
    fields: dict[str, str] = {}
    body = ""
    parsed = False

    if target.name != "SKILL.md" or not target.is_file():
        issues.append(f"missing SKILL.md: {target}")
    else:
        try:
            text = target.read_text(encoding="utf-8")
            frontmatter, body = split_frontmatter(text)
            fields = parse_frontmatter(frontmatter)
            parsed = True
        except (OSError, UnicodeError, ValueError) as exc:
            issues.append(str(exc))

    name = fields.get("name", "")
    description = fields.get("description", "")

    if parsed:
        if not name:
            issues.append("frontmatter missing name")
        else:
            if len(name) > NAME_LIMIT:
                issues.append(f"name too long: {len(name)} chars > {NAME_LIMIT}")
            if not NAME_RE.fullmatch(name):
                issues.append(f"name does not follow lowercase kebab-case: {name}")

        if not description:
            issues.append("frontmatter missing description")
        else:
            if not re.search(r"\buse (?:when|for)\b", description, re.I):
                warnings.append("description may not clearly say when to use the skill")
            if len(description) > DESCRIPTION_LIMIT:
                issues.append(
                    f"description too long: {len(description)} chars > Pi limit of {DESCRIPTION_LIMIT}"
                )
            elif len(description) > DESCRIPTION_HIGH_END:
                warnings.append(
                    f"description is long for agent-facing retrieval: {len(description)} chars; "
                    "compress job, triggers, artifacts, outcomes, and boundaries"
                )

    if FORBIDDEN_HEADINGS.search(strip_fenced_code(body)):
        issues.append("body contains job/selection headings; keep those semantics in description")

    if not has_files(root / "references"):
        suggestions.append(
            "no references found; consider whether detailed guidance, examples, or edge cases would help"
        )
    if not has_files(root / "scripts"):
        suggestions.append(
            "no scripts found; consider whether deterministic validation or transformation would help"
        )

    print("# Skill Efficiency Check\n")
    print(f"skill: {target}")
    print(f"description_chars: {len(description)}")
    print(f"body_chars: {len(body)}")
    print(f"body_lines: {len(body.splitlines())}")
    print("\n## Issues")
    print("- none" if not issues else "\n".join(f"- {item}" for item in issues))
    print("\n## Warnings")
    print("- none" if not warnings else "\n".join(f"- {item}" for item in warnings))
    print("\n## Suggestions")
    print("- none" if not suggestions else "\n".join(f"- {item}" for item in suggestions))

    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
