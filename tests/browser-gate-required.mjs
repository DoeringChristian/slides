// Suites are launched only by the serial gate, never against a developer service.
import assert from 'node:assert/strict';
assert(process.env.BROWSER_GATE_OWNED === '1', 'Run node tests/browser-gate.mjs; existing browser/server targets are forbidden');
assert(process.env.VITE_TEST_URL && process.env.CDP_URL && process.env.BROWSER_GATE_EVIDENCE);
