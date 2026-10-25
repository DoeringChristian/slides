// Child preload: durable case/subsuite markers and bounded silence. A PASS
// marker is not an assertion count; aggregate matrix summaries remain in logs.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
const dir = process.env.BROWSER_GATE_EVIDENCE;
const source = readFileSync(process.argv[1], 'utf8');
// Historical artifact paths now live only below this suite's evidence directory.
for (const match of source.matchAll(/\$\{process\.env\.BROWSER_GATE_EVIDENCE\}\/artifacts\/([^'"`$\n]+)/g)) {
  const path = join(dir, 'artifacts', match[1]); mkdirSync(dirname(path), { recursive: true });
}
mkdirSync(join(dir, 'artifacts/slides-import-export-repair'), { recursive: true });
let timer;
function arm() { clearTimeout(timer); timer = setTimeout(() => { appendFileSync(join(dir, 'case-progress.jsonl'), JSON.stringify({ event: 'deadline', seconds: 90 }) + '\n'); console.error('No case/subsuite progress within 90 seconds'); process.exit(124); }, 90000); timer.unref(); }
const original = console.log;
console.log = (...args) => {
  const text = format(...args);
  appendFileSync(join(dir, 'case-progress.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: /^PASS\b/.test(text) ? 'pass-marker' : 'progress', text }) + '\n');
  arm(); original(...args);
};
arm();
