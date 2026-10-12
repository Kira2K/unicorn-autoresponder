# Generated collection engines

Generated engines transform a sanitized page snapshot into either declarative
read/extraction instructions (`plan`) or a PageDocument-compatible result
(`parse`). They never receive browser, network, filesystem, process, SQL or
application APIs. The host owns every read and enforces navigation policy.

`evaluateEngine(code, input, limits)` runs one synchronous `plan(input)` or
`parse(input)` function in QuickJS with CPU and memory limits. Output is copied
through JSON and validated with an exact allowlist; generated output cannot bind
itself to a source or assert that collection succeeded.

An immutable `EngineArtifact` binds the code hash to explicit source IDs and
framework-owned fixture evidence. `validateEngineCandidate` re-runs the supplied
independent fixtures and requires separate host-owned evidence that the live
result and its pagination are complete, plus substantive descriptions (or
explicit empty-state evidence). Coverage and empty-state fields are rejected
from generated parse output. Only the host validation result can activate a
source binding. Bindings retain the previous
artifact reference for rollback. Production SQL activation is owned by the
collection workflow; the file binding helpers are suitable for local/testing
registries.
