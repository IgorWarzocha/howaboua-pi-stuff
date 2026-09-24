---
"@howaboua/pi-skill-harness-and-agent-engineering": patch
---

Harness skills now use shorter caching and extension guidance.

- Instruction calibration now verifies one-shot outputs against current APIs and checks for accidental guidance reads.
- Delegated evaluations now finish without approval between probes, while human-interface acceptance stays with the user.
- Efficiency comparisons distinguish smaller instruction payloads from task-cost savings using existing usage when available.
- Tool-design guidance keeps potentially needed truncated output retrievable.
