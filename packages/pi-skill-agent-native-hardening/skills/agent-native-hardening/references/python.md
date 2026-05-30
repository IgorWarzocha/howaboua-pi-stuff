# Python Notes

Use this reference when applying agent-native hardening to Python repos, including libraries, CLIs, services, data/ML projects, and web apps.

## Common Python risk signals

Penalize these strongly when they appear in central paths or public contracts:
- untyped dictionaries, loosely shaped JSON, broad `dict`/`list` plumbing, or values passed through the system without validation
- unchecked `Any`, `object`, dynamic attribute access, monkeypatching, reflection, or stringly typed dispatch in domain code
- import side effects, mutable module-level state, hidden singleton clients, or configuration loaded at import time
- broad `except Exception`, silent fallback defaults, swallowed subprocess/network errors, or logging instead of failing in validation paths
- god modules such as large `utils.py`, `helpers.py`, `common.py`, `models.py`, `services.py`, or `views.py` that absorb unrelated ownership
- framework godfiles: fat Django views/models, Flask/FastAPI route files mixing validation/business logic/database calls, or Celery task modules mixing orchestration and domain rules
- test suites that rely on local import path accidents, real network/services, shared mutable fixtures, or order-dependent state
- configuration sprawl across `setup.py`, `setup.cfg`, `requirements*.txt`, `tox.ini`, `pytest.ini`, `.flake8`, `mypy.ini`, and `pyproject.toml` without a clear source of truth

## Strong Python patterns

Prefer these when hardening Python code:
- clear package ownership, usually with a `src/` layout for publishable libraries and CLIs when migration cost is acceptable
- `pyproject.toml` as the visible home for project metadata and tool configuration when the repo already uses modern packaging
- Ruff or equivalent lint/format checks wired into the repo’s normal check command
- mypy, Pyright, or equivalent type checking for stable application/library boundaries, with strictness increased incrementally by owned module rather than random file comments
- Pydantic, attrs, dataclasses, TypedDict, Protocol, NewType, enums, or small domain objects where they make contracts explicit
- validation at IO boundaries: CLI args, env/config, HTTP requests, files, queues, database rows, notebooks, and third-party API responses
- pure functions for transforms and decision logic, with IO behind adapters that are easy to fake in deterministic tests
- pytest tests for pure transforms, schema/contract validation, failure paths, CLI guards, and framework handlers without real external services

## Python baseline discovery

During baseline discovery, inspect:
- `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements*.txt`, `constraints*.txt`, `Pipfile`, `poetry.lock`, `uv.lock`, `tox.ini`, `noxfile.py`, `pytest.ini`, `.flake8`, `mypy.ini`, `pyrightconfig.json`
- package layout: `src/`, top-level import packages, `tests/`, scripts, notebooks, migrations, generated code, and framework entrypoints
- active check commands in README, CI, Makefile/Justfile, tox/nox sessions, package manager scripts, or task runners
- runtime version declarations such as `requires-python`, `.python-version`, Docker images, CI Python matrix, or Pyright/mypy Python version settings
- generated, vendored, migration, or notebook output; do not treat it as a source hotspot unless humans edit it directly

Common active checks:
- `ruff check .` and `ruff format --check .`
- `pytest`
- `mypy <package>` or `pyright`
- `python -m build`, framework-specific test commands, or repo-specific aggregate commands such as `make check`, `tox`, `nox`, `uv run ...`, or `poetry run ...`

## Python contract-safety guidance

- Do not “fix” type checker errors by sprinkling `# type: ignore`, `cast(...)`, `Any`, or weaker config. Use those only for narrow, documented boundary cases.
- Replace loose dict pipelines with named domain objects, TypedDicts, dataclasses/attrs models, Pydantic models, or framework schemas when the shape matters past the boundary.
- Prefer Protocols for structural interfaces when behavior matters more than inheritance.
- Keep domain functions independent of framework request/response objects, ORM sessions, environment reads, and global clients.
- Use explicit result/error shapes for operations with expected failure modes instead of returning `None`, `{}`, `False`, or magic strings.
- Keep imports boring: avoid path mutation, import-time connection setup, and side effects that make tests or agents depend on execution order.

## Async Python guidance

Watch async code for hidden lifecycle and ownership problems:
- event loop management scattered across modules, nested `asyncio.run(...)`, or sync wrappers that secretly create loops
- long-lived HTTP/database/queue clients created at import time instead of owned by an app lifespan, worker, fixture, or explicit context manager
- background tasks launched without tracked ownership, cancellation, timeout, shutdown, or error propagation
- swallowed `CancelledError`, broad exception handlers around task groups, or cleanup code that prevents cooperative cancellation
- fire-and-forget tasks that mutate shared state or rely on process exit for cleanup
- mixed sync/async APIs where blocking calls run inside the event loop without an executor or async-native adapter

Prefer:
- one clear owner for event loop/app lifespan setup
- explicit async context managers for clients and resources
- structured concurrency when available, such as `asyncio.TaskGroup` on supported Python versions, with cancellation and failure behavior tested
- top-level async entrypoints that use high-level runners once, instead of libraries or nested helpers calling `asyncio.run(...)` inside an already running loop
- typed message/result shapes between background work and state mutation owners
- deterministic tests for timeout, cancellation, retry, and shutdown paths using fakes instead of real services

## Typing migration strategy for large older repos

For large legacy Python repos, recommend an incremental typing lane instead of a repo-wide flag day:
- start with boundary modules: config loading, request/response schemas, CLI args, file parsing, queue messages, public library APIs, and core domain transforms
- define a small number of owned strictness zones and expand them by package/module as errors are fixed
- standardize one type-check invocation and run it consistently in CI before widening the checked surface
- prefer `TypedDict`, dataclasses/attrs, Pydantic models, enums, NewType, and Protocols to document real shapes and behavior before chasing local annotations everywhere
- replace repeated dict/string contracts with named objects at stable boundaries first; leave unstable internal code alone until ownership is clearer
- use per-module config only as a temporary migration map, not a graveyard for permanent ignores
- prefer narrow missing-import or third-party-stub exceptions over global ignore settings that hide future errors
- track remaining untyped or weakly typed areas as explicit lanes with owners, not scattered TODO comments
- avoid mass annotation churn that preserves bad architecture; split godmodules and clarify boundaries before forcing annotations through them

## Python modernization suggestions

After inspection, suggest these only as optional lanes unless the user already asked for upgrades:
- consolidate tool configuration toward `pyproject.toml` where that reduces sprawl and matches the selected tools
- suggest moving to `uv` for project/dependency/environment management when the repo has slow, fragmented, or unreproducible dependency workflows; keep it opt-in and verify the current uv docs before changing lockfiles or install commands
- add or strengthen Ruff lint/format gates, with repo-appropriate rules rather than broad ignores
- add or strengthen mypy/Pyright checking on owned modules and stable boundaries
- update the supported Python version, package manager, lockfile workflow, or build backend after verifying current project constraints and official tool docs
- move toward `src/` layout for publishable packages when import-path correctness matters and the migration can be validated
- make the main check command run lint, format check, type/contract checks, tests, and build/package checks when relevant
- for large older repos, propose an incremental typing migration plan before enabling strict checks globally

If the user accepts one of these lanes, do the upgrade cleanly. Do not make Python checks pass by weakening strictness, adding blanket ignores, hiding import errors, abusing `Any`, skipping problem files, or preserving a godmodule because the stricter tool exposed too much work.

## Source notes

This reference was drafted from current official docs for Python packaging/`pyproject.toml`, Ruff configuration/formatter, mypy configuration, Pyright configuration, pytest configuration, uv project sync/layout, Python typing specs for TypedDict/Protocol/dataclass-related typing, and Python `asyncio` runner/task documentation.

Useful source anchors:
- Python `asyncio.run(...)` manages the loop and cannot run inside another event loop in the same thread: https://docs.python.org/3/library/asyncio-runner.html
- Python task cancellation recommends `try/finally`, propagating `CancelledError`, and warns that swallowing cancellation can break structured concurrency: https://docs.python.org/3/library/asyncio-task.html#task-cancellation
- Python `TaskGroup` waits for owned tasks and cancels siblings on non-cancellation failure: https://docs.python.org/3/library/asyncio-task.html#task-groups
- mypy’s existing-code guide recommends starting small, standardizing the invocation, running in CI, and avoiding broad missing-import ignores where possible: https://mypy.readthedocs.io/en/stable/existing_code.html
- Pyright supports `off`, `basic`, `standard`, and `strict` type-checking modes plus finer diagnostic overrides: https://github.com/microsoft/pyright/blob/main/docs/configuration.md
