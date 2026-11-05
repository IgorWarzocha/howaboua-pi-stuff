"""Hermes native session hooks, transported through the Node capture CLI."""

import json
import os
from pathlib import Path
import subprocess

_CAPTURE = Path(__file__).resolve().parents[2] / "src" / "capture.mjs"
_INTERACTIVE = {"cli", "tui", "desktop", "acp"}


def _report(**kwargs):
    if not os.environ.get("HC_TERMINAL_ID"):
        return
    if kwargs.get("platform") not in _INTERACTIVE:
        return
    session_id = kwargs.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        return
    subprocess.run(
        ["node", str(_CAPTURE), "hermes"],
        input=json.dumps({"session_id": session_id}),
        text=True,
        stdout=subprocess.DEVNULL,
        timeout=6,
        check=True,
    )


def _observed(**kwargs):
    if kwargs.get("platform") == "cli":
        _report(**kwargs)


def register(ctx):
    ctx.register_hook("on_session_start", _report)
    ctx.register_hook("on_session_reset", _report)
    ctx.register_hook("pre_llm_call", _observed)
