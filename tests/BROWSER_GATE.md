# Isolated serial browser gate

Run from the repository root, **after** `npm run build:all`:

```sh
BROWSER_GATE_EVIDENCE=/absolute/durable/evidence/run node tests/browser-gate.mjs
```

Append exact `*.browser.mjs` basenames for a bounded subset. `--list` lists the
inventory. No development server or manually launched Chrome is needed or used.
The parent launches the full gate; do not detach it inside a bounded worker.

Each suite gets its own Chrome profile, configFile:false Vite, and mandatory
allowlisting HTTP proxy. Browser API requests to Vite are denied. Only the two
persistence suites receive a freshly spawned backend, with `./data` resolved
under a verified absolute unique temporary cwd. Chrome's plaintext WebSocket
CONNECT is reparsed as HTTP, not blindly tunneled. API/yjs routes are bounded to
that backend. HTTP requests/denials and owned process IDs are retained. Node-side
import/export requests receive only that owned backend URL. No service restart,
existing profile, user-data deletion, or production compatibility shim is used.

Historical artifact paths have been redirected beneath each suite's evidence.
The current schema/factory fixtures and all assertions are retained. No existing
suite is classified as an expected pass or waived failure. In particular rounded
closure remains in the full inventory and can fail the gate.

The runner retains stdout/stderr, case/subsuite progress, suite exit/signal,
90-second no-progress deadline, 300-second free-text / 600-second other suite
limit, PASS marker count, and recursively inventoried JSON matrix record lengths
(with relative artifact paths). Setup has a 45-second overall deadline; backend
setup 15 seconds, fetches 3 seconds, CDP open 5 seconds, navigation 15 seconds.
Teardown starts all owned destructors and bounds each to 5 seconds; owned children
escalate SIGTERM to SIGKILL and await exit. These counts are not
assertion counts and must not be summed blindly (some matrices overlap). A
zero-marker successful suite may report its cases in a matrix (import/export).
Failures do not stop remaining suites. Source/config/build `manifest.files`
must be identical before/after. Partial/subset runs do not constitute full gate
acceptance. There are no implicit skips. Review progress.json and summary.json.

## Historical inventory caveat

There are currently 38 browser scripts; `--list` is authoritative for this tree.
The lost historical 34-script gate manifest has not been reconstructed, so this
is not evidence that all historical entries were recovered. No current file is
legacy-only; earlier edge/migration semantics were superseded by the accepted
current-schema fixtures under CLAUDE.md's no-backcompat policy. Missing legacy-only
script names cannot honestly be invented or counted as passing. Historical
reconciliation is not a blocker to the current38 gate; it only limits historical
“old34 + additions” claims. Do not reintroduce obsolete-format-only coverage.

Focused cleanup regression (fresh owned Chrome/backend, fault injection):
```sh
BROWSER_GATE_EVIDENCE=/absolute/durable/evidence/faults node --test tests/isolated-browser.regression.mjs
```
