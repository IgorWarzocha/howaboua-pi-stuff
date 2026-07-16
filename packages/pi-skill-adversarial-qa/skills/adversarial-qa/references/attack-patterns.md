# Attack patterns

Use this reference to choose and execute an adversarial method. Repository contracts and native tooling outrank these generic patterns.

## Boundary and partition attacks

Partition the valid domain, then probe transitions between partitions:

- empty, singleton, and repeated values
- minimum, maximum, zero, negative, and overflow-adjacent numbers
- missing, unknown, duplicated, and reordered fields
- valid Unicode, normalization forms, malformed encodings, and unusual whitespace where supported
- first/last element, exact timeout, exact capacity, and one step either side

Prefer a few boundaries justified by branches or contracts over a large arbitrary table.

## Algebraic and metamorphic properties

Useful properties include:

- **round trip:** `decode(encode(x)) == x`
- **idempotence:** `normalize(normalize(x)) == normalize(x)`
- **inverse:** applying an operation and its inverse restores the relevant state
- **conservation:** sorting preserves the multiset; chunking and rejoining preserves content
- **monotonicity:** increasing an allowed input cannot decrease the promised result
- **permutation:** reordering irrelevant input does not change the semantic output
- **equivariance:** transforming the input produces the corresponding transformed output
- **model agreement:** a stateful implementation matches a smaller, obvious model

Normalize irrelevant representation differences before comparison. Do not weaken semantic equality merely to make a property pass.

## Differential testing

Compare two independently meaningful executions:

- baseline commit versus candidate commit
- simple reference versus optimized implementation
- old dependency versus upgraded dependency
- two language implementations of the same protocol
- fallback path versus accelerated path

Generate inputs from the shared supported domain. Classify every difference as intended, regression, previously undocumented compatibility, or harness noise. A difference alone is not a bug.

Use the same corpus, seeds, configuration, time controls, and non-target dependency versions in both executions. Give each run independent writable state, including services and caches, or serialize runs with a verified reset between them. Vary only the implementation or dependency under comparison.

## Mutation testing

Use small mutants that represent plausible wrong behaviour near the changed symbols:

- invert or remove a condition
- shift a boundary
- replace a returned value
- skip a state transition or side effect
- change ordering, retry count, timeout, or error mapping
- remove the line claimed to fix the regression

A surviving mutant means the selected tests did not distinguish that wrong behaviour. It does not automatically mean the production code is wrong. Avoid broad mutation campaigns when a few semantic mutants can answer the question.

Common tools include Stryker for JavaScript/TypeScript, mutmut or Cosmic Ray for Python, cargo-mutants for Rust, PIT for Java, and go-mutesting for Go. Prefer an existing repository tool; verify current official documentation before introducing one.

## Property-based and stateful testing

Start with the contract, then design generators. Useful ecosystems include Hypothesis for Python, fast-check for JavaScript/TypeScript, proptest or quickcheck for Rust, jqwik for Java, and rapid or gopter for Go.

Check generator quality:

- generated values satisfy real preconditions
- assumptions or filters do not reject most cases
- important partitions have a realistic chance of appearing
- shrinking preserves validity
- stateful commands respect legal transitions while still exploring unusual sequences

Preserve the seed and minimized example for reproduction.

## Fuzzing

Use fuzzing when inputs are broad and machine-checkable failure signals exist: crashes, sanitizer findings, hangs, invariant violations, or differential disagreement. A fuzzer without an oracle mostly measures endurance.

Prefer repository-native harnesses and existing infrastructure. Common choices include built-in Go fuzzing, cargo-fuzz/libFuzzer for Rust, Atheris for Python, Jazzer for JVM code, and libFuzzer or AFL++ for C/C++.

For every finding, retain the minimized corpus input and exact invocation. Confirm it without the fuzzer before reporting it.

## Failure injection and concurrency

Useful interventions include:

- fake clocks and exact deadline boundaries
- forced IO failures, partial reads/writes, and interrupted operations
- reordered callbacks or messages
- dependency timeouts and retry exhaustion
- process restart between state transitions
- controlled scheduler interleavings or repeated race-detector runs

Prefer deterministic control points over high-volume repetition. If only repetition exposes the failure, report the seed, frequency, and environment rather than presenting it as deterministic.

## Oracle strength

From strongest to weakest:

1. machine-checked formal contract or independently validated reference model
2. explicit public compatibility contract or accepted requirement
3. historical behaviour backed by tests and usage
4. several independent caller assumptions or documentation examples
5. a model's interpretation of names or implementation shape

Generated code and a generated test derived from the same explanation are not independent evidence. A mutant proves only that a test can detect that mutation, and a differential mismatch identifies a question rather than which implementation is correct.
