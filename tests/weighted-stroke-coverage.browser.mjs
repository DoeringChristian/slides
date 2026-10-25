import { isolatedBrowser } from './isolated-browser.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const evidence = process.env.WEIGHTED_STROKE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-commit-readiness/weighted-browser`;
const browser = await isolatedBrowser(evidence);
try {
  await browser.navigate('/tests/weighted-stroke-coverage.html');
  const start = Date.now();
  const result = await browser.evaluate(`(async () => { const { runWeightedCoverageProof } = await import('/tests/weighted-stroke-coverage.fixture.js'); return runWeightedCoverageProof(); })()`);
  for (const image of result.images) await writeFile(join(evidence, image.name + '.png'), Buffer.from(image.png.split(',')[1], 'base64'));
  delete result.images;
  result.elapsedMs = Date.now() - start;
  await writeFile(join(evidence, 'results.json'), JSON.stringify(result, null, 2));
  // Smoke budget, not a benchmark: catch accidental whole-world allocations or
  // a per-frame runaway while retaining ample headroom for shared CI hosts.
  if (result.elapsedMs > 30000) throw Error(`Weighted fixture exceeded 30s budget: ${result.elapsedMs}ms`);
  console.log('PASS weighted production primitives', result.records.length, 'records;', result.elapsedMs, 'ms');
} catch (error) {
  await writeFile(join(evidence, 'failure.txt'), error.stack ?? String(error));
  const progress = await browser.evaluate('window.weightedProofProgress');
  if (progress) {
    for (const image of progress.images ?? []) await writeFile(join(evidence, image.name + '.png'), Buffer.from(image.png.split(',')[1], 'base64'));
    delete progress.images;
    await writeFile(join(evidence, 'partial-results.json'), JSON.stringify(progress, null, 2));
  }
  throw error;
} finally { await browser.close(); }
