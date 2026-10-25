/** Navigation readiness only: failures after a fixture is ready still fail the test. */
export async function waitForCanvasFixture(evaluate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate("document.readyState === 'complete' && typeof window.canvasTest?.setup === 'function'")) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Canvas fixture did not become ready within 10 seconds');
}
